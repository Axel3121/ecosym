import { tool } from "@opencode-ai/plugin";

import { executeAgentShellCommand } from "../../src/agent-shell.ts";

export default tool({
  description:
    "Run a shell command. Prober commands run with only /tmp writable; other agents retain project writes. OpenCode credentials and prior sessions are unavailable to every shell.",
  args: {
    command: tool.schema.string().describe("Shell command to run"),
    timeout: tool.schema.number().int().positive().max(600_000).optional(),
    workdir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    return executeAgentShellCommand(args, context);
  },
});
