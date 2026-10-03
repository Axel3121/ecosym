# Designstacken — hvordan UI-arbeid går fra idé til kode

Skrevet for Axel. Dette er *hva* stacken er og *hvorfor* hvert steg finnes.
Kommandoene bor i skillene; dette er kartet.

## Kort versjon

Design er en pipeline med sju steg og én menneskelig gate. Ingenting bygges
før gaten er passert. Alt som avgjøres skrives ned i repoet, ikke bare i chat.

    1 Brief → 2 Retning → 3 Tokens → 4 Mockup → [GATE: din kritikk] → 5 Bygg → 6 Verifiser → 7 Ship

Inngangsdør: `~/.hermes/skills/creative/ui-design-pipeline/SKILL.md`.
Den bestemmer rekkefølgen og hvilken skill som eier hvert steg.

## Stegene

### 1 — Brief (chat)
Én avsnitt: hvem bruker det, hva er den ene jobben skjermen gjør, plattform,
eksisterende tokens. Her avgjøres også *modellen* — hva produktet faktisk
består av. Dette steget feilet tre ganger for EcoSym (status-side → skjema →
chat) før modellen var riktig: HQ = oversikt, sivilisasjon → prosjekt →
agent, kronikeren som nærvær, samtale med koordinator. Skriv briefen ned i
`docs/design/direction-decision.md` før noe annet.

Lærdom: les produktet (PRODUCT.md, snapshot-kontrakt, CLI) *helt* før
briefen. `docs/design/product-reality.md` er beviset på hva som faktisk
finnes i backenden — chat, agenter og narrator er erklært, ikke bygd.

### 2 — Retning (`design-reference-gathering` + `popular-web-designs`)
Velg 1–2 referansesystemer (Linear, Vercel, Raycast, Discord…) og si *hvilket
mønster* som lånes og hvorfor. Aldri en hel identitet. Resultat:
`docs/design/direction.md`.

Ekstra: `impeccable concept-seed` deler ut en tilfeldig *visuell verden*
(transit-kart, nixie-rør, split-flap…) for å tvinge oss ut av
«mørkt dashboard»-ruten. Du velger på en beslutningsside i nettleseren:
assigned / challenger / canon / re-roll. «Canon» = kategoristandarden gjort
skikkelig; da spør stacken hvilke produkter det skal måles mot.

### 3 — Tokens (`design-md`)
Lås palett, typografi, spacing, radius, motion, fokus-ring, selection,
scrollbar i `DESIGN.md`. Valideres med `npx @google/design.md lint DESIGN.md`
→ 0 errors, 0 warnings. Regler som har bitt oss: én betydning per
funksjonsfarge (amber = observert arbeid, rød = kan ikke se, blå = venter på
deg), fokus-ring aldri blå, CSP `default-src 'self'` → ingen Google Fonts.

### 4 — Mockup (`penpot-agent-design`)
Ekte Penpot-lag via MCP, ikke bilder. Eksport med `export_shape`, PNG til
`docs/design/mockups/`. Krever en innlogget Penpot-fane (agentkontoen
`hermes@hermes.local`, passord i `~/.hermes/cache/penpot-agent.secret`,
holdt oppe av `~/dev/_scratch/ecosym-mockups/penpot-session.cjs`).

Genererte bilder (`image_generate`) brukes bare i stage 2 for å velge
verden — aldri som mockup. De fyller alt med slagord og tre fonter.

### GATE — din kritikk
`impeccable critique` kjøres først: to *isolerte* subagenter (A = designreview
med Nielsen-score, B = detektor-bevis) som ikke ser hverandre, så syntese.
Snapshot lagres i `.impeccable/critique/`. Så leser du bildene og sier hva
som funker og ikke. «Ser bra ut» holder ikke. Kritikken siteres ordrett i
bygg-steget som bevis på at gaten var passert.

### 5 — Bygg (`impeccable` + `emil-design-eng`)
Produksjonskode i `web/` fra `DESIGN.md`-tokens. `impeccable` sin craft-floor
(`reference/craft-floor.md`) er bindende: ingen eyebrow-labels, ingen
same-size ikonkort, ingen gradient-tekst, ingen mono som «teknisk» kostyme.
`emil-design-eng` leses for motion — 160 ms ease-out, aldri entrance-
animasjoner på alt.

