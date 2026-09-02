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
| **Focus** (leaves the map) | — | Talking to a seat, an agent, or the council. Map blurred behind; portrait + facts left, conversation right. Dark, same type as the desk. |

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

## The desk and the map

Two zones, one product. **The map is the place; the desk is the tool.**
Chosen 2026-09-02 from three sketched directions (Inter / Plex Mono / Lora);
Axel picked the dark monospace desk ("B").

- The desk (left, 340 px) owns every fact and every action: attention
  counters, roster with keys 1–4 and C, the selected civilization's
  running-work tree and recent traces, the council queue with ja / nei / spør,
  and the observed-activity log. Selecting Capital shows the halls in summary.
- The map owns place and presence only. Nothing floats over the painting
  except place labels, the hover tip, and the bottom hint. A click on a
  village or the Capital flies there and selects it on the desk; a click on
  a walker or the seat opens focus mode.
- No dashboard chrome on the map (no graphs, gauges, badges over villages),
  and no game chrome on the desk (no bevels, pixel fonts, XP, scores).

## Colour

| Token | Value | Role |
|---|---|---|
| `--bg` / `--bg-2` / `--bg-3` | `#1d1a15` / `#2a251d` / `#332d24` | desk, panels, your messages |
| `--line` / `--line-2` | `#3a342a` / `#5a5040` | rules, borders |
| `--fg` / `--fg-dim` / `--fg-faint` | `#e6dcc3` / `#9a8f78` / `#6a6252` | text hierarchy |
| `--live` / `--live-dim` | `#a7d98a` / `#7fb35a` | observed running work; the "ja" and "talk" affordances |
| `--seal` / `--seal-dim` | `#e8735c` / `#c4553f` | matters waiting on you, border-crossings (⚑), "nei", petitions |

Colour discipline: green means *observed live* or *yes*; red means *needs
you* or *crosses a border* or *no*. Everything else is cream and grey.
The synthetic-fixture note is grey, not red: it is information, not alarm.

## Typography

**IBM Plex Mono** (400/500), served locally from `/fonts`, for all text —
desk, hover, hint, focus mode, and the place labels drawn on the canvas.
Pixel-art lives only in the painting, never in type.
Sizes: body 13, counters 22, headings 11 uppercase tracked, meta 11–12.

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
