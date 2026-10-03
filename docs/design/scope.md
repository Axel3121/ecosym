# Scope for EcoSym-flaten (avtales med Axel før noe bygges)

Startet 2026-09-17 etter at fire fulle bygg (rev 1–4) ble avvist. Regel: ingen
fullstendig app og ingen full loop før dette dokumentet er godkjent av Axel.

## 1. Jobben (Axels ord, 2026-09-17)

> jobber, ser status, forstår hva som skjer, ser hva agenter gjør

Lesning: fire ting i én setning, i den rekkefølgen. Han *arbeider* (flaten er
noe han har oppe mens han jobber, ikke en rapport han leser ferdig), han ser
*status*, han *forstår hva som skjer*, og han ser *hva agentene gjør*.

Åpent: agenter finnes ikke i world-snapshot i dag (`product-reality.md`). Hva
agentene gjør må hentes fra der det faktisk lever nå (Hermes-kanban-kort,
openclaw-økter, codex-kjøringer, logger). Avklares i punkt 2.

## 2. Avgrensning (Axels ord, 2026-09-17)

> nei ikke koble til noe enda, dette er egentlig bare design, ikke noe mer.
> Du trenger egentlig ikke koble det til backenden. Men liker kanban-brett,
> så kanskje det burde være en funksjon i EcoSym.

Lesning: dette er en **designoppgave**, ikke en integrasjon. Ingen tilkobling,
ingen grunnlegging, ingen backend-endring. Bakgrunn som ble funnet 2026-09-17
og som ikke skal handles på nå: den lokale EcoSym-databasen har fire
tilkoblinger og null sivilisasjoner; Hermes-brettet `ecosym` har 187 oppgaver
og 321 agentkjøringer som EcoSyms runtime-bro kan lese den dagen det er ønsket.

Retningshint: Axel liker kanban-brett. Kandidat til funksjon: en tavle over
hva agentene jobber med (kort = oppgaver, kolonner = tilstand, kortet viser
agent og utfall), sett fra en sivilisasjon.

## 3. Struktur (avtalt 2026-09-17)

Tre nivåer, bekreftet av Axel («ja det stemmer»):
1. **Verden**: stedet du åpner; sivilisasjonene, hvor det skjer noe, hvor
   sikten er tapt, hva som venter på deg.
2. **Sivilisasjonen**: ett sted du går inn i; mandat, kilder, prosjekter,
   agentene som jobber der.
3. **Funksjoner inne i sivilisasjonen**: kanban-tavla (kort = oppgaver,
   kolonner = tilstand, agent og utfall på kortet) er den første; «melding til
   worker» er en petisjon og vises som «ikke koblet til ennå» til backenden
   bærer den.

Kanban-tavla er en funksjon, ikke hele appen (Axel 2026-09-17).

## 4. Referansebilder (2026-09-17, kun til å gå ut fra)

Generert med gpt-image-2-high via Hermes (`~/bin/hermes-image`, provider
openai-codex). MiniMax image-01 (`~/bin/minimax-image`) ble prøvd og forkastet:
uleselig UI-tekst. Higgsfield er fortsatt utløpt.

- `.impeccable/mocks/refs-r6/gpt-verden.png`: nivå 1, fire sivilisasjoner som
  legemer i et mørkt felt.
- `.impeccable/mocks/refs-r6/gpt-sivilisasjon.png`: nivå 2 med tavla som
  aktiv fane og kildepanel til høyre.
- `.impeccable/mocks/refs-r6/gpt-tavle-kort.png`: ett kort åpnet, kjøringer og
  «melding til worker» (bildet fant på toppmeny, sidepanel og avatar som ikke
  er bestemt; referanse, ikke spesifikasjon).

Axel 2026-09-17: «føler kreativiteten din mangler litt» om de tre første. Fire
tydelig forskjellige verdener av samme skjerm (Utvikling med tavla) ble laget
i `.impeccable/mocks/refs-r6/`:

- `world-a-fog-map.png`: tegnet strategikart med krigståke; oppgaver er hus,
  kolonner er bydeler, tapt sikt er tåke over veien til Handel.
- `world-b-paper-desk.png`: skrivebord ovenfra; indekskort på lær, messing-
  plaketter, amber lakksegl på endrede kort, rødt bånd på det som venter.
- `world-c-isometric-night.png`: isometrisk nattby; hvert hus en oppgave, lys i
  vinduene bare der en agent nylig kjørte, rød sperretape på det blokkerte.
- `world-d-lantern-workshop.png`: papirlykt-verksted; tente lykter der noe
  kjørte, mørk lykt med stempel for det blokkerte, ferdige foldet flatt.

Axel 2026-09-17 om de fire: «dette ser jo ut som spill. Når jeg sier
kreativitet mener jeg ikke spill og sykt 3D fancy. Mener bare at oppsettet ikke
bare er svart-hvitt med masse kort, altså gjøre det litt behagelig og unikt å
sitte i. Ta deg god tid, bruk subs for å planlegge.»

Lesning: kreativitet = et grensesnitt som er behagelig og unikt å sitte i.
Ikke illustrasjon, ikke 3D, ikke spill. Ikke svart/hvitt, ikke kort overalt.
Personlighet gjennom farge, lys, typografi, rytme og noen få signaturdetaljer.

## 5. Retningsutforskning r7 (2026-09-17, tre planleggere parallelt)

- `.impeccable/explore/r7-atelier/`: «Dagslys-atelieret», lys og varm.
- `.impeccable/explore/r7-skumring/`: «Skumringsrommene», tonet mørk, én
  romfarge per sivilisasjon.
- `.impeccable/explore/r7-journal/`: «Journalen», redaksjonell og typografisk,
  papirtone, tavla som en hovedbok.

Alle tre leverte direction.md, tokens, tre signaturdetaljer, ærlighetsnote og
to bilder (verden.png, sivilisasjon.png) i sine mapper.

Syntese (Claude, 2026-09-17):
- Skumringsrommene er den mest unike og mest «sted»: Verden som fire fargede
  dører, og hele visningen tar sivilisasjonens farge når du går inn. Ikke
  svart, ikke grått, ingen kort. Risiko: fargen må være erklært per
  sivilisasjon (institusjonell), aldri avledet av aktivitet.
- Journalen har den beste signaturdetaljen: én avledet ledesetning øverst på
  hver side («Fire sivilisasjoner. Noe endret i Utvikling. Sikten tapt i
  Handel. Ett prosjekt venter på deg.»). Som helhet blir den en pent satt
  tabell.
- Atelieret er behagelig og brukbart, men sivilisasjonssiden er igjen kort i
  en boks, og uttrykket er kjent Notion/Claude-territorium. Beste detalj:
  margen som alltid bare inneholder «Venter på deg» og «Sikt».

Anbefaling: Skumringsrommene som base, med Journalens ledesetning og
Atelierets marg. Avventer Axels valg.
