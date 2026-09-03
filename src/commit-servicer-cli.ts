import { spawnSync } from "node:child_process";
import { argv, exit } from "node:process";

import { prepareChannel, readDeclaredTouches, serviceUntilGone } from "./commit-servicer.ts";

const [unit, worktree, channel, log, declaration] = argv.slice(2);

if (!unit || !worktree || !channel || !log || !declaration) {
  console.error("usage: commit-servicer <unit> <worktree> <channel> <log> <declaration>");
  exit(2);
}

prepareChannel(channel);

serviceUntilGone({
  channel,
  declaredTouches: readDeclaredTouches(declaration),
  isRunning: () => {
    try {
      return spawnSync("systemctl", ["--user", "is-active", "--quiet", unit]).status === 0;
    } catch {
      return false;
    }
  },
  log,
  worktree,
});
