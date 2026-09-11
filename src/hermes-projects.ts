import { execFile } from "node:child_process";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";
import { ProjectError, type HarnessAdapter, type HarnessBinding, type HarnessOutcome, type HarnessProjectRequest, type ProjectErrorCode } from "./project-types.ts";

// Observed with Hermes v0.21.0. Both identity sources are CLI prose, not JSON.
const createdPattern = /^Created project ([a-z0-9][a-z0-9_-]*) \((p_[0-9a-f]+)\)$/m;
const adoptedPattern = /folder already belongs to project '([a-z0-9][a-z0-9_-]*)' \((p_[0-9a-f]+)\)/;
const headerPattern = /^([a-z0-9][a-z0-9_-]*)  \[(p_[0-9a-f]+)\]( \(archived\))?$/;
const unknown = (reason: ProjectErrorCode = "readback_ambiguous"): HarnessOutcome => ({ kind: "unknown", reason });
type Output = { code: number; stdout: string; stderr: string; reason?: ProjectErrorCode };

export class HermesProjectAdapter implements HarnessAdapter {
  readonly id = "hermes";
  readonly #bin: string | undefined;
  readonly #root: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #home: string;
  readonly #userHome: string;

  constructor(options: { root: string; env?: NodeJS.ProcessEnv; home?: string; binary?: string }) {
    const env = options.env ?? process.env;
    const home = options.home ?? homedir();
    if (!isAbsolute(options.root)) throw new ProjectError("root_invalid");
    this.#root = resolve(options.root);
    this.#userHome = resolve(home);
    this.#home = resolve(env.ECOSYM_HARNESS_HOME ?? env.HERMES_HOME ?? join(home, ".hermes"));
    this.#env = { PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: home,
      HERMES_HOME: this.#home, LANG: "C", LC_ALL: "C" };
    const candidates = options.binary !== undefined ? [options.binary]
      : this.#env.PATH!.split(delimiter).filter(isAbsolute).map((path) => join(path, "hermes"));
    for (const candidate of candidates) {
      try {
        if (!isAbsolute(candidate) || !isAbsolute(this.#home) || !isAbsolute(home)) continue;
        const bin = realpathSync(candidate);
        if (!statSync(bin).isFile()) continue;
        accessSync(bin, constants.X_OK);
        this.#bin = bin;
        break;
      } catch { /* An unavailable harness must not prevent server startup. */ }
    }
  }

  #run(args: string[], deadline = Infinity): Promise<Output> {
    const remaining = Math.min(30_000, deadline - performance.now());
    if (remaining <= 0) return Promise.resolve({ code: -1, stdout: "", stderr: "", reason: "harness_timeout" });
    if (!this.#bin) return Promise.resolve({ code: -1, stdout: "", stderr: "", reason: "harness_unavailable" });
    return new Promise((done) => {
      let reason: ProjectErrorCode | undefined;
      let kill: NodeJS.Timeout | undefined;
      const child = execFile(this.#bin!, args, {
        shell: false, env: this.#env, cwd: this.#root, encoding: "utf8", maxBuffer: 64 * 1024,
      }, (error, stdout, stderr) => {
        clearTimeout(timeout);
        if (kill) clearTimeout(kill);
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
        if (error && (error.code === "ENOENT" || error.code === "EACCES")) reason = "harness_unavailable";
        if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") reason = "readback_ambiguous";
        if (performance.now() >= deadline) reason = "harness_timeout";
        done(reason ? { code, stdout: "", stderr: "", reason } : { code, stdout, stderr });
      });
      const stop = (why: ProjectErrorCode) => {
        if (reason) return;
        reason = why;
        child.kill("SIGTERM");
        kill = setTimeout(() => child.kill("SIGKILL"), 2000);
      };
      // Native startup can exceed 10 seconds under concurrent load; retain a hard deadline.
      const timeout = setTimeout(() => stop("harness_timeout"), remaining);
      for (const stream of [child.stdout, child.stderr]) {
        let bytes = 0;
        stream?.on("data", (data: string | Buffer) => {
          bytes += Buffer.byteLength(data);
          if (bytes > 64 * 1024) stop("readback_ambiguous");
        });
      }
    });
  }

  async #binding(slug: string, id: string, archived: boolean, provenance: HarnessBinding["provenance"], deadline = Infinity): Promise<HarnessOutcome> {
    const version = await this.#run(["--version"], deadline);
    if (version.reason) return unknown(version.reason);
    const match = /^Hermes Agent v(\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?)\b/.exec(version.stdout);
    if (version.code !== 0 || !match) return unknown();
    return { kind: "bound", binding: { externalId: id, externalSlug: slug, externalArchived: archived,
      harnessHome: this.#home, harnessVersion: match[1]!, provenance } };
  }

  #normalizeWorkspacePath(value: string): string {
    const expanded = value === "~" ? this.#userHome : value.startsWith(`~${sep}`) ? join(this.#userHome, value.slice(2)) : value;
    return resolve(expanded);
  }

  async #find(request: HarnessProjectRequest): Promise<HarnessOutcome | null> {
    // Enumeration must finish within one budget, not 30 seconds per project.
    const deadline = performance.now() + 30_000;
    const list = await this.#run(["project", "list", "--all"], deadline);
    if (list.reason) return unknown(list.reason);
    if (list.code !== 0) return unknown();
    if (list.stdout.trim() === "No projects yet. Create one with `hermes project create <name>`.") return null;
    const lines = list.stdout.trimEnd().split("\n");
    if (lines.length > 200) return unknown("readback_too_large");
    const slugs: string[] = [];
    for (const line of lines) {
      const match = /^[ *] ([a-z0-9][a-z0-9_-]*)\s+.+  \[\d+ folder\(s\)\]$/.exec(line);
      if (!match || slugs.includes(match[1]!)) return unknown();
      slugs.push(match[1]!);
    }
    let found: { slug: string; id: string; archived: boolean } | undefined;
    for (const slug of slugs) {
      const show = await this.#run(["project", "show", "--", slug], deadline);
      if (show.reason) return unknown(show.reason);
      const header = headerPattern.exec(show.stdout.split("\n")[0] ?? "");
      const primary = [...show.stdout.matchAll(/^  primary: (.+)$/gm)];
      if (show.code !== 0 || !header || header[1] !== slug || primary.length !== 1) return unknown();
      if (this.#normalizeWorkspacePath(primary[0]![1]!) === this.#normalizeWorkspacePath(request.workspacePath)) {
        if (found) return unknown();
        found = { slug, id: header[2]!, archived: header[3] !== undefined };
      }
    }
    return found ? this.#binding(found.slug, found.id, found.archived, "adopted", deadline) : null;
  }

  async reconcile(request: HarnessProjectRequest): Promise<HarnessOutcome> {
    return await this.#find(request) ?? unknown();
  }

  async provision(request: HarnessProjectRequest): Promise<HarnessOutcome> {
    if (!isAbsolute(request.workspacePath) || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(request.slug) ||
        !request.name || request.name.startsWith("-") || /\p{C}/u.test(request.name) || [...request.name].length > 64) {
      return { kind: "refused", reason: "invalid_request" };
    }
    // Native create ignores archived registrations. Only a complete enumeration
    // proving absence permits create, including after an inconclusive retry.
    const existing = await this.#find(request);
    if (existing) return existing;
    const output = await this.#run(["project", "create", "--slug", request.slug, "--", request.name, request.workspacePath]);
    if (output.reason) return unknown(output.reason);
    const identity = output.code === 0 ? createdPattern.exec(output.stdout)
      : output.code === 2 ? adoptedPattern.exec(output.stderr) : null;
    if (identity) return this.#binding(identity[1]!, identity[2]!, false, output.code === 0 ? "created" : "adopted");
    const readback = await this.#find(request);
    if (readback) return readback;
    return output.code === 2 ? { kind: "refused", reason: "harness_refused" } : unknown();
  }
}
