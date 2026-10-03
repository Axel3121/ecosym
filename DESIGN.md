---
version: alpha
name: EcoSym Observatoriet
description: A dark field where every light is derived from an observation — bodies for civilizations, brightness stepped by last read, an occluder for lost sight, one white bloom for a project waiting on you; IBM Plex self-hosted under CSP.
colors:
  ground: "#0b0d12"
  plate: "#0f1219"
  raised: "#161a23"
  raised-hover: "#1c212c"
  primary: "#e9edf5"
  ink-2: "#b4bccb"
  ink-3: "#8d97a8"
  ink-disabled: "#5b6474"
  line: "rgba(255, 255, 255, 0.08)"
  hairline: "rgba(255, 255, 255, 0.06)"
  ring: "rgba(233, 237, 245, 0.26)"
  ring-hot: "rgba(233, 237, 245, 0.8)"
  focus: "rgba(233, 237, 245, 0.7)"
  selection: "rgba(233, 237, 245, 0.16)"
  amber: "#f2b544"
  red: "#f0455a"
  blue: "#4d9eff"
  bloom: "#ffffff"
typography:
  display:
    fontFamily: '"IBM Plex Sans", "Cantarell", "Noto Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: 28px
    fontWeight: 300
    lineHeight: 1.1
  headline:
    fontFamily: '"IBM Plex Sans", "Cantarell", "Noto Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: 26px
    fontWeight: 300
    lineHeight: 1.15
  name:
    fontFamily: '"IBM Plex Sans", "Cantarell", "Noto Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: 22px
    fontWeight: 300
    lineHeight: 1
  wordmark:
    fontFamily: '"IBM Plex Sans", "Cantarell", "Noto Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: 18px
    fontWeight: 300
    lineHeight: 1.45
    letterSpacing: "0.01em"
  title:
    fontFamily: '"IBM Plex Sans", "Cantarell", "Noto Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.45
  name-compact:
    fontFamily: '"IBM Plex Sans", "Cantarell", "Noto Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: 16px
    fontWeight: 300
    lineHeight: 1
  body:
    fontFamily: '"IBM Plex Sans", "Cantarell", "Noto Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.45
  subtitle:
    fontFamily: '"IBM Plex Sans", "Cantarell", "Noto Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: 15px
    fontWeight: 500
    lineHeight: 1.45
  body-sm:
    fontFamily: '"IBM Plex Sans", "Cantarell", "Noto Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: '"IBM Plex Sans", "Cantarell", "Noto Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
  caption-compact:
    fontFamily: '"IBM Plex Sans", "Cantarell", "Noto Sans", "Segoe UI", system-ui, sans-serif'
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1
  mono:
    fontFamily: '"IBM Plex Mono", ui-monospace, "Liberation Mono", Menlo, Consolas, monospace'
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: 4px
  round: 9999px
spacing:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  2xl: 16px
  3xl: 24px
  block: 26px
  4xl: 28px
  5xl: 32px
