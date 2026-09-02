import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { SandboxSourceMount } from "./sandbox.ts";

/** The host's DNS stub resolver on a systemd-resolved system. */
const DEFAULT_RESOLVER = "/run/systemd/resolve/stub-resolv.conf";

interface SandboxArgumentsInput {
  childArguments: string[];
  executable: string;
  home: string;
  project: string | undefined;
  readonlySourceDirectories: string[];
  /**
   * Path to the host's DNS stub resolver. Absent from the sandbox's own
   * namespace, which is why a nested run must be able to name a different
   * one — or none — instead of assuming the host's.
   */
  resolver?: string;
  sourceDirectories: string[];
  sourceMounts: SandboxSourceMount[];
  stateDirectory: string;
  stateMounts: SandboxSourceMount[];
  worktree: string;
}

interface RuntimeMount extends SandboxSourceMount {
  writable: boolean;
}

export function sandboxArguments(input: SandboxArgumentsInput): string[] {
  if (!isAbsolute(input.home) || input.home === "/") {
    throw new Error("HOME must name an absolute non-root directory");
  }
  const stateMounts = input.stateMounts.map((mount) => ({ ...mount, writable: true }));
  const worktreeMount = existingMounts([input.worktree]).map((path) => ({
    destination: path,
    source: path,
    writable: true,
  }));
  const writableMounts = existingMounts([
    join(input.home, ".local", "share", "opencode"),
    join(input.home, ".cache", "opencode"),
    join(input.home, ".local", "state", "opencode"),
    ...(input.project === undefined ? [] : [join(resolve(input.project), ".git")]),
  ]).map((path) => ({ destination: path, source: path, writable: true }));
  const readonlyMounts = existingMounts([
    join(input.home, ".opencode"),
    join(input.home, ".config", "opencode"),
    join(input.home, ".config", "git"),
    join(input.home, ".gitconfig"),
    join(input.home, ".local", "bin"),
    join(input.home, ".nvm"),
  ]).map((path) => ({ destination: path, source: path, writable: false }));
  const sourceMounts = input.sourceMounts.map((mount) => ({ ...mount, writable: false }));
  const protectedSourceDirectories = sourceProtectionRoots(
    input.readonlySourceDirectories,
    input.home,
  );
  const allMounts = [
    ...stateMounts,
    ...worktreeMount,
    ...writableMounts,
    ...readonlyMounts,
    ...sourceMounts,
  ];
  const writableAreas: RuntimeMount[] = [
    { destination: input.stateDirectory, source: input.stateDirectory, writable: true },
    ...worktreeMount,
    ...writableMounts,
  ];
  for (const directory of protectedSourceDirectories) {
    for (const mount of writableAreas) {
      if (
        mount.destination === directory ||
        mount.destination.startsWith(`${directory}/`) ||
        directory.startsWith(`${mount.destination}/`)
      ) {
        throw new Error(`Read-only source namespace overlaps writable path: ${directory}`);
      }
    }
  }
  const hiddenHomeRoot = dirname(input.home) === "/home" ? "/home" : input.home;
  const resolver = input.resolver ?? DEFAULT_RESOLVER;
  const resolverPresent = existsSync(resolver);
  const directories = parentDirectories([
    input.home,
    ...input.sourceDirectories,
    ...allMounts.map((mount) => dirname(mount.destination)),
    input.stateDirectory,
    ...(resolverPresent ? [dirname(resolver)] : []),
  ]);
  const arguments_ = [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup-try",
    "--tmpfs",
    "/",
    "--dir",
    "/usr",
    "--ro-bind",
    "/usr",
    "/usr",
    "--dir",
    "/etc",
    "--ro-bind",
    "/etc",
    "/etc",
    "--symlink",
    "usr/bin",
    "/bin",
    "--symlink",
    "usr/sbin",
    "/sbin",
    "--symlink",
    "usr/lib",
    "/lib",
    "--symlink",
    "usr/lib64",
    "/lib64",
    "--dir",
    "/tmp",
    "--tmpfs",
    "/tmp",
  ];
  for (const directory of parentDirectories([hiddenHomeRoot])) {
    arguments_.push("--dir", directory);
  }
  arguments_.push("--tmpfs", hiddenHomeRoot);
  for (const directory of directories) {
    if (canCreateRuntimeDirectory(directory, hiddenHomeRoot)) {
      arguments_.push("--dir", directory);
    }
  }
  for (const directory of protectedSourceDirectories) {
    arguments_.push("--tmpfs", directory);
  }
  arguments_.push("--tmpfs", input.stateDirectory);
  if (resolverPresent) {
    arguments_.push("--ro-bind", resolver, resolver);
  }
  arguments_.push("--dev", "/dev", "--proc", "/proc");
  addMounts(arguments_, stateMounts);
  addMounts(arguments_, worktreeMount);
  addMounts(arguments_, writableMounts);
  addMounts(arguments_, readonlyMounts);
  addMounts(arguments_, sourceMounts);
  for (const directory of protectedSourceDirectories) {
    arguments_.push("--remount-ro", directory);
  }
  arguments_.push(
    "--setenv",
    "HOME",
    input.home,
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "ECOSYM_SANDBOX",
    "1",
    "--unsetenv",
    "ECOSYM_BWRAP",
    "--unsetenv",
    "ECOSYM_SANDBOX_EXEC",
    "--chdir",
    input.worktree,
    "--",
    input.executable,
    ...input.childArguments,
  );
  return arguments_;
}

function addMounts(arguments_: string[], mounts: RuntimeMount[]): void {
  for (const mount of mounts) {
    arguments_.push(mount.writable ? "--bind" : "--ro-bind", mount.source, mount.destination);
  }
}

function canCreateRuntimeDirectory(directory: string, hiddenHomeRoot: string): boolean {
  if (directory === hiddenHomeRoot) {
    return false;
  }
  return !["/usr", "/etc", "/proc", "/dev"].some(
    (systemPath) => directory === systemPath || directory.startsWith(`${systemPath}/`),
  );
}

function existingMounts(paths: string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)).filter(existsSync))];
}

function sourceProtectionRoots(directories: string[], home: string): string[] {
  const roots = new Set<string>();
  for (const directory of directories.map((path) => resolve(path))) {
    if (directory.startsWith(`${home}/`)) {
      const firstSegment = directory.slice(home.length + 1).split("/")[0];
      if (firstSegment !== undefined && firstSegment !== "") {
        roots.add(join(home, firstSegment));
      }
    } else {
      roots.add(directory);
    }
  }
  return [...roots].sort();
}

function parentDirectories(paths: string[]): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    let current = resolve(path);
    while (current !== "/") {
      directories.add(current);
      current = dirname(current);
    }
  }
  return [...directories].sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth === 0 ? left.localeCompare(right) : depth;
  });
}
