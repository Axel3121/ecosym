import { existsSync, lstatSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import type { ConnectionConfig } from "./config.ts";

export interface SandboxSourceMount {
  destination: string;
  source: string;
}

export interface PreparedSandboxSources {
  close(): void;
  directories: string[];
  mounts: SandboxSourceMount[];
  readonlyDirectories: string[];
}

export async function prepareSandboxSources(
  configs: ConnectionConfig[],
  workingDirectory: string,
): Promise<PreparedSandboxSources> {
  const guardians = openSqliteSourceGuardians(configs, workingDirectory);
  const close = (): void => {
    for (const guardian of guardians.splice(0).reverse()) {
      guardian.close();
    }
  };
  try {
    const directories = new Set<string>();
    const mounts = new Map<string, string>();
    const readonlyDirectories = new Set<string>();

    const addFile = (configuredPath: string): void => {
      const destination = absolutePath(configuredPath, workingDirectory);
      directories.add(dirname(destination));
      readonlyDirectories.add(dirname(destination));
      if (!existsSync(destination)) {
        return;
      }
      // lstat, not stat: a bind mount resolves its source on the host at mount
      // time, so a symlink named as a source hands the run whatever it points
      // at. A declared path must be the object it authorises, not a reference
      // that can be repointed at a key or a database nobody declared.
      const declared = lstatSync(destination);
      if (declared.isSymbolicLink()) {
        throw new Error(`Declared source is a symlink: ${destination}`);
      }
      if (!declared.isFile()) {
        throw new Error(`Declared source is not a file: ${destination}`);
      }
      addMount(mounts, destination, destination);
    };

    for (const config of configs) {
      switch (config.reader.type) {
        case "sqlite": {
          addFile(config.reader.path);
          for (const suffix of ["-shm", "-wal"]) {
            const sidecar = `${absolutePath(config.reader.path, workingDirectory)}${suffix}`;
            if (existsSync(sidecar)) {
              addFile(sidecar);
            }
          }
          break;
        }
        case "json": {
          const pattern = absolutePath(config.reader.pathPattern, workingDirectory);
          if (!hasGlobMagic(pattern)) {
            addFile(pattern);
            break;
          }
          const sourceRoot = staticGlobDirectory(pattern);
          if (sourceRoot === "/") {
            throw new Error("A source glob must have a fixed directory prefix");
          }
          directories.add(sourceRoot);
          readonlyDirectories.add(sourceRoot);
          for await (const matchedPath of glob(pattern)) {
            addFile(matchedPath);
          }
          break;
        }
        case "csv":
        case "jsonl":
          addFile(config.reader.path);
          break;
      }
    }

    return {
      close,
      directories: [...directories].sort(),
      mounts: [...mounts]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([destination, source]) => ({ destination, source })),
      readonlyDirectories: [...readonlyDirectories].sort(),
    };
  } catch (error) {
    close();
    throw error;
  }
}

function openSqliteSourceGuardians(
  configs: ConnectionConfig[],
  workingDirectory: string,
): DatabaseSync[] {
  const guardians: DatabaseSync[] = [];
  const openedPaths = new Set<string>();
  for (const config of configs) {
    if (config.reader.type !== "sqlite") {
      continue;
    }
    const path = absolutePath(config.reader.path, workingDirectory);
    if (openedPaths.has(path)) {
      continue;
    }
    openedPaths.add(path);
    const url = pathToFileURL(path);
    url.searchParams.set("mode", "ro");
    let guardian: DatabaseSync;
    try {
      guardian = new DatabaseSync(url, { readOnly: true, timeout: 250 });
    } catch {
      continue;
    }
    try {
      guardian
        .prepare(`SELECT 1 FROM ${quoteIdentifier(config.reader.table)} LIMIT 1`)
        .get();
    } catch {
      // Keep the connection open so collection observes the same source failure.
    }
    guardians.push(guardian);
  }
  return guardians;
}

function absolutePath(path: string, workingDirectory: string): string {
  return isAbsolute(path) ? path : resolve(workingDirectory, path);
}

function addMount(mounts: Map<string, string>, destination: string, source: string): void {
  const existing = mounts.get(destination);
  if (existing !== undefined && existing !== source) {
    throw new Error(`Conflicting source declarations for ${destination}`);
  }
  mounts.set(destination, source);
}

function staticGlobDirectory(pattern: string): string {
  const wildcard = pattern.search(/[!*?@[\]{}]/u);
  if (wildcard === -1) {
    return dirname(pattern);
  }
  const separator = pattern.lastIndexOf("/", wildcard);
  return separator <= 0 ? "/" : pattern.slice(0, separator);
}

function hasGlobMagic(pattern: string): boolean {
  return /[!*?@[\]{}]/u.test(pattern);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
