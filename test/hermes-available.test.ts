import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { hermesAvailable, nativeHermes, realHermesHomes } from "./hermes-available.ts";

test("native availability requires an executable file on an absolute PATH entry", (t) => {
  const root = mkdtempSync(resolve(".hermes-availability-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(hermesAvailable(root), false);
  assert.equal(hermesAvailable(""), false);
  const binary = join(root, "hermes");
  mkdirSync(binary);
  assert.equal(hermesAvailable(root), false);
  rmSync(binary, { recursive: true });
  writeFileSync(binary, "#!/bin/sh\nexit 0\n", { mode: 0o600 });
  assert.equal(hermesAvailable(root), false);
  chmodSync(binary, 0o700);
  assert.equal(hermesAvailable(root), true);
  assert.equal(hermesAvailable(join(root, "absent") + delimiter + root), true);
  assert.equal(hermesAvailable(root.slice(process.cwd().length + 1)), false);
  const links = join(root, "links");
  mkdirSync(links);
  symlinkSync(binary, join(links, "hermes"));
  assert.equal(hermesAvailable(links), true);
});

test("native integration refuses a hermes that runs through a real Hermes home, however it is reached", (t) => {
  const root = realpathSync(mkdtempSync(resolve(".hermes-availability-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "real-home");
  const install = join(home, "hermes-agent", ".hermes", "bin");
  const path = join(root, "bin");
  for (const directory of [install, path]) mkdirSync(directory, { recursive: true });
  // The observed shape: a PATH convenience that execs a self-managed launcher inside the Hermes home.
  writeFileSync(join(install, "hermes"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(path, "hermes"), `#!/bin/sh\nexec ${join(install, "hermes")} "$@"\n`, { mode: 0o700 });
  const refused = nativeHermes(path, [home]);
  assert.equal(refused.kind, "refused");
  assert.match(refused.kind === "refused" ? refused.reason : "", /refused: hermes runs through .*real-home.*inside the real Hermes home/);
  // A symlink into the home is refused the same way.
  const linked = join(root, "linked");
  mkdirSync(linked);
  symlinkSync(join(install, "hermes"), join(linked, "hermes"));
  assert.equal(nativeHermes(linked, [home]).kind, "refused");
  assert.equal(nativeHermes(join(root, "absent"), [home]).kind, "unavailable");
  const fallback = join(homedir(), ".hermes");
  assert.ok(realHermesHomes().includes(existsSync(fallback) ? realpathSync(fallback) : fallback), "the ~/.hermes default is always protected");
});

test("native integration outside every real home reports any launcher a native run rewrote", (t) => {
  const root = realpathSync(mkdtempSync(resolve(".hermes-availability-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const install = join(root, "install");
  const path = join(root, "bin");
  for (const directory of [install, path]) mkdirSync(directory);
  const launcher = join(install, "hermes");
  writeFileSync(launcher, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(path, "hermes"), `#!/bin/sh\nexec ${launcher} "$@"\n`, { mode: 0o700 });
  const native = nativeHermes(path, [join(root, "real-home")]);
  assert.equal(native.kind, "ready");
  if (native.kind !== "ready") return;
  assert.ok(native.chain.includes(launcher), "the exec target is part of the launcher chain");
  assert.deepEqual(native.changed(), []);
  // What Hermes does on start: atomically replace its launcher to point at another interpreter.
  writeFileSync(`${launcher}.staged`, "#!/bin/sh\nexec /tmp/deleted-profile/python3\n", { mode: 0o700 });
  renameSync(`${launcher}.staged`, launcher);
  assert.deepEqual(native.changed(), [launcher]);
});

test("native integration sees every symlink hop and every path a launcher names, not only where they resolve", (t) => {
  const root = realpathSync(mkdtempSync(resolve(".hermes-availability-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "real-home");
  const install = join(root, "install");
  const profile = join(root, "temporary-profile");
  const python = join(root, "python-real");
  for (const directory of [home, install, profile, join(install, "venv", "bin"), join(home, "hermes-agent", "venv", "bin")]) mkdirSync(directory, { recursive: true });
  for (const file of [python, join(profile, "python")]) writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const launcher = join(install, "hermes");
  writeFileSync(launcher, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const bin = (name: string) => { const directory = join(root, name); mkdirSync(directory); return directory; };

  // (a) A PATH symlink re-pointed into a temporary profile re-routes hermes: the link itself is part of the chain.
  const linked = bin("linked");
  symlinkSync(launcher, join(linked, "hermes"));
  const viaLink = nativeHermes(linked, [home]);
  assert.equal(viaLink.kind, "ready");
  rmSync(join(linked, "hermes"));
  symlinkSync(join(profile, "python"), join(linked, "hermes"));
  assert.deepEqual(viaLink.kind === "ready" ? viaLink.changed() : null, [join(linked, "hermes")]);

  // (b) A shebang interpreter that is a symlink, re-pointed by a run, is caught at the link.
  const venvPython = join(install, "venv", "bin", "python");
  symlinkSync(python, venvPython);
  const shebang = bin("shebang");
  writeFileSync(join(shebang, "hermes"), `#!${venvPython}\n`, { mode: 0o700 });
  const viaShebang = nativeHermes(shebang, [home]);
  assert.equal(viaShebang.kind, "ready");
  rmSync(venvPython);
  symlinkSync(join(profile, "python"), venvPython);
  assert.deepEqual(viaShebang.kind === "ready" ? viaShebang.changed() : null, [venvPython]);

  // (c) A launcher naming a link inside the home is refused even though the link resolves outside it.
  symlinkSync(python, join(home, "hermes-agent", "venv", "bin", "python"));
  const inside = bin("inside");
  writeFileSync(join(inside, "hermes"), `#!${join(home, "hermes-agent", "venv", "bin", "python")}\n`, { mode: 0o700 });
  assert.equal(nativeHermes(inside, [home]).kind, "refused");

  // (d) A launcher that builds its exec path from a directory inside the home is refused by the directory it names.
  const variable = bin("variable");
  writeFileSync(join(variable, "hermes"), `#!/bin/sh\nAGENT=${join(home, "hermes-agent")}; exec "$AGENT/venv/bin/python" "$@"\n`, { mode: 0o700 });
  assert.equal(nativeHermes(variable, [home]).kind, "refused");
});