components:
  field:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
  wordmark:
    textColor: "{colors.primary}"
    typography: "{typography.wordmark}"
    padding: "26px 32px"
  body-name:
    textColor: "{colors.primary}"
    typography: "{typography.name}"
  body-name-compact:
    textColor: "{colors.primary}"
    typography: "{typography.name-compact}"
  body-line:
    textColor: "{colors.ink-3}"
    typography: "{typography.caption}"
  body-line-loss:
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
  body-line-waiting:
    textColor: "{colors.blue}"
    typography: "{typography.caption}"
  body-line-compact:
    textColor: "{colors.ink-3}"
    typography: "{typography.caption-compact}"
  wait-label:
    textColor: "{colors.blue}"
    typography: "{typography.caption}"
  body-ring:
    backgroundColor: "{colors.ring}"
    size: 112px
    rounded: "{rounded.round}"
  body-ring-current:
    backgroundColor: "{colors.ring-hot}"
    size: 112px
    rounded: "{rounded.round}"
  body-ring-compact:
    backgroundColor: "{colors.ring}"
    size: 80px
    rounded: "{rounded.round}"
  body-core:
    backgroundColor: "{colors.primary}"
    size: 56px
    rounded: "{rounded.round}"
  tick:
    backgroundColor: "{colors.primary}"
    height: 2.5px
  tick-changed:
    backgroundColor: "{colors.amber}"
    height: 3.5px
  tick-attempt:
    backgroundColor: "{colors.primary}"
    height: 1px
  tick-missing-bar:
    backgroundColor: "{colors.ground}"
    height: 8px
  tick-missing-rim:
    backgroundColor: "{colors.red}"
    height: 1px
  occluder:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.red}"
    rounded: "{rounded.round}"
  bloom:
    backgroundColor: "{colors.bloom}"
    size: 6.4px
    rounded: "{rounded.round}"
  plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    padding: "28px 32px 32px"
    width: 480px
  plate-narrow:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    padding: "22px 16px 28px"
  plate-title:
    textColor: "{colors.primary}"
    typography: "{typography.display}"
  plate-domain:
    textColor: "{colors.ink-3}"
    typography: "{typography.body}"
  plate-heading:
    textColor: "{colors.primary}"
    typography: "{typography.title}"
  plate-subheading:
    textColor: "{colors.ink-3}"
    typography: "{typography.body-sm}"
  signal-neutral:
    textColor: "{colors.ink-2}"
    typography: "{typography.body}"
  signal-loss:
    textColor: "{colors.primary}"
    typography: "{typography.body}"
  signal-waiting:
    textColor: "{colors.blue}"
    typography: "{typography.body}"
  status-changed:
    textColor: "{colors.amber}"
    typography: "{typography.body}"
  status-missing:
    textColor: "{colors.red}"
    typography: "{typography.body}"
  status-unread:
    textColor: "{colors.ink-2}"
    typography: "{typography.body}"
  status-quiet:
    textColor: "{colors.ink-3}"
    typography: "{typography.body}"
  source-row:
    textColor: "{colors.primary}"
    typography: "{typography.body}"
    padding: "9px 0"
  source-gap:
    textColor: "{colors.ink-3}"
    typography: "{typography.caption}"
  source-meaning:
    textColor: "{colors.ink-3}"
    typography: "{typography.caption}"
  identifier:
    textColor: "{colors.ink-2}"
    typography: "{typography.mono}"
  evidence-caption:
    textColor: "{colors.ink-3}"
    typography: "{typography.body-sm}"
  evidence-head:
    textColor: "{colors.ink-3}"
    typography: "{typography.caption}"
    padding: "6px 12px 6px 0"
  evidence-cell:
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    padding: "8px 12px 8px 0"
  record-field:
    textColor: "{colors.ink-2}"
    typography: "{typography.mono}"
  project-name:
    textColor: "{colors.primary}"
    typography: "{typography.subtitle}"
  project-state:
    textColor: "{colors.ink-3}"
    typography: "{typography.caption}"
  project-state-waiting:
    textColor: "{colors.blue}"
    typography: "{typography.caption}"
  project-mark:
    textColor: "{colors.ink-2}"
    typography: "{typography.caption}"
  project-path:
    textColor: "{colors.ink-3}"
    typography: "{typography.mono}"
  button:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: 34px
  button-hover:
    backgroundColor: "{colors.raised-hover}"
  button-disabled:
    textColor: "{colors.ink-disabled}"
  button-quiet:
    textColor: "{colors.primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: 34px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: 34px
  button-primary-hover:
    backgroundColor: "{colors.bloom}"
    textColor: "{colors.ground}"
  button-primary-disabled:
    textColor: "{colors.ink-disabled}"
  link:
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
  link-disabled:
    textColor: "{colors.ink-disabled}"
  input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  input-placeholder:
    textColor: "{colors.ink-3}"
  input-disabled:
    textColor: "{colors.ink-disabled}"
  field-label:
    textColor: "{colors.ink-2}"
    typography: "{typography.caption}"
  alert:
    textColor: "{colors.primary}"
    typography: "{typography.body-sm}"
    padding: "0 0 0 10px"
  notice-ring:
    size: 56px
    rounded: "{rounded.round}"
  notice-heading:
    textColor: "{colors.primary}"
    typography: "{typography.headline}"
  notice-body:
    textColor: "{colors.ink-3}"
    typography: "{typography.body}"
  foot:
    textColor: "{colors.ink-3}"
    typography: "{typography.caption}"
    width: 46ch
  foot-gap:
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
  rule-line:
    backgroundColor: "{colors.line}"
    height: 1px
  rule-hairline:
    backgroundColor: "{colors.hairline}"
    height: 1px
  focus-ring:
    backgroundColor: "{colors.focus}"
    size: 2px
  text-selection:
    backgroundColor: "{colors.selection}"
