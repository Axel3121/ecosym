# Ecosym — world surface design contract

Scope: the browser world surface (`app/`). Prototype branch `proto/world-surface`.
Everything the surface renders arrives as a scene description derived from
observations; the surface never reads a source. Synthetic fixture data is
labelled as such in the UI.

Direction chosen 2026-09-02 (Axel, from a Stardew-like reference): a **hi-bit
pixel-art world**. The earlier vellum/engraving direction was built, shown, and
rejected ("dette er fis"); this document replaces it.

## Feeling

Opening Ecosym is looking down on a small painted country where your work
lives. Each civilization is a village in the landscape; the Capital is the
walled town in the middle. Going into a village is not a page change: the
same painting sharpens into lanes, houses, and people at work. Talking to a
place is leaving the map: focus mode, like a Stardew dialogue.
Reference boundary: **a cozy game world, not a dashboard; a place, not a
node graph.** No glass, no glow, no gradient panels.

## What is art and what is code

- **Art (generated, static):** the world painting (`world.png`), one
  close-up plate per settlement type (harbor, hill, orchard, lake), the
  Capital plate, walker sprites, smoke, fog. Art never carries state.
- **Code (the truth layer):** everything that depends on observations —
  which villages are fogged, where smoke rises, who walks, pennants,
  letters, labels. If it can be wrong, it is drawn by code from the scene.

Known prototype debt: a village's *form* is painted, not derived from what
it contains. PRODUCT.md says form is derived, never authored. Acceptable for
a prototype; a real build places buildings on the plate from observations.

## The cameras

One continuous camera over one painted world with an edge; the camera is
clamped to the map. Zoom preserves the point under the pointer.

| Level | Zoom | What is drawn |
|---|---|---|
| **World** | 0.7 – 1.5 | The painting. Labels on places, fog on the unobserved, smoke and tiny walkers where work runs, pennants for council matters, letters on roads. |
| **Settlement** | 1.5 – 5 | The settlement plate crossfades in over the painting. Walkers at readable size, smoke on occupied workshops, the seat as the largest building. |
| **Focus** (leaves the map) | — | Talking to a seat, an agent, or the council. Map blurred behind; portrait + facts left, conversation right. |

Scale contract: world geometry scales with the camera; walker sprites hold a
readable logical size (26–96 px) and are clamped, never blurred up.

## Truth on the surface

- **Unobserved is fog.** Never grey, never dimmed: covered. Label says
  "aldri observert" and nothing inside is drawn.
- **Live is smoke and a walking figure. Finished is nothing.** Smoke rises
  only over a workshop with an observed running inhabitant. Nothing walks
  that is not observed running.
- **A petition is a sealed letter** on the road from the Capital, positioned
  by its state, never by time. It never becomes a building.
- **Council matters are red pennants** over the seat. Red is earned only by
  a request or a council matter.
- **The Capital summarises.** One hall per civilization: name, seat name,
  live/quiet/unobserved, open matters. Detail is reached by going there.
- **Dialogue is fact + voice.** Facts come from the scene only. The voice
  (Curia terse, Ting dry, Bakufu courteous; agents by tool) is flavour and
  carries no facts. An order inside the mandate is sealed to the
  civilization; one that crosses it is sealed to the council. Agents refuse
  orders and point to their seat. "Why" is answered honestly: not observed.

## Colour

| Token | Value | Role |
|---|---|---|
| `--paper` | `#f6e2b8` | panel ground |
| `--paper-dark` | `#e3c894` | panel inset / conversation ground |
| `--frame` / `--frame-dark` / `--frame-light` | `#8b5a2b` / `#4a2c14` / `#c98a4b` | wood frame, buttons |
| `--ink` / `--ink-soft` | `#3a2410` / `#7a5a3a` | text |
| `--seal` | `#9e2a1e` | petitions, council matters, synthetic warnings (≥4.5:1 on paper) |
| `--live` | `#6fae4b` | the one "talk" affordance and hover states |

## Typography

Bitmap fonts served locally (`/fonts`): **Silkscreen** for headings and
labels, **Pixelify Sans** for body. No smooth sans anywhere in the chrome.
Ratio: title 26 → sheet/focus heading 24 → body 17–18 → captions 12–16.

UI chrome is Norwegian. Domain strings from fixtures may be whatever the
source says.

## Motion

- Walkers move 0.06–0.11 plate-units/s along a short errand, flip to face
  travel, 4-frame cycle.
- Smoke: 3 frames, rises and thins.
- Fog drifts slowly.
- Camera fly 600 ms ease-out. `prefers-reduced-motion`: walkers stand,
  camera cuts.

## Bans

- No status colour semaphore (green/amber/red).
- No "health", "score", or "progress" the observations do not contain.
- No building, smoke, figure, or route that does not correspond to an
  observation or a declared mandate.
- No sending: the petition path is not built; sealed letters stay in the
  prototype.
