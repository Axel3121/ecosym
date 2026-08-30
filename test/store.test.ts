import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseConnectionConfig } from "../src/config.ts";
import { defaultStateDirectory } from "../src/paths.ts";
import {
  ConnectionConflictError,
  ObservationStore,
  type FactInput,
} from "../src/store.ts";

function connection(id = "source-a", factOwner = "owner-a") {
  return parseConnectionConfig(JSON.parse(parseConnectionConfigInput(id, factOwner)) as unknown);
}

function parseConnectionConfigInput(id: string, factOwner: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    factOwner,
    reader: { type: "jsonl", path: "/unused.jsonl" },
    sourceRecord: {
      identity: [{ scope: "record", path: "id" }],
      retention: "history",
      recordedAt: {
        selector: { scope: "record", path: "at" },
        format: "iso8601",
      },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "example.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
    ],
  });
}

function fact(overrides: Partial<FactInput> = {}): FactInput {
  return {
    epistemicStatus: "observation",
    factOwner: "owner-a",
    kind: "example.value",
    payload: { value: 7 },
    sourceRecordedAt: "2026-08-30T00:00:00.000Z",
    sourceRecordId: "record-a",
    subject: "subject-a",
    ...overrides,
  };
}

function temporaryStore(): { directory: string; store: ObservationStore } {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-store-"));
  return { directory, store: new ObservationStore(directory) };
}

test("uses the required XDG state location", () => {
  assert.equal(
    defaultStateDirectory({ XDG_DATA_HOME: "/var/data" }, "/home/example"),
    "/var/data/ecosym",
  );
  assert.equal(
    defaultStateDirectory({}, "/home/example"),
    "/home/example/.local/share/ecosym",
  );
  assert.throws(() => defaultStateDirectory({ XDG_DATA_HOME: "relative" }, "/home/example"));
});

test("creates a private durable store", () => {
  const { directory, store } = temporaryStore();
  try {
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(store.path).mode & 0o777, 0o600);
    assert.ok(readFileSync(store.path).subarray(0, 15).equals(Buffer.from("SQLite format 3")));
  } finally {
    store.close();
  }
});

test("registers atomically and rejects a different configuration under the same id", () => {
  const { store } = temporaryStore();
  try {
    const first = connection();
    assert.equal(store.register(first, new Date("2026-08-30T00:00:00Z")), "connected");
    assert.equal(store.register(first, new Date("2026-08-30T00:01:00Z")), "unchanged");
    assert.throws(
      () => store.register(connection("source-a", "different-owner")),
      ConnectionConflictError,
    );
    assert.equal(store.getConnection("source-a").configHash, first.hash);
  } finally {
    store.close();
  }
});

test("two processes cannot interleave different configurations under one id", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-register-race-"));
  const gate = join(directory, "start");
  const worker = fileURLToPath(new URL("helpers/register-worker.ts", import.meta.url));
  const configurations = [
    parseConnectionConfigInput("shared-id", "owner-one"),
    parseConnectionConfigInput("shared-id", "owner-two"),
  ];
  const children = configurations.map((config) =>
    spawn(process.execPath, [worker, directory, gate, config], {
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  await Promise.all(children.map((child) => new Promise<void>((resolve) => child.once("spawn", resolve))));
  writeFileSync(gate, "start", { mode: 0o600 });
  const results = await Promise.all(
    children.map(
      (child) =>
        new Promise<{ hash: string; outcome: string }>((resolve, reject) => {
          let stdout = "";
          let stderr = "";
          child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            stdout += chunk;
          });
          child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
            stderr += chunk;
          });
          child.once("error", reject);
          child.once("exit", (code) => {
            if (code !== 0) {
              reject(new Error(`register worker exited ${code}: ${stderr}`));
              return;
            }
            resolve(JSON.parse(stdout) as { hash: string; outcome: string });
          });
        }),
    ),
  );

  assert.deepEqual(
    results.map((result) => result.outcome).sort(),
    ["conflict", "connected"],
  );
  const winner = results.find((result) => result.outcome === "connected");
  const store = new ObservationStore(directory);
  try {
    assert.equal(store.getConnection("shared-id").configHash, winner?.hash);
  } finally {
    store.close();
  }
});

test("disconnecting removes configuration but preserves collected history", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      sink.recordSourceRecord();
      sink.writeFact(fact());
    });

    assert.equal(store.disconnect(parsed.config.id), true);
    assert.equal(store.listConnections().length, 0);
    assert.equal(store.queryObservations().length, 1);
  } finally {
    store.close();
  }
});

test("observation queries exclude claims and preserve late historical points", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      sink.recordSourceRecord();
      sink.writeFact(fact({ sourceRecordedAt: "2026-08-31T00:00:00.000Z", payload: { value: 12 } }));
      sink.writeFact(fact({ sourceRecordedAt: "2026-08-29T00:00:00.000Z", payload: { value: 7 } }));
      sink.writeFact(
        fact({
          epistemicStatus: "claim",
          kind: "example.completion-report",
          payload: { state: "completed" },
        }),
      );
    });

    const observations = store.queryObservations();
    assert.deepEqual(
      observations.map((record) => [record.payload, record.temporalStatus]),
      [
        [{ value: 12 }, "current"],
        [{ value: 7 }, "historical"],
      ],
    );
    assert.equal(store.queryClaims().length, 1);
  } finally {
    store.close();
  }
});

test("a failed collection rolls back all facts before recording unread status", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);

    await assert.rejects(
      store.collect(active, (sink) => {
        sink.recordSourceRecord();
        sink.writeFact(fact());
        throw Object.assign(new Error("fixture failure"), { code: "source_malformed" });
      }),
      { code: "source_malformed" },
    );

    assert.equal(store.countFacts(), 0);
    assert.deepEqual(store.statuses(), [
      {
        connectionId: "source-a",
        lastAttemptAt: store.statuses()[0]?.lastAttemptAt ?? null,
        reason: "failed",
        status: "unread",
      },
    ]);
  } finally {
    store.close();
  }
});

test("a successful empty repeat is quiet rather than unread", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      sink.recordSourceRecord();
      sink.writeFact(fact());
    });
    await store.collect(active, (sink) => {
      sink.recordSourceRecord();
      sink.writeFact(fact());
    });

    assert.equal(store.statuses()[0]?.status, "quiet");
    assert.equal(store.countFacts(), 1);
  } finally {
    store.close();
  }
});