---

# Design System: EcoSym Observatoriet

## Overview

**Creative North Star: "Observatoriet"**

EcoSym is read the way a night sky is read from a planisphere: one dark field, every civilization a body sitting where its identity puts it, and the whole world legible in a single sweep before anything is opened. There is no chrome. The field is the interface; a wordmark top-left and one quiet footer line are the only fixed furniture, and the reading plate appears only after you approach a body. The world refuses the dashboard, the inbox, the map and the city alike.

Every light is derived from an observation. A body's brightness is a strict step of time since its latest recorded read; a source is a tick on the orbit ring whose *form* (full, half, dashed, gap) carries its state before any hue does; lost sight is a hard-edged occluder cutting across the body, never a dimmer body; a project waiting on you is the single pure-white point in the field. Nothing twinkles, drifts or fills the dark. An empty field is a true sky, not an error. Where the previous world dealt a livery colour to each team, this one gives a civilization no colour of its own: identity is position and name.

The material is one flat deep night blue with two tonal steps for the plate and its controls, real 1px borders, and one typeface at three weights. IBM Plex Sans Light carries every name and heading; Regular carries reading text; Medium appears only on project names. IBM Plex Mono is reserved for real identifiers, paths and stored values. Motion is one moment: the plate slides 6px into place over 200ms when you approach.

**Key Characteristics:**
- One flat ground (`ground`), a plate one step up, controls two steps up; no gradient on any surface, no texture, no grid.
- Bodies: soft ink core with a Gaussian glow, a hairline orbit ring, ticks per declared source, name beside (desktop) or below (compact).
- Brightness snaps in five steps from the latest read: now 1.0, hours 0.7, days 0.4, months 0.2, never 0 (outline only).
- Amber = observed change, red = cannot see, blue = waiting on you; neutral states carry no colour; pure white is the bloom only.
- IBM Plex Sans 300/400/500 and IBM Plex Mono 400/500, self-hosted under CSP `default-src 'self'`; tabular numerals on the root.
- Real 1px borders; the focus ring is white, never blue; no raster anywhere.

## Colors

A single cool night ground, a four-step ink stack, three functional signal colours with one meaning each, and pure white held back for one point.

### Primary
- **Ink** ({colors.primary}, token `primary`): the body core, the glow, every name and heading, the wordmark, the loss line in the field and the plate (words carry the loss), the footer's gap sentence, the fill of the primary button, and the caret. 16.6:1 on ground.

### Secondary
- **Amber — observed change** ({colors.amber}): only two places. The solid full-length tick on a body's ring for a `changed` source (3.5px, full opacity), and the `endret` status word in the plate's source rows. Not the signal line, not a label, not a fill. 10.6:1 on ground.
- **Red — EcoSym cannot see** ({colors.red}): a 1px rim only. The rim of the occluder, the rim of the `missing` gap bar on the ring, the `mangler` status word in the plate, the failure notice's ring, and the 1px left rule on an alert. Never a fill, never error-in-general. 5.3:1 on ground.
- **Blue — waiting on you** ({colors.blue}): the bloom's radial halo (0.55 → 0.16 → 0 alpha), the `venter på deg` label beside the bloom, the waiting signal line in the field and plate, and the project-state word for `påbegynt` / `mappe opprettet` / `registrering ukjent` / `mislyktes`. Never a link colour, never focus. 7.1:1 on ground.

