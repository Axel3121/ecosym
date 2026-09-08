import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { test, type TestContext } from "node:test";
import { HermesProjectAdapter } from "../src/hermes-projects.ts";
import { ProjectService } from "../src/projects.ts";
import { ObservationStore } from "../src/store.ts";
import { parseCivilizationConfig } from "../src/institution.ts";
import { randomUUID } from "node:crypto";
import { hermesAvailable } from "./hermes-available.ts";

function isolated(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "ecosym-hermes-test-"));
  const profile = join(root, "profile");
  const workspace = join(root, "workspace");
  mkdirSync(profile);
  mkdirSync(workspace);
  // Fail loudly before any native invocation, even if fixture configuration changes.
  assert.notEqual(realpathSync(profile), join(homedir(), ".hermes"), "DANGER: native test targets the user's real Hermes home");
  const path = relative(realpathSync(root), realpathSync(profile));
  assert.ok(path && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`), "DANGER: harness home escaped isolated tmp tree");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { PATH: process.env.PATH, HOME: root, HERMES_HOME: profile, LANG: "C", LC_ALL: "C" };
  return { root, profile, workspace, env, request: { name: "Fjordkart", slug: "fjordkart", workspacePath: workspace } };
}

function fake(t: TestContext, behavior: string) {
  const s = isolated(t);
  const binary = join(s.root, "hermes");
  const log = join(s.root, "calls.jsonl");
  writeFileSync(binary, `#!${process.execPath}\nimport {appendFileSync,existsSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2); const root=${JSON.stringify(s.root)};
appendFileSync(${JSON.stringify(log)}, JSON.stringify({args,env:process.env,cwd:process.cwd()})+'\\n');
const workspace=${JSON.stringify(s.workspace)};
if(args[0]==='--version') { console.log('Hermes Agent v0.21.0 (2026.8.31)'); }
else { ${behavior} }\n`, { mode: 0o700 });
  const adapter = new HermesProjectAdapter({ root: s.root, binary, home: s.root,
    env: { ...s.env, ECOSYM_HARNESS_HOME: s.profile, HERMES_HOME: "/must-not-use", PRIVATE_TOKEN: "secret" } });
  const calls = () => readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as {
    args: string[]; env: Record<string, string>; cwd: string;
  });
  return { ...s, binary, adapter, calls };
}

const empty = "No projects yet. Create one with `hermes project create <name>`.";

test("native argv, locale, profile, cwd and environment are bounded; renamed slug is read back", async (t) => {
  const s = fake(t, `if(args[1]==='list') console.log(${JSON.stringify(empty)});
    else if(args[1]==='create') console.log('Created project renamed-2 (p_ab12)');`);
  const outcome = await s.adapter.provision({ ...s.request, name: "a; $(touch injected) `id`" });
  assert.deepEqual(outcome, { kind: "bound", binding: { externalId: "p_ab12", externalSlug: "renamed-2",
    externalArchived: false, harnessVersion: "0.21.0", harnessHome: s.profile, provenance: "created" } });
  const calls = s.calls();
  assert.deepEqual(calls.map((c) => c.args), [["project", "list", "--all"],
    ["project", "create", "--slug", "fjordkart", "--", "a; $(touch injected) `id`", s.workspace], ["--version"]]);
  for (const call of calls) {
    assert.equal(call.cwd, s.root);
    assert.deepEqual(Object.keys(call.env).sort(), ["PATH", "HOME", "HERMES_HOME", "LANG", "LC_ALL"].sort());
    assert.equal(call.env.HERMES_HOME, s.profile);
    assert.equal(call.env.LC_ALL, "C");
  }
});

test("rc2 dedup identifies adopted registration without leaking stderr", async (t) => {
  const s = fake(t, `if(args[1]==='list') console.log(${JSON.stringify(empty)});
    else { console.error("PRIVATE folder already belongs to project 'existing' (p_ab12)"); process.exitCode=2; }`);
  const result = await s.adapter.provision(s.request);
  assert.equal(result.kind, "bound");
  if (result.kind === "bound") assert.equal(result.binding.provenance, "adopted");
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});

test("unrecognized create prose falls back to list --all and show", async (t) => {
  const s = fake(t, `if(args[1]==='create') { writeFileSync(root+'/created','yes'); console.log('New unknown wording'); }
    else if(args[1]==='list') console.log(existsSync(root+'/created') ? '  actual                    Fjordkart  [1 folder(s)]' : ${JSON.stringify(empty)});
    else if(args[1]==='show') console.log('actual  [p_ab12]\\n  name:    Fjordkart\\n  primary: '+workspace);`);
  const result = await s.adapter.provision(s.request);
  assert.equal(result.kind, "bound");
  if (result.kind === "bound") assert.equal(result.binding.provenance, "adopted");
  assert.deepEqual(s.calls().filter((c) => c.args[1] === "show")[0]!.args, ["project", "show", "--", "actual"]);
});

test("archived registration is adopted before native create can duplicate it", async (t) => {
  const s = fake(t, `if(args[1]==='list') console.log('  old                    Old (archived)  [1 folder(s)]');
    else if(args[1]==='show') console.log('old  [p_ab12] (archived)\\n  primary: '+workspace);
    else throw Error('create must not run');`);
  const result = await s.adapter.provision(s.request);
  assert.equal(result.kind, "bound");
  if (result.kind === "bound") assert.equal(result.binding.externalArchived, true);
  assert.ok(s.calls().every((c) => c.args[1] !== "create"));
});

for (const scenario of ["unrecognized-list", "too-many", "ambiguous", "overflow-stdout", "overflow-stderr", "unknown-create", "refused"] as const) {
  test(`readback fails safely: ${scenario}`, async (t) => {
    const behavior = scenario === "unrecognized-list" ? `console.log('PRIVATE unexpected list');`
      : scenario === "too-many" ? `console.log(Array.from({length:201},(_,i)=>'  p'+i+'  Name  [1 folder(s)]').join('\\n'));`
      : scenario === "ambiguous" ? `if(args[1]==='list') console.log('  first  First  [1 folder(s)]\\n  second  Second  [1 folder(s)]');
          else console.log(args[3]+'  [p_ab12]\\n  primary: '+workspace);`
      : scenario.startsWith("overflow") ? `process.${scenario === "overflow-stdout" ? "stdout" : "stderr"}.write('x'.repeat(70000));`
      : `if(args[1]==='list') console.log(${JSON.stringify(empty)}); else {console.error('PRIVATE traceback'); process.exitCode=${scenario === "refused" ? 2 : 0};}`;
    const s = fake(t, behavior);
    const result = await s.adapter.provision(s.request);
    assert.deepEqual(result, { kind: scenario === "refused" ? "refused" : "unknown",
      reason: scenario === "too-many" ? "readback_too_large" : scenario === "refused" ? "harness_refused" : "readback_ambiguous" });
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    if (!["unknown-create", "refused"].includes(scenario)) assert.ok(s.calls().every((c) => c.args[1] !== "create"));
  });
}

test("slow native startup beyond 10 seconds still establishes a binding", { timeout: 20_000 }, async (t) => {
  const s = fake(t, `if(args[1]==='list') setTimeout(()=>console.log(${JSON.stringify(empty)}),10_500);
    else if(args[1]==='create') console.log('Created project fjordkart (p_ab12)');`);
  assert.deepEqual(await s.adapter.provision(s.request), { kind: "bound", binding: {
    externalId: "p_ab12", externalSlug: "fjordkart", externalArchived: false,
    harnessVersion: "0.21.0", harnessHome: s.profile, provenance: "created",
  } });
});

test("timeout sends TERM at 30 seconds then kills a TERM-ignoring process after 2 seconds", { timeout: 36_000 }, async (t) => {
  const s = fake(t, `process.on('SIGTERM',()=>writeFileSync(root+'/term','received')); setInterval(()=>{},1000);`);
  const started = Date.now();
  assert.deepEqual(await s.adapter.provision(s.request), { kind: "unknown", reason: "harness_timeout" });
  assert.equal(readFileSync(join(s.root, "term"), "utf8"), "received");
  assert.ok(Date.now() - started >= 31_900);
});

test("binary is resolved once and invalid positional inputs cannot invoke native", async (t) => {
  const s = isolated(t);
  const binary = join(s.root, "absent");
  const adapter = new HermesProjectAdapter({ root: s.root, binary, env: s.env, home: s.root });
  writeFileSync(binary, `#!${process.execPath}\nthrow Error('must not execute');`, { mode: 0o700 });
  assert.deepEqual(await adapter.provision(s.request), { kind: "unknown", reason: "harness_unavailable" });
  assert.deepEqual(await adapter.provision({ ...s.request, name: "--help" }), { kind: "refused", reason: "invalid_request" });
});

