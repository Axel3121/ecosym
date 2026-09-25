import { readFileSync } from "node:fs";

// Opaque event identities carry ownership, not state or a public failure reason.
// Linux start ticks distinguish PID reuse; elsewhere a live PID fails closed.
export function projectProcessIdentity(pid: number): string {
  if (process.platform !== "linux") return "live";
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  if (fields[0] === "Z" || fields[0] === "X") return "dead";
  return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}.${fields[19]!}`;
}

export function projectOwnerAlive(eventId: string): boolean {
  const match = /^project-owner:(\d+):([^:]+):/.exec(eventId);
  if (match === null) return false;
  const pid = Number(match[1]);
  if (process.platform === "linux") {
    try {
      return projectProcessIdentity(pid) === match[2];
    } catch {
      // Unreadable identity is inconclusive; only ESRCH proves the PID is gone.
    }
  }
  try {
    process.kill(pid, 0);
    return process.platform === "linux" || projectProcessIdentity(pid) === match[2];
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}
