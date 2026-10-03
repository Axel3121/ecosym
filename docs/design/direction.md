# Direction — EcoSym pit wall (rev 3; the rev 2 conversation-first material below is historical)

## Rev 3 — 2026-09-16: racing league / pit wall (supersedes the expression below)

Reference pattern borrowed: the **motorsport timing tower** (F1 broadcast
timing graphics, pit-wall timing sheets). What is borrowed and why: a fixed
left column listing every entrant with a team-colour bar, a geometric mark
and a right-aligned tabular gap time; a "sector strip" of small blocks per
entrant that reads at a glance; team colour flooding only that team's
readouts. It is borrowed because a timing sheet is honest by construction:
a gap is a gap, no signal is no signal, and nothing on it implies activity
that was not measured. Not copied: broadcast chrome, flags, sponsor marks,
position-change animation, any implication of live telemetry.

Linear (calm density, keyboard-first rows) and Vercel (three luminance
steps, real 1px borders) remain the finish references. The Discord/Slack
conversation references below are retained for the deferred chat panes only.

Canon in `.impeccable/surfaces/web-app-tsx.md` (dark, Linear/Vercel/
Raycast finish) stays. Replaces the Phase-A editing-surface direction —
no longer forms-in-place, per `direction-decision.md` rev 2: "alt går
gjennom agenter."

## Historical — rev 2 conversation-first references (superseded 2026-09-16)

Everything from here down describes the rev 2 expression, kept for the deferred chat panes only.

## Reference 1 — Discord: the civilization rail

Borrowed: a colour + presence line per community in a narrow left rail,
click to open its conversation. Civilizations are characters, not
settings rows — colour and portrait let you recognize *who* before
*what*. A quiet coordinator is not a red pip; "quiet ≠ cannot see"
(`PRODUCT.md`) means state is a word, never a badge count.

## Reference 2 — Linear: calm density and keyboard

Borrowed: luminance-stacked panels, no shadows, one motion token, and
keyboard-first navigation between conversations — three simultaneous
surfaces (chronicler, coordinator, agent) read as one instrument. No
brand moment here; blur is ornament on a screen meant to be read.

## Reference 3 — Slack/Discord messaging: plain-line conversation

Borrowed: plain-line messages (name + text, no bubble chrome) and
relative timestamps only. Four speaker roles read better as a quiet list
than colored balloons.

## Not copied, any reference

Server boosting, member-count games, animated banners, unread badges;
brand indigo, marketing type scale, glassmorphism/blur; emoji reactions,
read receipts, typing indicators — none exist in this data, none may be
faked, no gamification. Amber/red/blue unchanged.

## Per-civilization colour

Assigned once, hashed from the civilization's id, from a fixed 8-hue
palette (`DESIGN.md` §Colors) — stable across sessions. May
appear: rail avatar ring, portrait ring, conversation header, agent-row
tag. Must never appear: as body-text background, or on a control also
carrying amber/red/blue meaning — "observed 4m ago" stays tertiary. The
8 hues sit ≥30° from amber (~37°), red (~353°), blue (~213°).

## Portrait style

Recommend: geometric monogram — a flat generated shape, initials on a
civ-tinted background (`DESIGN.md` portrait tokens), not photoreal or
illustrated. CSP-compatible (CSS/SVG only), cheap for hundreds of agents.
An observed-but-unknown agent (seen running, identity unresolved) gets
the same slot with a "?" glyph on a neutral, non-civ tint and a dashed
ring — an honest placeholder, not an error, never borrowing the
civilization's colour before attribution confirms.

## Petition: asked vs. observed outcome

A sent petition renders as your own message captioned "asked · 2m ago" —
never a checkmark, never "done." Only when an outcome is observed and
attributed does a separate line appear, its own "observed outcome"
marker and timestamp — never merged in. No outcome yet, no second line;
silence is not refusal or success.

## "Not connected yet" in a conversation pane

Per `product-reality.md`, chat/agents/narrator are not live. An
unconnected pane shows one disabled composer, dashed border, caption
"Not connected yet" instead of a message list — never a fake inbox,
styled like this system's ask-field pattern.

## Explicit conflict, resolved

Civilization colour could tempt loss/council states toward a civ hue for
rail continuity. `PRODUCT.md` wins: red/blue keep their single meanings
everywhere; a civilization in loss or awaiting council shows red/blue on
that signal, colour demoted to the portrait ring only then.