### 6 — Verifiser
`impeccable detect web/` → 0 funn, eller hvert gjenværende navngitt med grunn.
Playwright-capture 1440×900 + 390×844. Fersk `impeccable-finish-reviewer`
(subagent, ingen historikk) må si `ship`. `impeccable-documenter` skriver
`DESIGN.md` om fra det bygde. Liste over hvert bevisste avvik fra mockupen.

### 7 — Ship (`release-pipeline` + `ecosym-dev-pipeline`)
Isolert worktree, `npm run check`, CodeRabbit (pr-agent og gpt-image er
bevisst utelatt fra stacken), eksakt-SHA-handoff.
Designpipelinen merger aldri selv.

## Hvor ting bor

| Hva | Hvor |
|---|---|
| Pipelinen (rekkefølge, gate-regel) | `~/.hermes/skills/creative/ui-design-pipeline/SKILL.md` |
| Låst brief for EcoSym | `docs/design/direction-decision.md` |
| Hva backenden faktisk har | `docs/design/product-reality.md` |
| Referanser | `docs/design/direction.md` |
| Tokens | `DESIGN.md` (repo-rot) |
| Mockups | `docs/design/mockups/` (avviste i `rejected-*/`) |
| Seed/critique/beslutning (gitignored) | `.impeccable/` |
| Craft-regler | `~/.hermes/skills/creative/impeccable/reference/craft-floor.md` |
| Referansesystemer | `~/.hermes/skills/creative/popular-web-designs/templates/` |

## Regler som ikke forhandles

- Skip av et steg sies i samme tur, med grunn.
- Ingen bygg uten sitert kritikk.
- Mockup er Penpot-lag, ikke et generert bilde.
- `impeccable` og `emil-design-eng` er hub-installert — aldri rediger dem.
- Alt visuelt må være derivert av data. En by som ser travel ut uten
  observert arbeid bryter PRODUCT.md sin ene ufravikelige regel.

## Status for EcoSym per 2026-09-17

Pit wall (rev 3) ble avvist av Axel 2026-09-16. Stage 1 kjørt på nytt: EcoSym er
et sted, ikke et dashboard (PRODUCT.md). Stage 2: concept-seed runde 5 (seed
`bf54548d`, experience) ga **Observatoriet**; to utforsker-subagenter skrev
fulle kontrakter (Observatoriet, Papirlyktene) i `.impeccable/explore/`. Stage 4
hoppet over på Axels instruks («vi trenger ikke alle de fancy bildene»);
Higgsfield/gpt-image var utløpt. Stage 5: Observatoriet bygd i `web/` (`sky.ts`
for avledet plassering og lysstyrke), taste-skill brukt som slop-kritikk. Stage
6: capture i `.impeccable/review/`, finish-reviewer, documenter (`DESIGN.md`).
Stage 7: CodeRabbit på arbeidstreet; commit og PR gjøres ikke av pipelinen.

## Status for EcoSym per 2026-09-16 (historisk)

Stage 1–3 ferdig for rev 2 (HQ-oversikt + tre lag). Stage 2 ble kjørt på
nytt med `concept-seed`; hånd 2 (festival / racing / nixie) er avgjort:
Axel valgte **racing league** (seed `cc2f9807`), skrevet ned i
`direction-decision.md` rev 3. Stage 3: `DESIGN.md` er skrevet om fra det
bygde (impeccable-documenter). Stage 4: hoppet over for dette uttrykket,
byggesti «code-led»; `hq-overview.png` og `civilization-utvikling-curia.png`
er rev 2-«canon» og ikke godkjent. Stage 5–6: pit wall bygd i `web/`,
detektor 0 funn, finish-reviewer `ship` etter én fikserunde, capture i
`.impeccable/review/` (1440×900 og 390×844). Stage 7: CodeRabbit kjørt på
arbeidstreet; commit og PR er ikke gjort av pipelinen.
