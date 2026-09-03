import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  channelPaths,
  nextRequestName,
  prepareChannel,
  readDeclaredTouches,
  serviceOnce,
  serviceUntilGone,
} from "../src/commit-servicer.ts";

const GIT_ENVIRONMENT = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  HOME: "/nonexistent",
  PATH: "/usr/bin:/bin",
};

function git(worktree: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: worktree,
    encoding: "utf8",
    env: GIT_ENVIRONMENT,
  });
}

interface Run {
  channel: string;
  log: string;
  worktree: string;
}

function fixture(): Run {
  const root = mkdtempSync(join(tmpdir(), "ecosym-servicer-"));
  const worktree = join(root, "work");
  const channel = join(root, "channel");
  mkdirSync(worktree);
  git(worktree, "init", "-q", ".");
  git(worktree, "config", "user.email", "run@example.test");
  git(worktree, "config", "user.name", "Run");
  writeFileSync(join(worktree, "declared.txt"), "start\n");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-qm", "init");
  prepareChannel(channel);
  return { channel, log: join(root, "run.log"), worktree };
}

function request(run: Run, id: string, body: unknown): void {
  writeFileSync(join(channelPaths(run.channel).requests, `${id}.json`), JSON.stringify(body));
}

function reply(run: Run, id: string): { outcome: string; reason?: string } {
  const path = join(channelPaths(run.channel).replies, `${id}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as { outcome: string; reason?: string };
}

function cleanup(run: Run): void {
  rmSync(join(run.worktree, ".."), { force: true, recursive: true });
}

test("a request on the channel produces a commit and a verdict", () => {
  const run = fixture();
  try {
    writeFileSync(join(run.worktree, "declared.txt"), "changed\n");
    request(run, "0001", { message: "the run's own message" });

    const result = serviceOnce({
      channel: run.channel,
      declaredTouches: ["declared.txt"],
      log: run.log,
      worktree: run.worktree,
    });

    assert.equal(result?.outcome, "OK", result?.reason);
    assert.equal(reply(run, "0001").outcome, "OK");
    assert.equal(git(run.worktree, "log", "--oneline").trim().split("\n").length, 2);
  } finally {
    cleanup(run);
  }
});

test("the reply carries a verdict and nothing else", () => {
  const run = fixture();
  try {
    writeFileSync(join(run.worktree, "declared.txt"), "changed\n");
    request(run, "0001", { message: "commit" });
    serviceOnce({
      channel: run.channel,
      declaredTouches: ["declared.txt"],
      log: run.log,
      worktree: run.worktree,
    });

    const raw = readFileSync(join(channelPaths(run.channel).replies, "0001.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(parsed).filter((key) => parsed[key] !== undefined),
      ["outcome"],
      "the reply leaked something beyond the verdict",
    );
    assert.ok(!raw.includes("git"), "git output reached the run");
    assert.ok(!raw.includes(run.worktree), "a host path reached the run");
  } finally {
    cleanup(run);
  }
});

test("a refusal is recorded where the operator reads the run", () => {
  const run = fixture();
  try {
    writeFileSync(join(run.worktree, "other.txt"), "changed\n");
    request(run, "0001", { message: "take it", paths: ["other.txt"] });

    const result = serviceOnce({
      channel: run.channel,
      declaredTouches: ["declared.txt"],
      log: run.log,
      worktree: run.worktree,
    });

    assert.equal(result?.outcome, "DENIED");
    const log = readFileSync(run.log, "utf8");
    assert.match(log, /commit DENIED/u);
    assert.match(log, /not declared/u, "the log says a request was refused but not why");
  } finally {
    cleanup(run);
  }
});

test("a claimed request cannot be rewritten while it is decided", () => {
  const run = fixture();
  try {
    writeFileSync(join(run.worktree, "declared.txt"), "changed\n");
    request(run, "0001", { message: "first" });
    serviceOnce({
      channel: run.channel,
      declaredTouches: ["declared.txt"],
      log: run.log,
      worktree: run.worktree,
    });

    assert.equal(
      existsSync(join(channelPaths(run.channel).requests, "0001.json")),
      false,
      "the request stayed where the run could rewrite or replay it",
    );
    assert.equal(
      existsSync(join(channelPaths(run.channel).requests, "0001.json.claimed")),
      false,
      "the claimed request was left behind",
    );
  } finally {
    cleanup(run);
  }
});

test("malformed JSON is refused rather than crashing the servicer", () => {
  const run = fixture();
  try {
    writeFileSync(join(channelPaths(run.channel).requests, "0001.json"), "{not json");
    const result = serviceOnce({
      channel: run.channel,
      declaredTouches: ["declared.txt"],
      log: run.log,
      worktree: run.worktree,
    });
    assert.equal(result?.outcome, "DENIED");
    assert.equal(reply(run, "0001").outcome, "DENIED");
  } finally {
    cleanup(run);
  }
});

test("an empty channel is not an error", () => {
  const run = fixture();
  try {
    const result = serviceOnce({
      channel: run.channel,
      declaredTouches: ["declared.txt"],
      log: run.log,
      worktree: run.worktree,
    });
    assert.equal(result, undefined);
  } finally {
    cleanup(run);
  }
});

test("several commits keep the granularity the run chose", async () => {
  const run = fixture();
  try {
    let running = true;
    const serving = serviceUntilGone(
      {
        channel: run.channel,
        declaredTouches: ["declared.txt", "second.txt"],
        log: run.log,
        worktree: run.worktree,
      },
      () => running,
      10,
    );

    writeFileSync(join(run.worktree, "declared.txt"), "first change\n");
    request(run, "0001", { message: "first piece", paths: ["declared.txt"] });
    await new Promise((resolve) => setTimeout(resolve, 80));

    writeFileSync(join(run.worktree, "second.txt"), "second change\n");
    request(run, "0002", { message: "second piece", paths: ["second.txt"] });
    await new Promise((resolve) => setTimeout(resolve, 80));

    running = false;
    await serving;

    const log = git(run.worktree, "log", "--format=%s").trim().split("\n");
    assert.deepEqual(
      log,
      ["second piece", "first piece", "init"],
      "the run's commits were merged or lost",
    );
  } finally {
    cleanup(run);
  }
});

test("work that arrives as the run exits is still serviced", async () => {
  const run = fixture();
  try {
    let running = true;
    const serving = serviceUntilGone(
      {
        channel: run.channel,
        declaredTouches: ["declared.txt"],
        log: run.log,
        worktree: run.worktree,
      },
      () => running,
      10,
    );
    writeFileSync(join(run.worktree, "declared.txt"), "last words\n");
    request(run, "0001", { message: "the last piece" });
    running = false;
    await serving;

    assert.match(git(run.worktree, "log", "--format=%s"), /the last piece/u);
  } finally {
    cleanup(run);
  }
});

test("requests are decided in the order the run wrote them", () => {
  // A directory has no order to lend: readdir returns hash order that varies
  // per directory on this filesystem, so a real channel cannot reproduce a
  // specific shuffle. The choice is tested directly against a shuffled list.
  const shuffled = [
    "0007-request.json",
    "0003-request.json",
    "0001-request.json",
    "0009-request.json",
    "0002-request.json",
  ];
  assert.equal(nextRequestName(shuffled), "0001-request.json");
  assert.equal(nextRequestName([...shuffled].reverse()), "0001-request.json");
  assert.equal(nextRequestName(["0002-request.json"]), "0002-request.json");
  assert.equal(nextRequestName([]), undefined);
  assert.equal(
    nextRequestName(["0001-request.json.claimed", "0004-request.json"]),
    "0004-request.json",
    "a claimed request was offered again",
  );
});

test("the run's numbering survives a real channel", () => {
  const run = fixture();
  try {
    const ids = ["0001", "0002", "0003", "0004"];
    for (const id of [...ids].reverse()) {
      request(run, id, { message: `piece ${id}` });
    }

    const input = {
      channel: run.channel,
      declaredTouches: ["declared.txt"],
      log: run.log,
      worktree: run.worktree,
    };

    const order: string[] = [];
    for (let index = 0; index < ids.length; index += 1) {
      writeFileSync(join(run.worktree, "declared.txt"), `change ${index}\n`);
      const result = serviceOnce(input);
      assert.equal(result?.outcome, "OK", result?.reason);
      order.push(git(run.worktree, "log", "-1", "--format=%s").trim());
    }

    assert.deepEqual(
      order,
      ids.map((id) => `piece ${id}`),
      "the servicer decided requests in directory order rather than the run's",
    );
  } finally {
    cleanup(run);
  }
});

test("declared touches are read from the run's own declaration", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-declaration-"));
  try {
    const path = join(directory, "declaration.json");
    writeFileSync(
      path,
      JSON.stringify({ autonomous: true, needs: [], touches: ["src/a.ts", "test/a.test.ts"] }),
    );
    assert.deepEqual(readDeclaredTouches(path), ["src/a.ts", "test/a.test.ts"]);
    assert.deepEqual(readDeclaredTouches(join(directory, "missing.json")), []);
    writeFileSync(path, "{not json");
    assert.deepEqual(readDeclaredTouches(path), []);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
