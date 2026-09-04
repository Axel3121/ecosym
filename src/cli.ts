import { randomUUID } from "node:crypto";
import { chmodSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { collectConnection } from "./collect.ts";
import { parseConnectionConfig } from "./config.ts";
import { parseCivilizationConfig, parseMandateConfig } from "./institution.ts";
import type { OwnedStateExport } from "./owned-state.ts";
import {
  CollectionFailedError,
  isSqliteContentionError,
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
        commands: [
          "connect",
          "disconnect",
          "found",
          "redraw",
          "dissolve",
          "resolve-authority",
          "collect",
          "status",
          "query",
          "verify",
          "resolve-record-index",
          "retire-collection-attempt",
          "export",
          "forget",
        ],
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
      case "found":
        return await found(store, arguments_.slice(1));
      case "redraw":
        return await redraw(store, arguments_.slice(1));
      case "dissolve":
        return dissolve(store, arguments_.slice(1));
      case "resolve-authority":
        return resolveAuthority(store, arguments_.slice(1));
      case "collect":
        return await collect(store, arguments_.slice(1));
      case "status":
        return status(store, arguments_.slice(1));
      case "query":
        return query(store, arguments_.slice(1));
      case "verify":
        return await verify(store, arguments_.slice(1));
      case "resolve-record-index":
        return await resolveRecordIndex(store, arguments_.slice(1));
      case "retire-collection-attempt":
        return await retireCollectionAttempt(store, arguments_.slice(1));
      case "export":
        return exportOwnedState(store, arguments_.slice(1));
      case "forget":
        return await forget(store, arguments_.slice(1));
      default:
        return invalidArguments(command);
    }
  } catch (error) {
    const errorCode = safeErrorCode(error);
    if (errorCode === "invalid_arguments") {
      return invalidArguments(command);
    }
    return {
      exitCode: 1,
      output: {
        schemaVersion: 1,
        command,
        outcome: "error",
        error: errorCode,
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
  let decoded: unknown;
  try {
    decoded = JSON.parse(input) as unknown;
  } catch {
    throw Object.assign(new Error("connection input is not JSON"), {
      code: "invalid_config",
    });
  }
  const parsed = parseConnectionConfig(decoded);
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

async function found(store: ObservationStore, arguments_: string[]): Promise<CommandResult> {
  if (arguments_.length !== 1) {
    return invalidArguments("found");
  }
  const parsed = parseCivilizationConfig(await readInstitutionInput(arguments_[0] as string));
  const founded = store.foundCivilization(parsed);
  return {
    exitCode: 0,
    output: {
      schemaVersion: 1,
      command: "found",
      outcome: "founded",
      ...founded,
    },
  };
}

async function redraw(store: ObservationStore, arguments_: string[]): Promise<CommandResult> {
  if (arguments_.length !== 2) {
    return invalidArguments("redraw");
  }
  const civilizationId = arguments_[0] as string;
  const parsed = parseMandateConfig(await readInstitutionInput(arguments_[1] as string));
  const mandateRevision = store.redrawMandate(civilizationId, parsed);
  return {
    exitCode: 0,
    output: {
      schemaVersion: 1,
      command: "redraw",
      outcome: "redrawn",
      civilizationId,
      mandateRevision,
    },
  };
}

async function readInstitutionInput(path: string): Promise<unknown> {
  const input = await readConfig(path);
  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw Object.assign(new Error("mandate input is not JSON"), {
      code: "invalid_mandate",
    });
  }
}

function dissolve(store: ObservationStore, arguments_: string[]): CommandResult {
  if (arguments_.length !== 1) {
    return invalidArguments("dissolve");
  }
  const civilizationId = arguments_[0] as string;
  return {
    exitCode: 0,
    output: {
      schemaVersion: 1,
      command: "dissolve",
      outcome: store.dissolveCivilization(civilizationId) ? "dissolved" : "not-founded",
      civilizationId,
    },
  };
}

function resolveAuthority(store: ObservationStore, arguments_: string[]): CommandResult {
  if (arguments_.length !== 1) {
    return invalidArguments("resolve-authority");
  }
  const resolved = store.resolveAuthorityContext(arguments_[0] as string);
  return {
    exitCode: 0,
    output: {
      schemaVersion: 1,
      command: "resolve-authority",
      outcome: "resolved",
      authorityContext: resolved.authorityContext,
      mandate: resolved.mandate,
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
        factsChanged: report.result.factsChanged,
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
      collectionAttempts: store.collectionAttempts(),
      collectionAttemptRetirements: store.collectionAttemptRetirements(),
      recordIndexModeResolutions: store.recordIndexModeResolutions(),
      forgetRecords: store.forgetRecords(),
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

async function resolveRecordIndex(
  store: ObservationStore,
  arguments_: string[],
): Promise<CommandResult> {
  const connectionId = arguments_[0];
  const connectionVersion = arguments_[1];
  const recordIndexMode = arguments_[2];
  if (
    connectionId === undefined ||
    connectionVersion === undefined ||
    (recordIndexMode !== "physical-line" && recordIndexMode !== "record-ordinal")
  ) {
    return invalidArguments("resolve-record-index");
  }
  if (arguments_.length === 3) {
    const plan = store.planRecordIndexModeResolution(
      connectionId,
      connectionVersion,
      recordIndexMode,
    );
    return {
      exitCode: 0,
      output: {
        schemaVersion: 1,
        command: "resolve-record-index",
        outcome: "confirmation-required",
        ...plan,
        consequence:
          `This changes how the ${plan.factsAffected} stored facts listed in ` +
          "affectedFactIds are interpreted and changes no fact rows. " +
          `Future collection uses ${recordIndexMode}.`,
        recoverability:
          "A later confirmed resolution can change the mode again; facts collected under either choice remain recorded.",
      },
    };
  }
  const confirmationToken = arguments_[4];
  if (
    arguments_.length !== 5 ||
    arguments_[3] !== "--confirm" ||
    confirmationToken === undefined
  ) {
    return invalidArguments("resolve-record-index");
  }
  const resolution = await store.resolveRecordIndexMode(
    connectionId,
    connectionVersion,
    recordIndexMode,
    confirmationToken,
  );
  return {
    exitCode: 0,
    output: {
      schemaVersion: 1,
      command: "resolve-record-index",
      outcome: "resolved",
      ...resolution,
    },
  };
}

async function retireCollectionAttempt(
  store: ObservationStore,
  arguments_: string[],
): Promise<CommandResult> {
  const attemptId = arguments_[0];
  const retiredBy = arguments_[2];
  if (
    attemptId === undefined ||
    retiredBy === undefined ||
    arguments_[1] !== "--by"
  ) {
    return invalidArguments("retire-collection-attempt");
  }
  if (arguments_.length === 3) {
    const plan = store.planCollectionAttemptRetirement(attemptId, retiredBy);
    return {
      exitCode: 0,
      output: {
        schemaVersion: 1,
        command: "retire-collection-attempt",
        outcome: "confirmation-required",
        ...plan,
        consequence:
          "This records the named actor's explicit decision that this attempt is abandoned, changes its outcome to retired, and prevents it from committing facts if its process is still alive.",
        recoverability:
          "A retired attempt remains retired and auditable; start a new collection attempt to collect facts again.",
      },
    };
  }
  const confirmationToken = arguments_[4];
  if (
    arguments_.length !== 5 ||
    arguments_[3] !== "--confirm" ||
    confirmationToken === undefined
  ) {
    return invalidArguments("retire-collection-attempt");
  }
  const retirement = await store.retireCollectionAttempt(
    attemptId,
    retiredBy,
    confirmationToken,
  );
  return {
    exitCode: 0,
    output: {
      schemaVersion: 1,
      command: "retire-collection-attempt",
      outcome: "retired",
      ...retirement,
    },
  };
}

function exportOwnedState(
  store: ObservationStore,
  arguments_: string[],
): CommandResult {
  const destination = arguments_[0];
  if (arguments_.length !== 1 || destination === undefined) {
    return invalidArguments("export");
  }
  const exported: OwnedStateExport = store.exportOwnedState(new Date(), (result) => {
    const temporaryPath = join(
      dirname(destination),
      `.${basename(destination)}.ecosym-${randomUUID()}.tmp`,
    );
    try {
      writeFileSync(temporaryPath, result.bytes, { flag: "wx", mode: 0o600 });
      chmodSync(temporaryPath, 0o600);
      renameSync(temporaryPath, destination);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The temporary file may not have been created or may already have been renamed.
      }
      throw Object.assign(new Error("export destination is unwritable", { cause: error }), {
        code: "export_unwritable",
      });
    }
  });
  return {
    exitCode: 0,
    output: {
      schemaVersion: 1,
      command: "export",
      outcome: "exported",
      destination,
      digest: exported.digest,
      exportedAt: exported.bundle.exportedAt,
      counts: exported.counts,
    },
  };
}

async function forget(
  store: ObservationStore,
  arguments_: string[],
): Promise<CommandResult> {
  const connectionId = arguments_[0];
  const forgottenBy = arguments_[2];
  if (
    connectionId === undefined ||
    forgottenBy === undefined ||
    arguments_[1] !== "--by"
  ) {
    return invalidArguments("forget");
  }
  if (arguments_.length === 3) {
    const plan = store.planForget(connectionId, forgottenBy);
    return {
      exitCode: 0,
      output: {
        schemaVersion: 1,
        command: "forget",
        outcome: "confirmation-required",
        ...plan,
        recoverability:
          "The presented export is evidence of the state before deletion. Ecosym has no import or restore path for it.",
      },
    };
  }
  const exportDigest = arguments_[4];
  const confirmationToken = arguments_[6];
  if (
    arguments_.length !== 7 ||
    arguments_[3] !== "--export-digest" ||
    exportDigest === undefined ||
    arguments_[5] !== "--confirm" ||
    confirmationToken === undefined
  ) {
    return invalidArguments("forget");
  }
  const record = await store.forget(
    connectionId,
    forgottenBy,
    exportDigest,
    confirmationToken,
  );
  return {
    exitCode: 0,
    output: {
      schemaVersion: 1,
      command: "forget",
      outcome: "forgotten",
      ...record,
    },
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
        if (options.limit < 1 || options.limit > 1_000) {
          throw Object.assign(new Error("query limit is outside the supported range"), {
            code: "invalid_arguments",
          });
        }
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
  if (isSqliteContentionError(error)) {
    return "store_contention";
  }
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
