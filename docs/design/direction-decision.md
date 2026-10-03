# EcoSym surface direction — decided 2026-09-15 (rev 2, replaces rev 1)

## Rev 4 amendment — 2026-09-17: Observatoriet (a place, not a dashboard)

Decided by Axel in chat with Claude Code, 2026-09-16/17. The pit wall (rev 3) was
not approved: "dette er ikke godkjent", then "ecosym sitt design skal være mer
enn et kjedelig dashboard", then "vi trenger bare en skikkelig behagelig, pen,
kul og veldig brukbar dashboard/verden, men mer personligheten til en verden;
bruk taste". This matches PRODUCT.md's hypothesis (an inhabited place you move
through, not a dashboard you interpret) and its non-goal ("a general-purpose
dashboard or metrics surface").

- **Expression.** Stage 2 rerun as concept-seed round 5 (seed key `bf54548d`,
  scope direction, mode experience). The roll assigned **Observatoriet**: every
  civilization is a body in a dark field, bright when recently read, cut by a
  hard-edged occluder with a red rim when EcoSym has lost sight, an empty ring
  when dissolved; one pure-white bloom with a blue label where a project waits
  on you. Position is derived (hash angle, founding-order radius, 23° separation
  pass; a lattice when the sky is dense), brightness is a strict step of time
  since the latest read, tick line forms carry source state before hue. No grid,
  no ornament, no raster. Full contract: `.impeccable/explore/observatoriet/
  direction.md` (copied to the surface brief); tokens: `DESIGN.md`.
- **Scope.** Unchanged from rev 3: only what the world-snapshot carries; chat,
  agents, chronicler and council appear once as a reserved footer line.
- **Process.** Two explorer subagents wrote full contracts for the two strongest
  cards (Observatoriet, Papirlyktene); Axel then chose to build without further
  image rounds. Higgsfield (gpt-image route) was expired on 2026-09-16, so the
  round's comps are HTML renders. taste-skill (Leonxlnx/taste-skill) rules were
  applied as critique: no decorative grid, no eyebrows, rationed middle dots,
  sentence-case headings, one meaning per colour.

Build path: code-led. Verified 2026-09-17 through the impeccable finish
protocol: finish-reviewer `ship` after three verdict passes, detector zero
findings, `npm run check` 603 tests passing, CodeRabbit run on the working
tree (see `DESIGNSTACK.md` status).

## Rev 3 amendment — 2026-09-16: the pit wall (expression and scope), superseded by rev 4

Decided by Axel in chat with Claude Code. The rev 2 model below (HQ as an
overview, civilizations as characters with a colour each, three functional
colours with one meaning each) stands. Two things changed:

- **Expression.** Stage 2 was rerun with `impeccable concept-seed` (hand 2,
  seed key `cc2f9807`). Axel chose the challenger **racing league identity**
  over the assigned festival lineup sheet (declined: a poster cannot carry
  per-item interaction) and the nixie counter. Every civilization is a team
  on a timing tower; the screen is the pit wall. Graphite ground with a
  faint asphalt grain and a chalk grid, Barlow, one geometric mark and one
  team colour per civilization, amber = observed change, red = cannot see,
  blue = waiting on you. Full contract: `.impeccable/surfaces/web-app-tsx.md`
  (gitignored); tokens: `DESIGN.md`.
- **Scope.** The surface shows only what the world-snapshot contract carries
  (civilizations, source pictures, projects, truncation). Chat, agents, the
  chronicler and the council are not in the data (`product-reality.md`), so
  they appear once as a reserved line, never as panes. Items 1, 3 and 4 of
  the HQ list below are therefore deferred until their backing data exists;
  item 2 is built as the timing tower.

Build path: code-led (no Penpot mockup for this expression; the earlier
"canon" mockups in `mockups/` are for the rev 2 chat expression and were not
approved). Verified through the impeccable finish protocol on 2026-09-16:
detector zero findings, finish-reviewer `ship` after one fix round.

Deliberate deviations from the contract, each cited: the unread sector is a
grey dashed outline rather than red (red means cannot see; an unread declared
source is not lost sight); `Les på nytt` lives in the tower foot so reload is
reachable from the team view too.

Decided by Axel in chat with Hermes. Rev 1 ("Phase A: shape a civilization",
now `rejected-direction-decision-rev1.md`) is withdrawn: it modelled EcoSym
as forms you edit. Axel: "hver sivilisasjon skal ikke ha sine egne
funksjoner — alt går gjennom agenter, så det trengs bare chatter og
agenter." The evidence file `product-reality.md` still holds.

## The model (rev 2, 2026-09-15; historical, superseded by rev 4 above)

*Everything from here to the end of this file is the rev 2 conversation-first
model, kept as the record of how the product model was reasoned out. Where it
says "dashboard" or describes conversations, rev 4 above governs: EcoSym is a
place, and chat, coordinators, agents and the council are deferred until the
world-snapshot carries them.*

- "Det skal være et dashboard" — a focused work surface, not a living world.
  The pixel world may exist as somewhere you can *go into* if you want; it
  is not the home screen.
- "Bruk personligheten til verdene" — civilizations, coordinators, the
  chronicler are the *characters* of the dashboard: names, colours,
  portraits. Not terrain.
- "Alt går gjennom agenter" — the user never edits a mandate in a form. The
  user *tells* a coordinator, and the coordinator (a runtime) does or
  refuses. Every consequential action is a message.
- "Trengs bare chatter og agenter" — the surface has two nouns: conversations
  and agents. Everything else is context around them.
- HQ = the user's own seat. The chronicler lives there.

## Who you talk to (rev 2 intent; deferred, not available)

*Deferred until petition identity, admission and agent observation exist in
the data (`product-reality.md`); no conversation route is built.* The intent:
one conversation with the **chronicler** (narrator, world-wide), one with
each civilization's **coordinator** (Curia, Ting, Bakufu… — the seat), and
you can **ask any individual agent** running under a coordinator.

## Three layers (decided 2026-09-15, after the first rev-2 mockup got it wrong)

**Civilization** (Utvikling, Husholdning…) → has a coordinator you talk to.
  **Project** (jarvis, ecosym, finnflip…) → where agents actually work;
  `projects[]` in world-snapshot v2, bound to a civilization. A project is
  *context*, not a conversation partner: you tell Curia "på finnflip, gjør X".
    **Agent** (worker, reviewer…) → observed running under a project; can be
    asked directly.

Visually: the rail shows civilizations; inside a civilization the projects
are a tab/list row at the top, and agents are grouped under their project.
The first rev-2 mockup listed FinnFlip and Jarvis as civilizations — wrong;
they are projects under Utvikling.

## What the home (HQ) shows — the dashboard

**HQ is an overview of everything happening, not a chat** (corrected
2026-09-15 after rev 2b put a chronicler conversation in the centre; Axel's
correction in chat was that HQ must be the overview, and the chronicler a
presence you can address from it, not the centre pane — his exact wording was
not preserved).

1. **The overview** *(rev 3: built as the pit wall readout; the chronicler
   presence is deferred until it exists in the snapshot)* — the main pane: every civilization, what changed at the
   last read, where sight is lost, and what waits on you. The chronicler is
   addressable from here, as a presence, not as the pane itself.
2. **Civilizations as characters** *(rev 3: built as the timing tower;
   portraits and agent counts deferred, no such data)* — a rail: each with its colour, its
   coordinator's portrait, one line of state (working / quiet / cannot see /
   asks the council), and the count of agents running now. Click = open
   that coordinator's conversation.
