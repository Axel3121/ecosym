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
npx playwright install chromium
npm run check
```

`npm run check` is the single local verification entry point. It runs the core
and frontend TypeScript checks, the complete product test suite (including
Chromium frontend smoke tests), and the actual Vite production build. On Linux,
if browser system libraries are missing, use
`npx playwright install --with-deps chromium` (also used by CI).

## Browser development

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. Vite binds to loopback and fails if that port is
occupied. Editing `web/App.tsx` uses React Fast Refresh; TypeScript is checked by
`npm run typecheck:world`, not by Vite's transpiler. The app loads the validated
world contract and renders the core form projection.
The dev server does not open stores and has no API proxy or fallback data.
Without the production API, it displays an invalid-response state, not a sample world.
Do not expose this development tool with `--host` or use it for production.

## Production world

```sh
npm run build:world
npm run serve:world -- --port 4317
```

Open `http://127.0.0.1:4317`. Alternatively, `npm run world` builds and starts
the server on an available loopback port, printing its URL. `serve:world` serves
the existing build without rebuilding; rebuild after source edits. Vite replaces
`dist/world` with bundled production HTML and hashed JavaScript, without source
maps. Generated output is ignored and must not be committed.

The existing world-server serves those files and preserves its exact Host check,
realpath containment, strict production CSP, sanitized errors, and GET-only
`/api/world-snapshot` contract. The launcher opens the local Ecosym store; the
frontend requests that contract through `loadWorld()`. React owns presentation only. Core contracts,
composition, and store access remain in `src/`, independent of React.

`test/world-frontend.test.ts` removes stale `dist/world` output and executes
`npm run build:world` with the committed config, then starts `src/world-main.ts`
with temporary store state on an ephemeral loopback port. It fetches the served
HTML and its built JavaScript and CSS and renders the world in Chromium at desktop
and mobile sizes under the production CSP, permitting only document, built assets,
and world-snapshot requests. Routed synthetic snapshots exercise evidence distinctions,
inspection, native place hit targets, keyboard and pointer navigation, and narrow layout.
It separately loads the committed dev config without root, filesystem,
host, or port overrides and checks the explicit invalid-response state. Stop any
running dev server before testing: this check requires port 5173 to be free.
Fast Refresh is verified against an isolated copy of the frontend, not the
unmodified config. The manifest wiring guard checks script strings only;
`npm run check` supplies execution evidence. No personal stores are read by these
tests. The production integration test is the suite's only build writer and awaits
the build before launching; check's final build follows the completed suite. Do
not run a separate build concurrently with the tests. Core form, snapshot,
transition, and server security tests remain in the suite.

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