### Tertiary
- **Bloom** ({colors.bloom}): pure white, reserved for the 3.2px-radius bloom point beside a civilization with a project not yet `established`, and for the primary button's hover fill. It is the brightest point in the field and nothing else reaches it.

### Neutral
- **Ground** ({colors.ground}): the page, the field, the occluder's fill, the `missing` gap bar that cuts the ring, and the input's fill so a field reads as a cut into the plate.
- **Plate** ({colors.plate}): the reading plate, one step up from ground.
- **Raised** ({colors.raised}): the quiet button's fill and the disabled primary button, two steps up. **Raised hover** ({colors.raised-hover}) is the quiet button's hover fill only.
- **Ink 2** ({colors.ink-2}): secondary reading text — identifiers, the neutral signal line in the plate, the `ulest` status word, field labels, project marks, mono record values, `påstand` marks. 10.2:1 on ground.
- **Ink 3** ({colors.ink-3}): captions and meaning — the field line under a name, the plate's domain and `h3` subheads, gaps, meanings, project states and paths, evidence column heads and caption, `.dim` / `.empty`, placeholders, the footer. 6.6:1 on ground. Caption-weight text only; never running body copy.
- **Ink disabled** ({colors.ink-disabled}): disabled buttons, inputs and the disabled `Les på nytt` link. 3.3:1 on purpose: affordance text, not content.
- **Line** ({colors.line}): the stronger rule — the plate's edge, input and button borders, the evidence column-head rule, the record's top rule.
- **Hairline** ({colors.hairline}): the quiet rule — source rows, project rows, evidence cells, disabled button borders.
- **Ring** ({colors.ring}): the orbit ring's rest stroke at 1px; the never-read core outline and the notice ring use 0.35, hover 0.6. **Ring hot** ({colors.ring-hot}): the ring of the current or focused body at 1.5px.
- **Focus** ({colors.focus}): the 2px white outline on every `:focus-visible`, the focused input's border, and the dashed 2px hit-circle stroke around a focused body.
- **Selection** ({colors.selection}): `::selection`, colour inherited.

### Named Rules
**The One Meaning Rule.** Amber is observed change, red is EcoSym cannot see, blue is waiting on you. None of the three appears on a neutral state, as decoration, or with a fourth meaning. Loss wins over waiting, waiting wins over velocity on a signal line.

**The Rim Rule.** Red is a 1px stroke, never a fill: the occluder and the gap bar are filled with ground and rimmed in red. Words carry the loss (`Ingen signal: … mangler`) in full ink; the rim carries the colour.

**The One White Point Rule.** Pure white ({colors.bloom}) exists in the field only as the bloom for a project waiting on you. Every other light is ink at a stepped opacity.

**The White Focus Rule.** Focus is white ({colors.focus}), 2px, offset 2px; a focused body adds a dashed 2px hit-circle. Never blue.

## Typography

**Display Font:** IBM Plex Sans (self-hosted 300/400/500, latin + latin-ext, `web/fonts/plex-sans-*.woff2`, OFL in `web/fonts/OFL-ibm-plex.txt`; fallback Cantarell, Noto Sans, Segoe UI, system-ui, sans-serif)
**Body Font:** IBM Plex Sans (same stack)
**Label/Mono Font:** IBM Plex Mono (self-hosted 400/500, latin + latin-ext; fallback ui-monospace, Liberation Mono, Menlo, Consolas, monospace)

**Character:** A phosphor-thin grotesque. Light 300 carries every name and heading — body names in the field, the plate title, the notice heading, the wordmark — so the largest text is the lightest. Regular 400 carries everything read; Medium 500 appears only on project names. No letter-spacing except +0.01em on the wordmark; no uppercase anywhere; `font-synthesis: none`; italic only on the `tid ukjent` temporal mark. `tabular-nums` is set on the root so every gap (`nå`, `4 min`, `3 d`, `aldri`) aligns.