test("real native integration uses only temporary profile: service create, show, reconcile, archive adoption", { timeout: 30_000 }, async (t) => {
  const s = isolated(t);
  assert.equal(s.env.HERMES_HOME, s.profile, "DANGER: native call escaped test profile");
  assert.notEqual(realpathSync(s.profile), join(homedir(), ".hermes"), "DANGER: real Hermes home");
  if (!hermesAvailable(s.env.PATH)) {
    t.skip("Native integration skipped: no executable hermes on PATH; profile isolation verified");
    return;
  }
  const adapter = new HermesProjectAdapter({ root: s.root, env: s.env, home: s.root });
  const store = new ObservationStore(join(s.root, "state"));
  t.after(() => store.close());
  const { civilizationId } = store.foundCivilization(parseCivilizationConfig({ schemaVersion: 1,
    name: "Synthetic", domain: "Native integration", sources: [], mayActAlone: [], mustEscalate: [] }));
  const service = new ProjectService(store, { root: s.root, adapter });
  const result = await service.create(civilizationId, { requestKey: randomUUID(), name: "Blåbær Ø", harness: "hermes" });
  assert.equal(result.project.state, "established", "Available native Hermes must establish the project in the isolated profile");
  const project = result.project;
  const native = (args: string[]) => new Promise<string>((done, reject) => {
    assert.equal(s.env.HERMES_HOME, s.profile, "DANGER: native call escaped test profile");
    assert.notEqual(realpathSync(s.profile), join(homedir(), ".hermes"), "DANGER: real Hermes home");
    execFile("hermes", args, { shell: false, cwd: s.root, env: s.env, encoding: "utf8", timeout: 10_000, maxBuffer: 65536 },
      (error, stdout) => error ? reject(new Error("Isolated native CLI failed (output suppressed)")) : done(stdout));
  });
  const slug = project.harness!.externalSlug;
  const show = await native(["project", "show", "--", slug]);
  assert.ok(show.includes(`  primary: ${project.workspacePath}\n`));
  const reconciled = await adapter.reconcile(project);
  assert.equal(reconciled.kind, "bound");
  if (reconciled.kind === "bound") {
    assert.equal(reconciled.binding.externalId, project.harness!.externalId);
    assert.equal(reconciled.binding.harnessHome, s.profile);
  }
  await native(["project", "archive", "--", slug]);
  const archived = await adapter.provision(project);
  assert.equal(archived.kind, "bound");
  if (archived.kind === "bound") {
    assert.equal(archived.binding.externalArchived, true);
    assert.equal(archived.binding.externalId, project.harness!.externalId);
  }
  const list = await native(["project", "list", "--all"]);
  assert.equal(list.trim().split("\n").length, 1);
});