3. **Agents running now** *(rev 3: deferred; agents are not in the
   world-snapshot)* — across all civilizations, each with portrait,
   civilization colour, what it is doing, since when; click = ask it.
4. **The council** *(rev 3: deferred; council matters are not in the
   world-snapshot, the pit board shows only projects waiting on you)* — matters waiting on you, as messages to answer, not a
   table.

## Expression (decided)

Warm and alive: **a colour per civilization**, **portraits/avatars** for
coordinators, agents and the chronicler, dark but not coal-black. Character
comes from who is on screen, not from terrain or chrome.

## Truth (unchanged, non-negotiable)

- Agents shown = agents observed running. Nothing walks that is not observed.
- A message to a coordinator is a petition: shown as *asked*, never as done,
  until an outcome is observed and attributed.
- "Cannot see" is stated, never dimmed. Quiet ≠ cannot see.
- The chronicler's account is derived from observations and says so.

## Consequence for the backend (a requirement, not a design note)

The surface above needs, in order: (1) a chronicler voice derived from the
snapshot, addressable; (2) petition send + petition lifecycle in the
snapshot; (3) observed running agents with lineage in the snapshot;
(4) council matters as addressable items. Each UI element ships together
with the data that makes it true, or ships marked "not connected yet".
Design goes first so the backend has a target; the UI never fakes.

## Superseded

- rev 1 and its mockup (`mockups/rejected-2026-09-15/`).
- `direction.md` and `DESIGN.md` must be revised for a conversation-first
  surface with per-civilization colour and portraits.