### Hierarchy
- **Display** (300, 28px, 1.1): the plate `h1` — the civilization's name.
- **Headline** (300, 26px, 1.15): the notice heading (`Leser verden`, `Ingen forbindelse til verden`, `Ingen sivilisasjoner grunnlagt`).
- **Name** (300, 22px, SVG): a body's name in the field; **Name compact** (300, 16px) on a narrow or dense sky.
- **Wordmark** (300, 18px, +0.01em): `EcoSym` top-left, nothing beside it.
- **Title** (400, 17px): every plate `h2` (`Mandat`, `Kilder`) and the `Prosjekter` heading. Sentence case, never a kicker.
- **Body** (400, 15px, 1.45): the root size — mandate items, source rows, project marks, the plate's domain line and signal line, notice paragraph.
- **Subtitle** (500, 15px): project names (`h4`); the only Medium in the system.
- **Body small** (400, 14px): button text, plate `h3` subheads (`Kan gjøre alene`, `Må eskaleres`) in ink-3, the evidence caption, the alert.
- **Caption** (400, 13px): the field line under a name, the wait label, the footer, source gaps and meanings, field labels, project state, evidence heads and cells, the record summary count; **Caption compact** (12px) in the SVG on a compact sky.
- **Mono** (400, 12px, 1.6): stored record values and workspace paths; identifiers (`.id`) inherit `code` at 0.88em in ink-2.

### Named Rules
**The Light Names Rule.** Names and headings are Light 300 at the top of the ramp (28 / 26 / 22 / 18 / 16); nothing bold exists. Emphasis is size and ink step, never weight.

**The One Face Rule.** IBM Plex Sans for everything readable; IBM Plex Mono only for a real identifier, path or stored value. Mono is never a costume for labels or headings.

**The Tabular Gap Rule.** Anything that reads as a time is a relative gap (`nå`, `12 min`, `3 t`, `5 d`, `2 mnd`, `aldri`) in tabular numerals; never a clock time or a date.

**The Two-Line Label Rule.** A field label wraps to at most two lines at the last space before 28 characters (30 compact), 16px apart; it never truncates and never goes to the left of a body.

## Layout

