# EcoSym surface direction — decided 2026-09-15

**Archived rev 1.** Decided by Axel in chat with Hermes on 2026-09-15 and
withdrawn the same day; `direction-decision.md` (rev 2, amended rev 3)
supersedes it. Kept as the record of why the forms-in-place model failed.
`product-reality.md` is the evidence it rested on.

## Why the earlier designs failed

Twelve rounds of mockups on 2026-09-15 (observatory, strata, skylines, atlas,
dioramas, bento, editorial, three-column ops dashboard) were all rejected as
"fis". The cause was not style. Every one of them was a **status view** —
something you read — and several depicted agents, chat, council queue and
traces as if they existed. They do not (`product-reality.md`, section 1):
petition/chat has a validated schema but no route that sends; inhabitants,
council, chronicler and traces are declared in PRODUCT.md and absent from the
world-snapshot contract. The prototype at `ecosym-proto` showed the same
fiction and said so in its footer.

Axel's requirement, stated plainly: **a screen you work in, not one you read**
— with chat, agents, a narrator. That is a product gap before it is a design
gap.

## The decision: C — two phases, in order

### Phase A — design and build for the product that exists

The working object is the civilization you **shape**, because the only
consequential verbs the system has are:

- `found` / `redraw` / `dissolve` — mandate (sovereign, no council)
- `connect` / `disconnect` / `collect` — sources
- `claim` / `heartbeat` / `release` — leases
- projects: create / retry

So the Phase-A screen lets the owner, from inside the world:

1. see the founded civilizations as places, with mandate, sources, and
   observations rendered honestly with their epistemic status;
2. **edit mandate and sources directly** (found / redraw / connect /
   disconnect) — this is the work;
3. see projects and their provisioning state, create and retry;
4. see claims/leases as what they are (short, heartbeat-held);
5. see one visible, addressable **"ask" field per place, explicitly marked
   "not connected yet"** — the chronicler's seat, reserved, never faking a
   send. This is the single honest foothold for Phase B.

Phase A ships through the normal pipeline (`ui-design-pipeline` stages 2–7;
`DESIGN.md` tokens already locked; `impeccable` critique + finish-reviewer;
`release-pipeline`).

### Phase B — the product Axel is describing, built data-first

Order of work, each UI element arriving **together with** the data that makes
it true, never before:

1. **The chronicler** — the addressable narrator voice (PRODUCT.md:230–246).
   Declared, not built. First because it gives "someone to talk to" without
   pretending agents are observed. Needs: an ask route, an answer grounded
   only in observed state, and its own identity on the surface.
2. **Petition path** — chat to a civilization coordinator. Blocked on the
   open questions PRODUCT.md itself lists (petition identity, admission,
   validity window; `docs/petition-identity.md`). These get decided as
   product decisions, then built, then drawn.
3. **Active-work view** — agents running now, lineage, tools, traces
   (PRODUCT.md:116–124). Needs an observation source that actually reports
   running work (Hermes kanban is the obvious first connection).
4. **Council queue** — after 2 and 3 exist to feed it.

Each Phase-B item gets its own brief and its own critique gate. Nothing from
Phase B is drawn on the Phase-A screen except the reserved ask field.

## Non-negotiables carried forward

- PRODUCT.md invariants: delightful *and* true; the world cannot flatter;
  quiet ≠ cannot see; unknown remains unknown; no inferred success.
- `DESIGN.md` tokens (dark neutral, amber/red/blue with one meaning each,
  system sans, mono for identifiers only) stay locked for Phase A.
- No status-dashboard chrome: no KPI header, no same-size cards, no charts
  standing in for content. Critique snapshot with the specific findings:
  `.impeccable/critique/2026-09-15T13-44-29Z__docs-design-mockups-world-engineering-png.md`.
- Every declared-not-observed thing on screen is labelled as such.

## What is discarded

- All 2026-09-15 mockups in `docs/design/mockups/` and the generated
  reference images in `docs/design/referanser/` — kept only as evidence of
  what was rejected.
- `ecosym-proto` as a source of truth for the surface (art direction there
  was also rejected; its honesty footer is the one thing worth keeping).
