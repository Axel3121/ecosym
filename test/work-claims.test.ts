import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const expiredAt = "2000-01-01T00:00:00.000Z";

interface CliResult {
  code: number;
  output: Record<string, unknown>;
  stderr: string;
}

interface ClaimRow {
  claimId: string;
  civilizationId: string;
  resourceId: string;
  claimedBy: string;
  claimedAt: string;
  expiresAt: string;
}

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-work-claims-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const xdgDataHome = join(directory, "data");
  const configPath = join(directory, "civilization.json");
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    name: "Engineering",
    domain: "the software this person builds",
    sources: ["cli-source"],
    mayActAlone: ["read.source"],
    mustEscalate: ["spend.money"],
  }));
  return {
    directory,
    run: (arguments_: string[]) => runCli(arguments_, xdgDataHome),
    async found() {
      const result = await runCli(["found", configPath], xdgDataHome);
      assert.equal(result.code, 0, JSON.stringify(result));
      assert.equal(result.output.outcome, "founded");
      assert.equal(typeof result.output.civilizationId, "string");
      return result.output.civilizationId as string;
    },
    database<T>(readOnly: boolean, inspect: (database: DatabaseSync) => T): T {
      const database = new DatabaseSync(join(xdgDataHome, "ecosym", "observations.sqlite"), {
        readOnly,
      });
      try {
        return inspect(database);
      } finally {
        database.close();
      }
    },
  };
}

function success(result: CliResult, command: string, outcome: string) {
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.output.schemaVersion, 1);
  assert.equal(result.output.command, command);
  assert.equal(result.output.outcome, outcome);
}

function claimId(result: CliResult): string {
  success(result, "claim", "claimed");
  assert.equal(typeof result.output.claimId, "string");
  assert.ok((result.output.claimId as string).length > 0);
  return result.output.claimId as string;
}

function claims(result: CliResult): ClaimRow[] {
  success(result, "claims", "success");
  assert.ok(Array.isArray(result.output.claims));
  return result.output.claims as ClaimRow[];
}

test("claim returns an identifier and a persisted thirty-minute lease", async (t) => {
  const f = fixture(t);
  const civilizationId = await f.found();
  const result = await f.run(["claim", civilizationId, "src/store.ts", "agent:one"]);
  const id = claimId(result);
  assert.equal(result.output.civilizationId, civilizationId);
  assert.equal(result.output.resourceId, "src/store.ts");
  const rows = claims(await f.run(["claims"]));
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.deepEqual(row, {
    claimId: id,
    civilizationId: civilizationId,
    resourceId: "src/store.ts",
    claimedBy: "agent:one",
    claimedAt: row.claimedAt,
    expiresAt: result.output.expiresAt,
  });
  assert.equal(Date.parse(row.expiresAt) - Date.parse(row.claimedAt), 30 * 60 * 1000);
});

test("a live same-resource claim conflicts but a different resource is available", async (t) => {
  const f = fixture(t);
  const civilizationId = await f.found();
  const first = claimId(await f.run(["claim", civilizationId, "resource:a", "agent:one"]));
  const conflict = await f.run(["claim", civilizationId, "resource:a", "agent:two"]);
  assert.equal(conflict.code, 1);
  assert.equal(conflict.output.error, "work_claim_conflict");
  const second = claimId(await f.run(["claim", civilizationId, "resource:b", "agent:two"]));
  assert.notEqual(second, first);
  assert.deepEqual(claims(await f.run(["claims"])).map((row) => row.claimId), [first, second]);
});

test("claim refuses unknown and dissolved civilizations", async (t) => {
  const f = fixture(t);
  const unknown = await f.run(["claim", "civilization:absent", "resource:a", "agent:one"]);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.output.error, "civilization_not_found");
  const civilizationId = await f.found();
  success(await f.run(["dissolve", civilizationId]), "dissolve", "dissolved");
  const dissolved = await f.run(["claim", civilizationId, "resource:a", "agent:one"]);
  assert.equal(dissolved.code, 1);
  assert.equal(dissolved.output.error, "civilization_dissolved");
  assert.deepEqual(claims(await f.run(["claims"])), []);
});

