# Ecosym — world surface design contract

Scope: the browser world surface (`app/`). Prototype branch `proto/world-surface`.
Everything the surface renders arrives as a scene description derived from
observations; the surface never reads a source. Synthetic fixture data is
labelled as such in the UI.

## Feeling

Opening Ecosym is unrolling a chart that someone has been keeping by hand.
The map is drawn in iron-gall ink on vellum; what has been seen is inked, what
has not been seen is bare skin. Coming down into a settlement is not a page
change: the same ink thickens into roofs, lanes, and people going about work.
Reference boundary: **a kept chart, not a game HUD; an engraving, not a
dashboard.** No glass, no glow, no gradient panels, no floating nameplates.

## The three cameras

One continuous camera. Zoom preserves the point under the pointer. Three
levels of detail are crossed by zoom alone, and a click on a place flies the
camera to the level that place deserves:

| Level | Zoom | What is drawn |
|---|---|---|
| **Chart** | 0.35 – 1.6 | Vellum, coastlines, each civilization as an engraved city on its own ground, the Capital as a compass-rose citadel, ink routes only where a petition or exchange actually crossed a border, and the plate's own marginalia (title, date of last observation). |
| **Settlement** | 1.6 – 6 | Top-down: walls, lanes, buildings derived from what the civilization contains, inhabitants walking between the buildings they are working in. The civilization's **seat** (its own name for it — Curia, Ting, Diet) as the largest structure. |
| **Inside** (panel, not zoom) | any | Clicking an inhabitant opens its transient-work sheet; clicking a seat opens the seat: mandate, what it may do alone, the council matters it raised, and a petition composer. The panel is a sheet laid on the chart, never covering the focused place. |

Scale contract:

- **World geometry** (coastlines, inter-city distance, lanes, walls) scales
  with the camera.
- **Identity sprites** (inhabitants, seat silhouettes) hold a fixed logical
  size once the settlement level is reached; below that they are hidden, not
  shrunk. A person must read as a person (head, body, direction of travel) at
  the size it is drawn or it is not drawn.
- Level transitions are a crossfade of ink, 400 ms, ease-out; the vellum and
  camera never jump. `prefers-reduced-motion` drops the crossfade to a cut.

## Truth on the surface

- **Unobserved is bare vellum.** A civilization Ecosym has stopped seeing is
  drawn as an outline with no ink inside and the note *non observatum* plus the
  time of the last observation. Never dimmed, never greyed: absent.
- **Live is a moving figure. Finished is a trace.** A running inhabitant walks
  and carries something. Finished work is a footprint-line in the lane that
  fades over the retention window. Nothing walks that is not observed running.
- **A petition is a sealed letter**, drawn on the route from the Capital to the
  seat it was sent to, stamped with its state (sent, accepted, queued, in
  progress). It never becomes a building. Outcome is only ever shown when
  observed, as a separate object attributed to the petition.
- **Prosperity is derived, never authored.** Building count, lane wear, and
  ink density come from observed work volume; there is no "health" colour.
- **The Capital is the world's headquarters.** It holds a hall for every
  civilization's seat, in summary only: name, seat name, open council matters,
  observation freshness. Detail is reached by going there.

## Colour

Strategy: Committed — the vellum owns the surface.

| Token | Value | Role |
|---|---|---|
| `--vellum` | `#d9c49a` | ground; darkens to `#c7ad7c` at the edges under raking light |
| `--ink` | `#3b2a1a` | every drawn line, all type |
| `--ink-faint` | `#8a7452` | faded routes, old traces, marginalia |
| `--seal` | `#9c3524` | petitions and council matters, the only red, never decoration |
| `--tide` | `#7f8c86` | sea wash, coastal stain |
| `--wash-live` | `#b89a4a` | ochre wash under a settlement with observed running work |

Accent (`--seal`) is earned only by a request or a council matter. Running work
is shown by motion and the ochre wash, not by a colour chip.

## Typography

- Marginalia, cartouche, seat names: **IM Fell English** (Fell types are the
  chart's own hand; italic for notes).
- Sheets, inspectors, petition composer: **Alegreya**, 16/24, with Alegreya
  small caps for labels.
- Numbers and timestamps: Alegreya, tabular.
- Ratio: cartouche 40 → seat name 22 → sheet body 16 → marginal note 13.

No sans-serif anywhere on the surface.

## Motion

- Inhabitants walk at 24 logical px/s along lanes; a carried object bobs.
- Camera fly: 600 ms, cubic ease-out, focal point preserved.
- Petition letters slide along their route on state change, 300 ms.
- Nothing pulses, breathes, or glows. A quiet world is still.
- `prefers-reduced-motion`: walking becomes standing at the building; camera
  flies become cuts; letters snap.

## Bans

- No nameplates at chart level; identity on hover or in the sheet.
- No status colour semaphore (green/amber/red).
- No side panel as the primary selected state; the sheet lies on the chart.
- No "health", "score", or "progress" number the observations do not contain.
- No building, route, or figure that does not correspond to an observation or
  a declared mandate.
