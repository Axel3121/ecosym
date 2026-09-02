# Development

This document owns the public development contract for Ecosym. Product,
architecture, and security meaning remain in `PRODUCT.md`, `ARCHITECTURE.md`,
and `SECURITY.md`.

## Repository boundary

The repository contains the product, its public documentation, ordinary build
and CI configuration, and reproducible tests or fixtures that prove product
behaviour.

It is not a workspace for the process that builds it. Personal agent prompts,
model or provider routing, task specifications, run ledgers, worktree managers,
local hooks, coding-agent sandboxes, reviewer configuration, and session output
belong outside the tree. A file whose audience is the maintainer's current
toolchain rather than a reader or contributor does not belong in the product
repository.

This boundary does not exclude normal project tooling. A formatter, compiler,
test runner, migration tool, release script, or CI workflow belongs when it is
needed to build, verify, package, or operate Ecosym itself and works without a
particular person's agent setup.

## Local setup

Ecosym requires the Node version declared in `.nvmrc` and `package.json`.

```sh
npm ci
npm run check
```

`npm run check` is the single local verification entry point. It runs the
TypeScript compiler and the product test suite.

## Changes

Keep each change coherent: implementation, tests, and any documentation whose
meaning changed belong together. Tests should exercise observable behaviour and
failure paths rather than implementation details.

Do not commit credentials, personal data, generated output, editor state, or
local orchestration configuration. Examples and fixtures must be synthetic.

When a change affects authority, personal-data flow, external effects,
credentials, migrations, concurrency, or another consequential boundary, get
an independent review of the completed candidate. Review informs the
maintainer; it does not grant merge authority.

## CI and merge

GitHub Actions installs dependencies from the lockfile, audits the dependency
set, and runs `npm run check` against the published commit. A green check is
evidence about that commit, not permission to merge it.

Merge decisions remain explicit maintainer decisions. Keep `main` in a
buildable, tested state.