test("release frees the resource and closed or unknown releases are not-open", async (t) => {
  const f = fixture(t);
  const civilizationId = await f.found();
  const id = claimId(await f.run(["claim", civilizationId, "resource:a", "agent:one"]));
  const released = await f.run(["release", id]);
  success(released, "release", "released");
  assert.equal(released.output.claimId, id);
  f.database(true, (database) => {
    const row = database.prepare("SELECT status, closed_at FROM work_claims WHERE claim_id = ?")
      .get(id)!;
    assert.equal(row.status, "closed");
    assert.ok(Number.isFinite(Date.parse(row.closed_at as string)));
  });
  for (const unavailable of [id, "claim:absent"]) {
    const result = await f.run(["release", unavailable]);
    success(result, "release", "not-open");
    assert.equal(result.output.claimId, unavailable);
  }
  const replacement = claimId(await f.run(["claim", civilizationId, "resource:a", "agent:two"]));
  assert.notEqual(replacement, id);
  assert.deepEqual(claims(await f.run(["claims"])).map((row) => row.claimId), [replacement]);
});

test("release refuses an expired lease even while its stored status is open", async (t) => {
  const f = fixture(t);
  const civilizationId = await f.found();
  const id = claimId(await f.run(["claim", civilizationId, "resource:a", "agent:one"]));
  f.database(false, (database) => {
    database.prepare("UPDATE work_claims SET expires_at = ? WHERE claim_id = ?").run(expiredAt, id);
  });
  const result = await f.run(["release", id]);
  success(result, "release", "not-open");
  assert.equal(result.output.claimId, id);
  f.database(true, (database) => {
    const row = database.prepare("SELECT status, closed_at FROM work_claims WHERE claim_id = ?")
      .get(id)!;
    assert.equal(row.status, "open");
    assert.equal(row.closed_at, null);
  });
});

test("heartbeat extends a live lease", async (t) => {
  const f = fixture(t);
  const civilizationId = await f.found();
  const id = claimId(await f.run(["claim", civilizationId, "resource:a", "agent:one"]));
  const oldExpiry = new Date(Date.now() + 60_000).toISOString();
  f.database(false, (database) => {
    database.prepare("UPDATE work_claims SET expires_at = ? WHERE claim_id = ?").run(oldExpiry, id);
  });
  const result = await f.run(["heartbeat", id]);
  success(result, "heartbeat", "extended");
  assert.equal(result.output.claimId, id);
  const row = claims(await f.run(["claims"]))[0]!;
  assert.equal(row.claimId, id);
  assert.ok(Date.parse(row.expiresAt) > Date.parse(oldExpiry));
});

test("heartbeat refuses a claim after its civilization is dissolved", async (t) => {
  const f = fixture(t);
  const civilizationId = await f.found();
  const id = claimId(await f.run(["claim", civilizationId, "resource:a", "agent:one"]));
  success(await f.run(["dissolve", civilizationId]), "dissolve", "dissolved");
  success(await f.run(["heartbeat", id]), "heartbeat", "not-open");
});

test("heartbeat refuses an expired lease even while its stored status is open", async (t) => {
  const f = fixture(t);
  const civilizationId = await f.found();
  const id = claimId(await f.run(["claim", civilizationId, "resource:a", "agent:one"]));
  f.database(false, (database) => {
    database.prepare("UPDATE work_claims SET expires_at = ? WHERE claim_id = ?").run(expiredAt, id);
  });
  const result = await f.run(["heartbeat", id]);
  success(result, "heartbeat", "not-open");
  assert.equal(result.output.claimId, id);
  f.database(true, (database) => {
    const row = database.prepare("SELECT status, expires_at FROM work_claims WHERE claim_id = ?")
      .get(id)!;
    assert.equal(row.status, "open");
    assert.equal(row.expires_at, expiredAt);
  });
});

test("heartbeat on closed and unknown claims returns not-open", async (t) => {
  const f = fixture(t);
  const civilizationId = await f.found();
  const id = claimId(await f.run(["claim", civilizationId, "resource:a", "agent:one"]));
  success(await f.run(["release", id]), "release", "released");
  for (const unavailable of [id, "claim:absent"]) {
    const result = await f.run(["heartbeat", unavailable]);
    success(result, "heartbeat", "not-open");
    assert.equal(result.output.claimId, unavailable);
  }
  assert.deepEqual(claims(await f.run(["claims"])), []);
});

