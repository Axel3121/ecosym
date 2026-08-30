import { readFile } from "node:fs/promises";

import { collectConnection } from "./collect.ts";
import { parseConnectionConfig } from "./config.ts";
import {
  CollectionFailedError,
  ObservationStore,
  type QueryOptions,
} from "./store.ts";
import { exitCodeForVerification, verifyAll } from "./verify.ts";

interface CommandResult {
  exitCode: number;
  output: unknown;
}

const result = await run(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(result.output)}\n`);
process.exitCode = result.exitCode;

async function run(arguments_: string[]): Promise<CommandResult> {
  const command = arguments_[0];
  if (command === undefined || command === "help") {
    return {
      exitCode: command === "help" ? 0 : 64,
      output: {
        schemaVersion: 1,
        command: "help",
        outcome: command === "help" ? "success" : "error",
        commands: ["connect", "disconnect", "collect", "status", "query", "verify"],
      },
    };
  }

  let store: ObservationStore | undefined;
  try {
    store = new ObservationStore();
    switch (command) {
      case "connect":
        return await connect(store, arguments_.slice(1));
      case "disconnect":
        return disconnect(store, arguments_.slice(1));
      case "collect":
        return await collect(store, arguments_.slice(1));
      case "status":
        return status(store, arguments_.slice(1));
      case "query":
        return query(store, arguments_.slice(1));
      case "verify":
        return await verify(store, arguments_.slice(1));
      default:
        return invalidArguments(command);
    }
  } catch (error) {
    return {
      exitCode: 1,
      output: {
        schemaVersion: 1,
        command,
        outcome: "error",
        error: safeErrorCode(error),
      },
    };
  } finally {
    store?.close();
  }
}

async function connect(store: ObservationStore, arguments_: string[]): Promise<CommandResult> {
  if (arguments_.length !== 1) {
    return invalidArguments("connect");
  }
  const input = await readConfig(arguments_[0] as string);
  const parsed = parseConnectionConfig(JSON.parse(input) as unknown);
  const outcome = store.register(parsed);
  return {
    exitCode: 0,
    output: {
      schemaVersion: 1,
      command: "connect",
      outcome,
      connectionId: parsed.config.id,
      connectionVersion: parsed.hash,
    },
  };
}

function disconnect(store: ObservationStore, arguments_: string[]): CommandResult {
  if (arguments_.length !== 1) {
    return invalidArguments("disconnect");
  }
  const connectionId = arguments_[0] as string;
  return {
    exitCode: 0,
    output: {
      schemaVersion: 1,
      command: "disconnect",
      outcome: store.disconnect(connectionId) ? "disconnected" : "not-connected",
      connectionId,
    },
  };
}

async function collect(store: ObservationStore, arguments_: string[]): Promise<CommandResult> {
  if (arguments_.length > 1) {
    return invalidArguments("collect");
  }
  const connectionIds =
    arguments_.length === 1
      ? [arguments_[0] as string]
      : store.listConnections().map((connection) => connection.config.id);
  const connections: unknown[] = [];
  let failures = 0;
  for (const connectionId of connectionIds) {
    try {
      const report = await collectConnection(store, connectionId);
      connections.push({
        connectionId,
        outcome: "success",
        sourceRecordsSeen: report.result.sourceRecordsSeen,
        factsSeen: report.result.factsSeen,
        factsAdded: report.result.factsAdded,
      });
    } catch (error) {
      failures += 1;
      connections.push({
        connectionId,
        outcome: "unread",
        reason: error instanceof CollectionFailedError ? error.code : safeErrorCode(error),
      });
    }
  }
  return {
    exitCode: failures === 0 ? 0 : 2,
    output: {
      schemaVersion: 1,
      command: "collect",
      outcome:
        failures === 0 ? "success" : failures === connections.length ? "unread" : "mixed",
      connections,
    },
  };
}

function status(store: ObservationStore, arguments_: string[]): CommandResult {
  if (arguments_.length !== 0) {
    return invalidArguments("status");
  }
  return {
    exitCode: 0,
    output: {
      schemaVersion: 1,
      command: "status",
      outcome: "success",
      connections: store.statuses(),
    },
  };
}

function query(store: ObservationStore, arguments_: string[]): CommandResult {
  const epistemicStatus = arguments_[0];
  if (epistemicStatus !== "observations" && epistemicStatus !== "claims") {
    return invalidArguments("query");
  }
  const options = parseQueryOptions(arguments_.slice(1));
  const records =
    epistemicStatus === "observations"
      ? store.queryObservations(options)
      : store.queryClaims(options);
  return {
    exitCode: 0,
    output: {
      schemaVersion: 1,
      command: "query",
      outcome: "success",
      epistemicStatus: epistemicStatus === "observations" ? "observation" : "claim",
      records,
    },
  };
}

async function verify(store: ObservationStore, arguments_: string[]): Promise<CommandResult> {
  if (arguments_.length !== 0) {
    return invalidArguments("verify");
  }
  const report = await verifyAll(store);
  return {
    exitCode: exitCodeForVerification(report),
    output: { command: "verify", ...report },
  };
}

function parseQueryOptions(arguments_: string[]): QueryOptions {
  const options: QueryOptions = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (value === undefined) {
      throw Object.assign(new Error("query option has no value"), { code: "invalid_arguments" });
    }
    switch (flag) {
      case "--after":
        options.afterId = integerAt(value);
        break;
      case "--connection":
        options.connectionId = value;
        break;
      case "--owner":
        options.factOwner = value;
        break;
      case "--kind":
        options.kind = value;
        break;
      case "--limit":
        options.limit = integerAt(value);
        break;
      case "--subject":
        options.subject = value;
        break;
      default:
        throw Object.assign(new Error("unknown query option"), { code: "invalid_arguments" });
    }
  }
  return options;
}

function integerAt(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw Object.assign(new Error("expected an integer"), { code: "invalid_arguments" });
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw Object.assign(new Error("integer is outside the safe range"), {
      code: "invalid_arguments",
    });
  }
  return result;
}

async function readConfig(path: string): Promise<string> {
  try {
    if (path === "-") {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      return Buffer.concat(chunks).toString("utf8");
    }
    return await readFile(path, "utf8");
  } catch (error) {
    throw Object.assign(new Error("connection input is unreadable", { cause: error }), {
      code: "input_unreadable",
    });
  }
}

function invalidArguments(command: string): CommandResult {
  return {
    exitCode: 64,
    output: {
      schemaVersion: 1,
      command,
      outcome: "error",
      error: "invalid_arguments",
    },
  };
}

function safeErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
  ) {
    return error.code;
  }
  return "internal_error";
}
