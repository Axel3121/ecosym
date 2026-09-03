import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { brokerCommit, type CommitResult } from "./commit-broker.ts";

// The channel is a directory, not a socket: the run already has a filesystem
// and nothing else needs to be granted. It writes a request, the servicer
// answers, and the run reads a verdict. Nothing else crosses.
//
//   <channel>/requests/<id>.json    the run writes  (writable to the run)
//   <channel>/replies/<id>.json     the servicer writes  (read-only to it)
//
// One servicer serves one run. A request naming another run's worktree cannot
// arrive here, because the channel it would have to write to is not mounted
// in its sandbox.
export interface ServicerInput {
  channel: string;
  declaredTouches: string[];
  log: string;
  worktree: string;
}

export function channelPaths(channel: string): { replies: string; requests: string } {
  return { replies: join(channel, "replies"), requests: join(channel, "requests") };
}

export function prepareChannel(channel: string): void {
  const { replies, requests } = channelPaths(channel);
  mkdirSync(requests, { recursive: true });
  mkdirSync(replies, { recursive: true });
}

function record(log: string, line: string): void {
  // A boundary nobody can see refusing anything is indistinguishable from one
  // that never fires. Every verdict is written where the operator reads the
  // run, not only the ones that failed.
  try {
    writeFileSync(log, `${line}\n`, { flag: "a" });
  } catch {
    // A log that cannot be written must not stop the boundary from deciding.
  }
}

// The run's order is the contract, and a directory has no order to lend: this
// filesystem returns names in a hash order that differs per directory, so the
// same requests can come back in any sequence. Sorting by name makes the run's
// own numbering decide, which is the only order it can control.
export function nextRequestName(names: string[]): string | undefined {
  return names
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .at(0);
}

export function serviceOnce(input: ServicerInput): CommitResult | undefined {
  const { replies, requests } = channelPaths(input.channel);
  let names: string[];
  try {
    names = readdirSync(requests);
  } catch {
    return undefined;
  }
  const name = nextRequestName(names);
  if (name === undefined) {
    return undefined;
  }
  const path = join(requests, name);

  // Claim the request by moving it out of the run's reach before reading it:
  // the bytes cannot change between the check and the decision.
  const claimed = `${path}.claimed`;
  try {
    renameSync(path, claimed);
  } catch {
    return undefined;
  }

  let result: CommitResult;
  try {
    const raw = readFileSync(claimed, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    result = brokerCommit({
      declaredTouches: input.declaredTouches,
      request: parsed,
      worktree: input.worktree,
    });
  } finally {
    rmSync(claimed, { force: true });
  }

  const reason = result.reason === undefined ? "" : `: ${result.reason}`;
  record(input.log, `commit ${result.outcome}${reason}`);

  // The reply carries the verdict and nothing else — no git stdout, no stderr,
  // no diff. Everything on this path is a channel back into the sandbox.
  writeFileSync(
    join(replies, name),
    `${JSON.stringify({ outcome: result.outcome, reason: result.reason })}\n`,
  );
  return result;
}

export async function serviceUntilGone(
  input: ServicerInput,
  isRunning: () => boolean,
  intervalMs = 500,
): Promise<void> {
  prepareChannel(input.channel);
  while (isRunning()) {
    while (serviceOnce(input) !== undefined) {
      // Drain: a run that commits twice in a row should not wait an interval
      // between them.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  // One last pass: work finished between the final check and the exit.
  while (serviceOnce(input) !== undefined) {
    /* drain */
  }
}

export function readDeclaredTouches(declarationPath: string): string[] {
  if (!existsSync(declarationPath)) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(declarationPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }
    const touches = (parsed as Record<string, unknown>)["touches"];
    if (!Array.isArray(touches)) {
      return [];
    }
    return touches.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}