test("claim lazily expires only the matching civilization and resource", async (t) => {
  const f = fixture(t);
  const civilizationId = await f.found();
  const otherCivilization = await f.found();
  const id = claimId(await f.run(["claim", civilizationId, "resource:a", "agent:one"]));
  const otherResource = claimId(await f.run(["claim", civilizationId, "resource:b", "agent:one"]));
  const otherClaim = claimId(await f.run(["claim", otherCivilization, "resource:a", "agent:two"]));
  f.database(false, (database) => {
    database.prepare("UPDATE work_claims SET expires_at = ?").run(expiredAt);
  });
  const replacement = claimId(await f.run(["claim", civilizationId, "resource:a", "agent:two"]));
  assert.notEqual(replacement, id);
  f.database(true, (database) => {
    const status = database.prepare("SELECT status FROM work_claims WHERE claim_id = ?");
    assert.equal(status.get(id)!.status, "expired");
    assert.equal(status.get(otherResource)!.status, "open");
    assert.equal(status.get(otherClaim)!.status, "open");
  });
  success(await f.run(["heartbeat", id]), "heartbeat", "not-open");
  assert.deepEqual(claims(await f.run(["claims"])).map((row) => row.claimId), [replacement]);
});

test("claims excludes closed and elapsed leases without mutating elapsed open rows", async (t) => {
  const f = fixture(t);
  const civilizationId = await f.found();
  const live = claimId(await f.run(["claim", civilizationId, "resource:live", "agent:one"]));
  const elapsed = claimId(await f.run(["claim", civilizationId, "resource:elapsed", "agent:two"]));
  const closed = claimId(await f.run(["claim", civilizationId, "resource:closed", "agent:three"]));
  success(await f.run(["release", closed]), "release", "released");
  f.database(false, (database) => {
    database.prepare("UPDATE work_claims SET expires_at = ? WHERE claim_id = ?").run(expiredAt, elapsed);
  });
  for (const args of [["claims"], ["claims", civilizationId]]) {
    assert.deepEqual(claims(await f.run(args)).map((row) => row.claimId), [live]);
  }
  f.database(true, (database) => {
    assert.equal(database.prepare("SELECT status FROM work_claims WHERE claim_id = ?")
      .get(elapsed)!.status, "open");
  });
});

