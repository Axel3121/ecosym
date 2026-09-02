// Preloaded before any test file via `node --import` (see package.json,
// "test" script). Runs once, before a single test module's top-level code
// executes, so every `process.env` a test file captures — directly, or via
// `{ ...process.env }` spread into a child's env — is already clean.
//
// Why this exists: Git exports GIT_DIR, GIT_WORK_TREE, GIT_COMMON_DIR,
// GIT_INDEX_FILE, and friends into the environment of any process it spawns —
// including a `pre-push` hook, and including whatever that hook then runs
// (e.g. `npm run check`). The test suite creates disposable fixture
// repositories with `git init`, `git worktree add`, `git commit`, etc., and
// calls the `git` binary directly. `git` prefers these environment variables
// over the fixture's own `--cwd`/`-C`, so once they are set, every one of
// those calls stops operating on the fixture and starts mutating whatever
// repository GIT_DIR happens to name — measured here: the real repository
// this suite lives in, when `npm run check` runs from a `pre-push` hook.
// Confirmed reproduction: with GIT_DIR pointed at a decoy repository,
// `git -C <fixture> init` silently reinitializes the decoy instead of
// creating a repository at the fixture path, and `git -C <fixture> worktree
// add <path> -b <branch>` registers a live worktree and injects a branch
// into the decoy — exactly the "task/<name>" branches and dangling worktree
// registrations observed in the real repository, and exactly the corruption
// the (untracked, hook-only) partial fix in .git/hooks/pre-push described
// but did not durably prevent: it only covered pushes, not a developer or CI
// running the suite directly.
//
// The unset must happen here, in the process every test file's module scope
// runs in, so it protects every entry point — a bare `npm test`/`npm run
// check`, CI, and a `pre-push` hook alike — not just the one path a hook
// happens to intercept.
const GIT_ENVIRONMENT_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
];

for (const name of GIT_ENVIRONMENT_VARIABLES) {
  delete process.env[name];
}
// `GIT_CONFIG_COUNT=<n>` above is itself paired with numbered
// `GIT_CONFIG_KEY_<i>` / `GIT_CONFIG_VALUE_<i>` variables that inject
// arbitrary config into every `git` invocation regardless of `-C`; strip any
// that survived from an inherited environment.
for (const name of Object.keys(process.env)) {
  if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/u.test(name)) {
    delete process.env[name];
  }
}
