import { accessSync, constants, lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** The PATH entry HermesProjectAdapter would execute, as named on PATH, without invoking a shell; null when none. */
export function findHermes(path: string | undefined): string | null {
  for (const directory of (path ?? "/usr/local/bin:/usr/bin:/bin").split(delimiter).filter(isAbsolute)) {
    const entry = join(directory, "hermes");
    try {
      const binary = realpathSync(entry);
      if (!statSync(binary).isFile()) continue;
      accessSync(binary, constants.X_OK);
      return entry;
    } catch { /* Try the next PATH entry, as the adapter does. */ }
  }
  return null;
}

export function hermesAvailable(path: string | undefined): boolean {
  return findHermes(path) !== null;
}

export interface LauncherChain {
  /** Every file or link a native call executes through: each path as named, each symlink hop, and where it resolves. */
  hops: string[];
  /** Every existing absolute path a script launcher names, files and directories alike, as written and resolved. */
  named: string[];
}

/** Follow the PATH entry through symlinks and small script launchers, a few launchers deep. */
export function hermesLauncherChain(entry: string): LauncherChain {
  const hops: string[] = [];
  const named: string[] = [];
  const read = new Set<string>();
  const add = (list: string[], item: string) => { if (!list.includes(item)) list.push(item); };
  const visit = (path: string, depth: number) => {
    // Re-pointing any link on the way re-routes hermes as surely as rewriting the file at its end.
    for (let hop = path, links = 0; links < 40; links++) {
      add(hops, hop);
      try {
        if (!lstatSync(hop).isSymbolicLink()) break;
        hop = resolve(dirname(hop), readlinkSync(hop));
      } catch { break; }
    }
    let real: string;
    try { real = realpathSync(path); } catch { return; }
    add(hops, real);
    if (read.has(real) || depth >= 4) return;
    read.add(real);
    let text: string;
    try {
      if (statSync(real).size > 64 * 1024) return;
      text = readFileSync(real, "latin1");
    } catch { return; }
    if (!text.startsWith("#!")) return;
    for (const [mention] of text.matchAll(/\/[^\s'"`;|&<>()$\\]+/gu)) {
      let target: string;
      try {
        lstatSync(mention);
        target = realpathSync(mention);
      } catch { continue; }
      add(named, mention);
      add(named, target);
      try {
        if (!statSync(target).isFile()) continue;
        accessSync(target, constants.X_OK);
        visit(mention, depth + 1);
      } catch { /* Named, but not an executable file. */ }
    }
  };
  visit(entry, 0);
  return { hops, named };
}

/** The user's own Hermes homes as written and as resolved: what ECOSYM_HARNESS_HOME, HERMES_HOME and ~/.hermes name. */
export function realHermesHomes(): string[] {
  const homes = [process.env.ECOSYM_HARNESS_HOME, process.env.HERMES_HOME, join(homedir(), ".hermes")]
    .filter((home): home is string => home !== undefined && isAbsolute(home))
    .flatMap((home) => { try { return [resolve(home), realpathSync(home)]; } catch { return [resolve(home)]; } });
  return [...new Set(homes)];
}

function within(file: string, directory: string): boolean {
  const path = relative(directory, file);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function fingerprint(files: readonly string[]): string[] {
  return files.map((file) => {
    try {
      const stat = lstatSync(file, { bigint: true });
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.isSymbolicLink() ? readlinkSync(file) : ""}`;
    } catch { return "missing"; }
  });
}

export type NativeHermes =
  | { kind: "unavailable" | "refused"; reason: string }
  | { kind: "ready"; entry: string; chain: string[]; changed(): string[] };

/**
 * An isolated HERMES_HOME does not isolate the installation that runs it. A self-managed Hermes source install keeps
 * its managed Python under whatever HERMES_HOME it starts with and re-points its own launchers at it. Installed inside
 * ~/.hermes, a native test therefore rewrote the user's launcher to a temporary test profile, and `hermes` broke when
 * that profile was deleted. Native integration refuses a hermes that runs through or names any path inside a real Hermes
 * home, and reports any file or link it executes through that a native run changed.
 */
export function nativeHermes(path: string | undefined, homes: readonly string[] = realHermesHomes()): NativeHermes {
  const entry = findHermes(path);
  if (entry === null) {
    return { kind: "unavailable", reason: "Native integration skipped: no executable hermes on PATH; profile isolation verified" };
  }
  const { hops, named } = hermesLauncherChain(entry);
  for (const home of homes) {
    const resident = [...hops, ...named].find((file) => within(file, home));
    if (resident !== undefined) {
      return { kind: "refused", reason: `Native integration refused: hermes runs through or names ${resident}, inside the real Hermes home ${home}. An isolated HERMES_HOME cannot stop it rewriting its own launchers there.` };
    }
  }
  const before = fingerprint(hops);
  return { kind: "ready", entry, chain: hops, changed: () => {
    const after = fingerprint(hops);
    return hops.filter((_, index) => after[index] !== before[index]);
  } };
}