test("claims filters civilizations while allowing the same resource in each", async (t) => {
  const f = fixture(t);
  const first = await f.found();
  const second = await f.found();
  const one = claimId(await f.run(["claim", first, "resource:a", "agent:one"]));
  const two = claimId(await f.run(["claim", second, "resource:a", "agent:two"]));
  assert.deepEqual(claims(await f.run(["claims"])).map((row) => row.claimId), [one, two]);
  for (const [civilizationId, id] of [[first, one], [second, two]] as const) {
    const rows = claims(await f.run(["claims", civilizationId]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.claimId, id);
    assert.equal(rows[0]!.civilizationId, civilizationId);
  }
});

test("forget-civilization cascades claims after export and preview and preserves unrelated claims", async (t) => {
  const f = fixture(t);
  const civilizationId = await f.found();
  const otherCivilization = await f.found();
  const id = claimId(await f.run(["claim", civilizationId, "resource:a", "agent:one"]));
  const other = claimId(await f.run(["claim", otherCivilization, "resource:a", "agent:two"]));
  success(await f.run(["dissolve", civilizationId]), "dissolve", "dissolved");
  const exported = await f.run(["export", join(f.directory, "owned-state.json")]);
  assert.equal(exported.code, 0, JSON.stringify(exported));
  assert.equal(typeof exported.output.digest, "string");
  const preview = await f.run(["forget-civilization", civilizationId, "--by", "operator:test"]);
  success(preview, "forget-civilization", "confirmation-required");
  assert.match(preview.output.consequence as string, /work claims/i);
  assert.equal(typeof preview.output.confirmationToken, "string");
  const forgotten = await f.run([
    "forget-civilization", civilizationId, "--by", "operator:test",
    "--export-digest", exported.output.digest as string,
    "--confirm", preview.output.confirmationToken as string,
  ]);
  success(forgotten, "forget-civilization", "forgotten");
  f.database(true, (database) => {
    assert.equal(database.prepare("SELECT claim_id FROM work_claims WHERE claim_id = ?").get(id), undefined);
    assert.equal(database.prepare("SELECT civilization_id FROM civilizations WHERE civilization_id = ?")
      .get(civilizationId), undefined);
    assert.deepEqual(database.prepare("SELECT claim_id FROM work_claims").all()
      .map((row) => row.claim_id), [other]);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  });
});

test("concurrent same-resource claim subprocesses produce exactly one winner", async (t) => {
  const f = fixture(t);
  const civilizationId = await f.found();
  const results = await Promise.all(Array.from({ length: 4 }, (_, index) =>
    f.run(["claim", civilizationId, "resource:contended", `agent:${index}`])));
  const winners = results.filter((result) => result.code === 0);
  assert.equal(winners.length, 1, JSON.stringify(results));
  const winner = claimId(winners[0]!);
  for (const loser of results.filter((result) => result.code !== 0)) {
    assert.equal(loser.code, 1, JSON.stringify(loser));
    assert.equal(loser.output.error, "work_claim_conflict");
  }
  assert.deepEqual(claims(await f.run(["claims"])).map((row) => row.claimId), [winner]);
  f.database(true, (database) => {
    assert.equal(database.prepare("SELECT count(*) AS count FROM work_claims").get()!.count, 1);
  });
});

test("help lists all four work claim commands", async (t) => {
  const f = fixture(t);
  const result = await f.run(["help"]);
  success(result, "help", "success");
  for (const command of ["claim", "heartbeat", "release", "claims"]) {
    assert.ok((result.output.commands as string[]).includes(command), command);
  }
});

for (const arguments_ of [
  ["claim"], ["claim", "civilization:a"], ["claim", "civilization:a", "resource:a"],
  ["claim", "civilization:a", "resource:a", "agent:one", "extra"],
  ["claim", "civilization:a", "resource:a", "agent:one", "--ttl", "1"],
  ["heartbeat"], ["heartbeat", "claim:a", "extra"],
  ["release"], ["release", "claim:a", "extra"],
  ["claims", "civilization:a", "extra"],
]) {
  test(`invalid work claim argument count: ${arguments_.join(" ")}`, async (t) => {
    const f = fixture(t);
    const result = await f.run(arguments_);
    assert.equal(result.code, 64, JSON.stringify(result));
    assert.equal(result.output.command, arguments_[0]);
    assert.equal(result.output.outcome, "error");
    assert.equal(result.output.error, "invalid_arguments");
  });
}

for (const version of [0, 9, 13, 14]) {
  test(`${version === 0 ? "fresh" : `schema ${version}`} stores gain usable work claims at schema 17`, async (t) => {
    const f = fixture(t);
    let civilizationId: string;
    if (version === 9) {
      assert.equal((await f.run(["status"])).code, 0);
      f.database(false, (database) => {
        // Reconstruct the pre-retirement attempt table and remove later ledgers.
        database.exec(`
          DROP TABLE IF EXISTS work_claims;
          DROP TABLE civilization_forget_records;
          DROP TABLE mandate_revisions;
          DROP TABLE civilizations;
          DROP TABLE owned_state_exports;
          DROP TABLE forget_records;
          DROP TABLE confirmation_previews;
          DROP TABLE collection_attempt_retirements;
          DROP TABLE collection_attempts;
          CREATE TABLE collection_attempts (
            attempt_order INTEGER PRIMARY KEY,
            attempt_id TEXT NOT NULL UNIQUE,
            connection_id TEXT NOT NULL,
            config_hash TEXT NOT NULL,
            activation_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            outcome TEXT NOT NULL CHECK (outcome IN ('running', 'success', 'failed', 'skipped')),
            source_records_seen INTEGER NOT NULL CHECK (source_records_seen >= 0),
            facts_seen INTEGER NOT NULL CHECK (facts_seen >= 0),
            facts_added INTEGER NOT NULL CHECK (facts_added >= 0),
            facts_changed INTEGER NOT NULL CHECK (facts_changed >= 0),
            failure_code TEXT,
            FOREIGN KEY (connection_id, config_hash)
              REFERENCES connection_versions(connection_id, config_hash),
            CHECK (
              (outcome = 'running' AND completed_at IS NULL) OR
              (outcome <> 'running' AND completed_at IS NOT NULL)
            ),
            CHECK (
              (outcome IN ('failed', 'skipped') AND failure_code IS NOT NULL) OR
              (outcome IN ('running', 'success') AND failure_code IS NULL)
            )
          ) STRICT;
          CREATE INDEX collection_attempts_latest
            ON collection_attempts(connection_id, config_hash, activation_id, attempt_order DESC);
          PRAGMA user_version = 9;
        `);
        assert.equal(database.prepare("PRAGMA user_version").get()!.user_version, 9);
      });
      assert.deepEqual(claims(await f.run(["claims"])), []);
      civilizationId = await f.found();
    } else if (version === 0) {
      assert.deepEqual(claims(await f.run(["claims"])), []);
      civilizationId = await f.found();
    } else {
      civilizationId = await f.found();
      f.database(false, (database) => {
        database.exec("DROP TABLE IF EXISTS work_claims");
        if (version === 13) {
          database.exec(`
            ALTER TABLE confirmation_previews RENAME TO confirmation_previews_v14;
            CREATE TABLE confirmation_previews (
              confirmation_token_hash TEXT NOT NULL PRIMARY KEY,
              operation TEXT NOT NULL
                CHECK (operation IN ('resolve-record-index', 'retire-collection-attempt', 'forget')),
              arguments_json TEXT NOT NULL,
              state_fingerprint TEXT NOT NULL,
              issued_at TEXT NOT NULL,
              consumed_at TEXT
            ) STRICT;
            INSERT INTO confirmation_previews SELECT * FROM confirmation_previews_v14;
            DROP TABLE confirmation_previews_v14;
            ALTER TABLE owned_state_exports DROP COLUMN civilization_inventories_json;
            DROP TABLE civilization_forget_records;
          `);
        }
        database.exec(`PRAGMA user_version = ${version}`);
        assert.equal(database.prepare("PRAGMA user_version").get()!.user_version, version);
        assert.equal(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'work_claims'").get(), undefined);
      });
      assert.deepEqual(claims(await f.run(["claims"])), []);
    }
    f.database(true, (database) => {
      assert.equal(database.prepare("PRAGMA user_version").get()!.user_version, 17);
      const index = database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'work_claims_open_resource'").get();
      assert.ok(index);
      assert.match(index.sql as string, /UNIQUE INDEX/i);
      assert.match(index.sql as string, /WHERE\s+status\s*=\s*'open'/i);
      const foreignKey = database.prepare("PRAGMA foreign_key_list(work_claims)").all()
        .find((row) => row.from === "civilization_id");
      assert.equal(foreignKey?.table, "civilizations");
      assert.equal(foreignKey?.on_delete, "CASCADE");
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    });
    success(await f.run(["resolve-authority", civilizationId]), "resolve-authority", "resolved");
    const id = claimId(await f.run(["claim", civilizationId, "resource:a", "agent:one"]));
    assert.deepEqual(claims(await f.run(["claims", civilizationId])).map((row) => row.claimId), [id]);
    const conflict = await f.run(["claim", civilizationId, "resource:a", "agent:two"]);
    assert.equal(conflict.code, 1);
    assert.equal(conflict.output.error, "work_claim_conflict");
  });
}

async function runCli(arguments_: string[], xdgDataHome: string): Promise<CliResult> {
  const child = spawn(process.execPath, [cli, ...arguments_], {
    env: { ...process.env, XDG_DATA_HOME: xdgDataHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolve(exitCode ?? -1));
  });
  assert.ok(stdout.trim(), `CLI ${arguments_.join(" ")} exited ${code}: ${stderr}`);
  return { code, output: JSON.parse(stdout) as Record<string, unknown>, stderr };
}
