import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { HermesProjectAdapter } from "./hermes-projects.ts";
import { projectsRoot } from "./paths.ts";
import { PROJECT_ERROR_CODES, ProjectError, type HarnessAdapter, type WorldProjectSnapshot } from "./project-types.ts";
import type { ObservationStore } from "./store.ts";

export { projectsRoot, ProjectError };
export type { HarnessAdapter } from "./project-types.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
let active = 0;

function request(body: unknown, keys: string[]): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== keys.length || !keys.every((key) => Object.hasOwn(body, key))) {
    throw new ProjectError("invalid_request");
  }
  const value = body as Record<string, unknown>;
  if (typeof value.requestKey !== "string" || !uuid.test(value.requestKey)) throw new ProjectError("invalid_request");
  return value;
}

function contained(root: string, target: string): void {
  const path = relative(root, target);
  if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new ProjectError("containment_violation");
  }
}

export class ProjectService {
  readonly #store: ObservationStore;
  readonly #root: string;
  readonly #adapter: HarnessAdapter;

  constructor(store: ObservationStore, options: {
    root?: string; adapter?: HarnessAdapter; env?: NodeJS.ProcessEnv; home?: string;
  } = {}) {
    this.#store = store;
    const env = options.env ?? process.env;
    const home = options.home ?? homedir();
    this.#root = options.root ?? projectsRoot(env, home);
    if (!isAbsolute(this.#root)) throw new ProjectError("root_invalid");
    this.#root = resolve(this.#root);
    this.#adapter = options.adapter ?? new HermesProjectAdapter({ root: this.#root, env, home });
  }

  async create(civilizationId: string, body: unknown): Promise<{ project: WorldProjectSnapshot; created: boolean }> {
    const value = request(body, ["requestKey", "name", "harness"]);
    if (value.harness !== "hermes") throw new ProjectError("invalid_request");
    if (typeof value.name !== "string" || /\p{C}/u.test(value.name)) throw new ProjectError("invalid_name");
    const name = value.name.normalize("NFC").trim();
    if (!name || [...name].length > 64 || name.startsWith("-")) throw new ProjectError("invalid_name");
    const slug = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "");
    if (!slugPattern.test(slug)) throw new ProjectError("slug_underivable");
    if (!civilizationId.startsWith("civilization:") || !uuid.test(civilizationId.slice(13))) {
      throw new ProjectError("civilization_unknown");
    }
    const result = this.#store.requestProject({
      civilizationId, name, slug, harness: "hermes", requestKey: (value.requestKey as string).toLowerCase(),
      requestDigest: createHash("sha256").update(JSON.stringify({ civilizationId, name, harness: "hermes" })).digest("hex"),
      workspacePath: join(this.#root, civilizationId.slice(13), slug),
    });
    if (!result.created) {
      if (result.project.state !== "requested") return result;
      try {
        return { project: await this.#attempt(result.project, result.project.attempt > 0, undefined, result.project.attempt), created: false };
      } catch (error) {
        if (!(error instanceof ProjectError && error.code === "retry_in_progress")) throw error;
        return { project: this.#store.getProject(result.project.projectId)!, created: false };
      }
    }
    return { project: await this.#attempt(result.project, false), created: true };
  }

  async retry(projectId: string, body: unknown): Promise<WorldProjectSnapshot> {
    const deadline = Date.now() + 120_000;
    const value = request(body, ["requestKey"]);
    const requestKey = (value.requestKey as string).toLowerCase();
    for (;;) {
      const replay = this.#store.getProjectRetry(projectId, requestKey);
      if (replay) {
        if (!replay.pending) return replay.project;
        if (Date.now() >= deadline) throw new ProjectError("retry_in_progress");
        await new Promise((done) => setTimeout(done, 25));
        continue;
      }
      const project = this.#store.getProject(projectId);
      if (!project || project.state === "established") throw new ProjectError("invalid_request");
      try {
        return await this.#attempt(project, true, requestKey);
      } catch (error) {
        // Another process may have claimed this same key since the replay lookup.
        if (!(error instanceof ProjectError && error.code === "retry_in_progress" &&
          this.#store.getProjectRetry(projectId, requestKey))) throw error;
      }
    }
  }

  async #directory(project: WorldProjectSnapshot, retry: boolean): Promise<void> {
    const segment = project.civilizationId.slice(13);
    if (!project.civilizationId.startsWith("civilization:") || !uuid.test(segment) ||
        !slugPattern.test(project.slug) || !isAbsolute(project.workspacePath) ||
        project.workspacePath !== join(this.#root, segment, project.slug)) throw new ProjectError("containment_violation");
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    await chmod(this.#root, 0o700);
    const root = await realpath(this.#root);
    const civ = join(root, segment);
    await mkdir(civ, { recursive: true, mode: 0o700 });
    // Validate the parent before creating a child, then repeat after mkdir.
    const verify = async (path: string) => {
      contained(root, await realpath(path));
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new ProjectError("containment_violation");
      if (!stat.isDirectory()) throw new ProjectError("not_a_directory");
    };
    await verify(civ);
    try {
      await mkdir(project.workspacePath, { recursive: false, mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await verify(project.workspacePath);
      if (!retry) throw new ProjectError("directory_exists");
    }
    await verify(civ);
    await verify(project.workspacePath);
  }

  async #attempt(project: WorldProjectSnapshot, retry: boolean, requestKey?: string, expectedRequestedAttempt?: number): Promise<WorldProjectSnapshot> {
    if (active >= 4) throw new ProjectError("busy");
    const attempt = this.#store.claimProjectAttempt(project.projectId, requestKey, expectedRequestedAttempt);
    active++;
    let external = false;
    try {
      await this.#directory(project, retry);
      this.#store.appendProjectEvent(project.projectId, "directory-created", attempt);
      this.#store.appendProjectEvent(project.projectId, "external-unknown", attempt);
      external = true;
      let outcome = retry ? await this.#adapter.reconcile(project) : await this.#adapter.provision(project);
      if (retry && outcome.kind === "unknown" && outcome.reason === "readback_ambiguous") {
        outcome = await this.#adapter.provision(project);
      }
      if (outcome.kind === "bound") this.#store.bindProject(project.projectId, attempt, outcome.binding);
      else this.#store.appendProjectEvent(project.projectId, outcome.kind === "refused" ? "failed" : "external-unknown", attempt,
        PROJECT_ERROR_CODES.includes(outcome.reason) ? outcome.reason : "readback_ambiguous");
    } catch (error) {
      const code = error instanceof ProjectError ? error.code
        : external ? "readback_ambiguous"
        : (error as NodeJS.ErrnoException).code === "ENOTDIR" ? "not_a_directory" : "filesystem_denied";
      this.#store.appendProjectEvent(project.projectId, external ? "external-unknown" : "failed", attempt, code);
    } finally {
      try { this.#store.releaseProjectAttempt(project.projectId); } catch { /* Preserve the provisioning outcome. */ } finally { active--; }
    }
    return requestKey === undefined ? this.#store.getProject(project.projectId)!
      : this.#store.getProjectRetry(project.projectId, requestKey)!.project;
  }
}