Desktop is a fixed frame at `100dvh` with no page scroll. The field is an inline `<svg>` filling the frame from the left edge to `100% − 480px − 64px` (the plate's width plus its 32px inset on both sides) and stopping 150px above the bottom for the footer; bodies are laid out only inside this region, so approaching a body costs no reflow and the plate never covers one. The wordmark sits at 32px / 26px; the footer at 32px / 24px, capped at 46ch. The plate is absolutely positioned on the right, 480px wide, inset 32px on top, right and bottom, and scrolls internally with `overscroll-behavior: contain`.

Position in the field is derived, never authored (`web/sky.ts`): a sparse sky is an ellipse inside the strip the field keeps clear (120px under the wordmark, 130px above the footer, and a 310px reserve at the right edge: ring 56 + 16 + a 230px label + 8, so a label beside a body always fits). The angle comes from an FNV-1a hash of the civilization id, the reach from founding order, and a 23° sweep steps the angle, then the reach, until the body's label box clears every body already placed (370px horizontally or 130px vertically: a ring plus its label band). The same snapshot always yields the same sky and a new founding never moves an older body. More bodies than the ellipse holds re-project once onto a compact lattice (300 × 150px cells) with 40px rings and labels under each body; a narrow field is a single centred column at 190px steps in founding order.

Inside the plate, blocks stack at 26px; a heading sits 6px above its content, a subhead 4px; mandate lists split into `auto-fit, minmax(180px, 1fr)` columns at 12px 24px; source and project rows are 9–10px tall over hairlines; the evidence table sits 16px below the rows; the record body opens 14px under its summary. Spacing is an observed 4px-ish rhythm without a named scale: 4 (inner gaps), 6 (heading gap, label gap), 8 (button gap, evidence cells), 10 (project rows, form gap), 12 (button padding, mandate row gap), 16 (plate-head gap, evidence top), 24 (mandate column gap), 26 (plate blocks), 28 (plate top, notice gap), 32 (plate inset and side padding).

Under 1144px (`max-width: 1143px`, the plate's own width plus the field's minimum) the frame becomes a single scrolling column: wordmark (18px 16px 0), then the field at 56dvh (minimum 440px, growing to `190px × bodies + 160px` when the field is under 600px wide so bodies read as one column, 190px apart), then the plate as a static sheet with 12px side margins and 22px 16px 28px padding, then the footer. Under 600px of field width the sky is always a single-column lattice. Hover styles apply only under `(hover: hover) and (pointer: fine)`. No horizontal scroll at any width.

## Elevation & Depth

Flat, tonal, three steps, no shadows. Depth is `ground` → `plate` → `raised`, with real 1px borders at `line` or `hairline` marking every edge. The only blur in the build is the body's glow: a duplicate core circle at 2.4× radius through an SVG `feGaussianBlur` (stdDeviation 16) at 0.22 × brightness, which is a light source, not an elevation. The bloom's halo is a radial gradient of blue to transparent at 22px radius. Nothing else glows; no `box-shadow` exists anywhere.

### Named Rules
**The Three Tones Rule.** Every surface is ground, plate or raised. No fourth tone, no surface gradient, no texture.

**The Real Border Rule.** Rules and frames are 1px `border` or 1px SVG `stroke` at line, hairline, ring or a functional colour; never shadow-as-border.

**The Derived Light Rule.** A glow exists only on a body whose latest read is recorded, at exactly its brightness step. No ambient light, no twinkle, no atmosphere to fill the dark.

## Shapes

Circles in the field, softly squared controls on the plate. A body is concentric circles: a core (radius 18 + 10 × brightness, 0 when dissolved), a glow at 2.4× the core, an orbit ring at radius 56 (40 compact) with a 1px stroke, and ticks as arc paths on the ring — a full tick spans 70% of the sector's spacing (max 0.9 rad), a half tick a third of that, a `missing` gap 70% of a full tick. Tick strokes are 2.5px butt-capped (3.5px amber for `changed`, 1px for an attempt in progress, `4 5` dash for `unread`); the `missing` gap is an 8px ground bar with a 1px red rim over it. The occluder is a ground-filled circle of radius core + 6 (min 24) offset +12 / −6 from the centre with a 1px red rim: a hard edge, never a fade. The bloom is a 3.2px white point at the ring's upper-left with a 22px blue halo. The notice ring is a 56px circle with a 1px stroke.

Everything on the plate rounds to 4px: the plate itself, buttons and inputs; the notice ring is fully round (`border-radius: 50%` in the build, `round` in the tokens). Rules are straight 1px lines; the `påstand` mark carries a 1px dashed underline; the alert a 1px red left rule. No pills, no chevrons, no clip-paths, no icons, no ornament.

## Components

### Body (signature)
One `<g role="button" tabindex="0">` per civilization; nothing on it moves, grows or lights without a snapshot field behind it.
- **Core and glow:** ink circle at `0.25 + 0.75 × level` opacity, glow at `0.22 × level`; a never-read body shows an 18px ring outline in ring-0.35 and no core; a dissolved body shows only the orbit ring and the label `oppløst`.
- **Ring:** 1px at `ring`; hover 0.6 (fine pointer); current (`aria-current="page"`) or focused 1.5px at `ring-hot`, 120ms ease. Focus also strokes the hit circle (radius ring + 4) with a dashed 2px `focus` ring.
- **Ticks:** one arc per declared source from the top, clockwise: `changed` solid amber, `quiet` half-length ink, `unread` dashed ink, `missing` a ground gap with a red rim; an attempt in progress thins to 1px.
- **Occluder:** on any `missing` source, a `failed` / `record-index-unknown` latest read, or an unreadable declaration; ring and ticks stay visible outside it so the cause stays readable.
- **Label:** name (22 / 16 compact, Light) with the line under it (13 / 12): the gap since the latest read (`lest for 4 min siden`, `aldri lest`), or the loss words in full ink when the body is occluded, or `oppløst`. Beside the ring (+16px, baseline +2) on desktop; below it (ring + 22px, centred, clamped inside the field) when it would not fit, or always on a compact sky. Wraps to two lines.
- **Bloom:** when a project is not established: white point and blue halo at the ring's upper-left, `<prosjekt> venter på deg` (or `N prosjekter venter på deg`) in blue 13px, right-aligned above the ring on desktop, under the label stack on a compact sky.
- **Keyboard:** Left/Right travel in angular order, Up/Down in founding order, Enter or Space approaches, Escape closes and returns focus to the body.

### Reading plate
- **Style:** `plate` fill, 1px `line` edge, 4px radius, 480px wide, padding 28px 32px 32px, blocks 26px apart; fades in with a 6px translateX over 200ms `cubic-bezier(0.16, 1, 0.3, 1)` (`plate-in`); closes instantly.
- **Head:** title (28 Light), domain (15 ink-3), signal line (15 ink-2; loss in full ink, waiting in blue); `Lukk` as a quiet boxed button top-right, focused on open.
- **Blocks:** `Mandat` (dim status sentence, two plain lists under `h3` subheads), `Kilder` (source rows), the evidence table, `Prosjekter`, and `Hele posten` as a `details` with a `line` top rule.
- **Narrow:** static sheet under the field, 12px side margins, 22px 16px 28px padding, no internal scroll.

### Source row
Grid `identifier · status word · gap` over a meaning line, 9px vertical padding, hairline top rule. Identifier is `code.id` in ink-2; status word `endret` amber / `mangler` red / `ulest` ink-2 / `stille` ink-3, with ` · lesing pågår` appended during an attempt; gap and meaning 13px ink-3.

### Evidence table
Full width, 13px; caption `Lagrede felt` 14px ink-3 left-aligned; column heads 13px/400 ink-3 over a `line` rule (sentence case, no uppercase); cells 8px 12px 8px 0 over hairlines, first and last columns `nowrap`. `påstand` is ink-2 with a 1px dashed ink-3 underline; `historisk` ink-3; `tid ukjent` ink-3 italic.

### Record (`details`)
`line` top rule, 14px padding; a pointer summary with a 13px dim count; fields 14px apart, each a 14px ink-3 `h3` over pre-wrapped mono 12px ink-2 values.

### Projects
`Prosjekter` at title size in ink; rows 10px over hairlines: name (15/500) with the state word right-aligned (13px ink-3, blue for the four waiting states), a mark line in ink-2 13px, the workspace path in mono ink-3, and `Prøv igjen` as a quiet button for anything not established. The form stacks label + input, label + select, and the primary `Opprett` at 10px.

### Buttons
- **Shape:** softly squared (4px), 34px minimum height, 7px 12px padding, 14px/400.
- **Quiet (`.btn`):** `raised` fill, ink text, 1px `line` border — `Prøv igjen`. **`.btn-quiet`** is the same on a transparent fill — `Lukk`.
- **Primary (`.btn-primary`):** ink fill, ground text, ink border — `Opprett`, one per form.
- **Hover / Focus / Active:** quiet hover to `raised-hover`, primary hover to white (fine pointer only); 2px white outline offset 2px on focus; `scale(0.97)` over 120ms on press (transform 120ms exponential ease-out, background 120ms ease).
- **Disabled:** ink-disabled text, hairline border; primary falls back to `raised`.
- **Link (`.link`):** `Les på nytt` in the footer — no box, ink text with a 1px bottom border at ink-0.35, 12px left margin; disabled drops to ink-disabled with no underline.

### Inputs / Fields
- **Style:** ground fill, 1px `line` border, 4px radius, 8px 10px padding, inherited 15px; label 13px ink-2 stacked 6px above; placeholder ink-3; `select` shares the style.
- **Focus:** outline removed, border turns `focus` white. Never blue.
- **Error / Disabled:** errors render as an `.alert` paragraph (ink text, 14px, 1px red left rule, 10px inset) under the form; disabled text ink-disabled.

### Notice (loading / failure / empty)
Centred in the field: a 56px hairline ring (ring-0.35; 0.6 while loading; red on failure) and a 46ch column with a 26px Light heading and a 15px ink-3 paragraph, 28px apart. No spinner, no skeleton, no motion. Narrow: single column, 24px 16px.

### Footer
Bottom-left, 13px ink-3, 4px between lines, 46ch max: the gap sentence in ink (`Sist lest for 4 min siden`) with the `Les på nytt` link, any truncation lines, and the reserved-seats line (`Kronikeren, koordinatorene og rådet er ikke koblet til ennå.`) as plain dim text.

### Motion
One moment: the plate fades in and slides 6px over 200ms `cubic-bezier(0.16, 1, 0.3, 1)`. Buttons press in 120ms; the ring's stroke and the input's border ease over 120ms. Brightness, occlusion and ticks snap in one frame after `Les på nytt`. `prefers-reduced-motion: reduce` swaps the slide for an opacity-only fade and removes the button and ring transitions and the press scale.

### Browser surfaces
Scrollbars thin, thumb white at 0.12 on transparent (0.20 on hover), 10px WebKit with a 6px radius and 2px transparent inset. Selection is ink at 0.16 with inherited text colour. `color-scheme: dark` on root and in the document head.

## Do's and Don'ts

### Do:
- **Do** derive every visible property from a snapshot field: brightness from `lastRead` in five snapping steps, ticks from declared sources, the occluder from lost sight, the bloom from a project not yet established.
- **Do** keep amber, red and blue to one meaning each — observed change, cannot see, waiting on you — and leave neutral states uncoloured.
- **Do** carry state in line form first (full, half, dashed, gap, hollow) and add hue only on the solid `changed` tick and the status word.
- **Do** write loss in words on the line under a name and on the plate's signal line, in full ink, and keep red to the 1px rim.
- **Do** set names and headings in IBM Plex Sans Light 300, reading text in 400, and every gap in tabular numerals as a relative time (`4 min`, `3 d`, `aldri`).
- **Do** build every surface from the three tones (ground → plate → raised) with real 1px borders at line (0.08) or hairline (0.06).
- **Do** self-host every asset from `web/fonts/` under CSP `default-src 'self'`, and draw everything as SVG or CSS; there is no raster in the build.
- **Do** use the white 2px focus outline on every focusable element, a white border on a focused input, and the dashed white hit-circle on a focused body.
- **Do** keep the plate inside the right 480px + 64px so bodies never reflow on approach, and on narrow screens let the field become one scrolling column of compact bodies above the plate sheet.
- **Do** keep the 200ms exponential ease-out to the plate's entry and the 120ms press to buttons; honour `prefers-reduced-motion` with an opacity-only fade.

### Don't:
- **Don't** put blue on a focus ring, an input border or a link; blue means waiting on you.
- **Don't** load Google Fonts, a CDN `@import`, an inline style, or any off-origin image or raster; CSP will block it and the world stays self-hosted and vector.
- **Don't** add ambient motion, twinkle, drift, parallax, extra stars, a grid, constellation lines, or any texture to fill the dark; an empty field is a true sky.
- **Don't** use pure white anywhere but the bloom and the primary button's hover; every other light is ink at a stepped opacity.
- **Don't** fade an occluded body or lower its brightness; sight lost is a hard-edged occluder with a red rim, and the ring and ticks stay visible outside it.
- **Don't** give a civilization a colour of its own; identity is position and name.
- **Don't** add drop shadows, box-shadows or shadow-as-border; the only blur is the body's glow filter.
- **Don't** introduce a top bar, rail, cards, a hero metric, kicker or eyebrow labels, uppercase headings, glyph icons, or slogans; the field is the interface.
- **Don't** use IBM Plex Mono for labels, headings or prose; it is for identifiers, paths and stored values only.
- **Don't** infer activity, success or presence: a `changed` tick means fields were seen at the last read, not operational success, and the meaning line says so.
