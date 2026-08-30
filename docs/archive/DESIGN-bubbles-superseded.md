# DESIGN.md — Axey (SUPERSEDED, ARCHIVED)

> **Not canonical. Not binding. Historical evidence only.**
>
> This describes an agent-monitor visualization — bubbles in a Vogel spiral,
> sized by activity — from a direction that has been abandoned. Axey is a world
> of civilizations: domain-first, with form derived from observed state per
> `PRODUCT.md` and the form boundary in `ARCHITECTURE.md`.
>
> Two rules here actively conflict with the current specification: "the bubbles
> ARE the visualization", and size/colour as direct activity indicators with no
> state for lost observation — which would render "cannot see" as "quiet".
>
> Kept for the colour, typography, and motion discipline, which may inform a
> future visual owner. Do not implement from this document.

Valgt, ikke arvet. Hver linje her er en beslutning; avvik måles med
`npx impeccable detect`.

## Følelse

Cyberpunk, dempet. Et instrument i et mørkt rom — ikke en neonplakat.
Fargen er nesten borte helt til noe skjer. Da lyser det.

Referanse er en oscilloskopskjerm, ikke Blade Runner-plakaten.

## Farge

Bakgrunnen er ikke svart, den er blåsvart — kald, ikke nøytral.

| Token | Verdi | Bruk |
|---|---|---|
| `--bg` | `#07090d` | bunn, blåstukket |
| `--line` | `#161c26` | kanter, hvilende |
| `--tx` | `#dfe7f0` | primærtekst |
| `--tx2` | `#8b97a8` | sekundær |
| `--tx3` | `#5d6878` | tertiær — min. 4.5:1 mot bg |
| `--cy` | `#3ddbd9` | AKTIV. Kun når noe faktisk kjører |
| `--mg` | `#e6427a` | feil. Sjelden |

Regelen: **cyan betyr alltid at noe skjer.** Er alt rolig, er skjermen
gråblå. Farge er informasjon, ikke pynt.

Ingen gradienter. Ingen glød på hvilende elementer — glød er reservert
for kjørende agenter, og da som puls, ikke statisk skinn.

## Typografi

**Ett stort tall dominerer. Alt annet er smått.** Det flate hierarkiet
(11/13/14/16px) var feilen — ingenting var viktig.

| Rolle | Størrelse | Font |
|---|---|---|
| Tall i boble | 34px | mono, tabular |
| Agentnavn | 15px | sans |
| Metadata | 11px | mono, uppercase, tracking |

Ratio 34:15 ≈ 2.3 — godt over 1.25-kravet.

Fonter: **Chivo Mono** (tall, metadata) og **Archivo** (navn). Ikke Inter,
ikke Geist, ikke IBM Plex — de tre er 2026-defaulten.

## Form

Boblene ER visualiseringen. Ikke dekorasjon rundt en liste.

- Sirkler, ingen radius-token — enten helt rund eller skarp kant
- Størrelse = aktivitet. Tom agent er liten og nesten usynlig
- Hvilende: 1px kant, ingen fyll
- Kjørende: cyan ring som puster, 2.6s
- Fordeling: Vogel-spiral fra sentrum

## Bevegelse

Fra Emil Kowalski, verifisert:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

- Under 300ms for alt UI
- `scale(0.97)` på `:active`
- Aldri animer fra `scale(0)` — start 0.95
- **Full `transform: translate(...)`, aldri Motions `x`/`y`-shorthand**
  (shorthand kjører rAF på main thread — ikke GPU)
- Ingen animasjon på ting som skjer 100+ ganger/dag

## Forbudt

- Inter, Roboto, Geist
- Lilla/indigo aksent
- Varm krem + serif + terrakotta (2026-defaulten)
- Gradienter, glassmorfisme
- Emoji som ikon
- Like fontstørrelser uten hierarki
