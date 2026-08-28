# Architecture

Nothing is built yet. This document records the intended shape and the
constraints any implementation has to respect. It will be revised as real
decisions are made, not treated as a plan to execute.

## Intended shape

- **Input** — whatever Axey learns from: conversation with the user, and later
  the sources they connect.
- **Memory** — the durable store of what Axey knows about its user, their
  context and their history. The centre of the system.
- **Reasoning** — a model, given the current request plus the memory relevant
  to it, deciding what to say or do.
- **Action** — the effects Axey can have outside itself. Consequential ones
  require the user's approval.
- **Surface** — how the user reaches Axey. Deliberately thin; no logic lives
  here.

## Constraints

- Memory is separable from the model and from any surface. It must be
  inspectable, correctable and exportable by the user.
- Nothing about a specific user is hardcoded anywhere.
- Personal data stays under the user's control by default.
- Axey is a single-user system. Do not generalise for tenants or teams.
- Prefer the smallest thing that works. Complexity has to be earned by a real
  problem that has already appeared.

## Not decided

Language, runtime, storage, model provider, and how Axey is deployed and
reached. These stay open until a first capability forces the choice.
