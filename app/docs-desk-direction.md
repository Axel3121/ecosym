# Desken — en retning som ikke er et dashbord

## Hvorfor de fem falt

Alle fem forsøkene endret overflaten (mørk mono, ledger-streker, cream, terminal) og beholdt strukturen. Det er selve tellet: strukturen er en generisk «AI-godkjenningskø», og ingen maling endrer det.

Konkret, fra skjermbildene:

- **Stat-kort-rad**: fire like store bokser med tall («3 saker venter», «2 i arbeid», «1 stille», «1 aldri sett»). Ren SaaS-KPI-vane, uavhengig av at innholdet er levende sivilisasjoner.
- **Ikon-faner med badges**: hjem/flagg/konvolutt-ikoner, en rød rund «3» klistret på. Ikonet bærer ingen mening alene, badgen gjør jobben ikonet skulle gjort.
- **Segmentert kontroll øverst til høyre**: «« skjul / side / full» i tre bokser med kant — samme mønster som enhver admin-topplinje.
- **Kort-i-kort-i-kort**: hvert rådsspørsmål er identisk oppbygd (metadata, tittel, flagg, tre knapper). Når malen gjentas ordrett blir innholdet usynlig; man ser malen.
- **Fargede knapper som chrome**: ja/nei/spør som tre kantede bokser i grønt/rødt/grått, i stedet for at fargen sitter i selve ordet.
- **Tall-badges foran roster**: 1, 2, 3, 4, C i firkanter — samme visuelle vekt som et notification-ikon i et hvilket som helst SaaS-produkt.
- **Mono overalt, også i løpende tekst**: gjør at rådsvedtak og samtale-forhåndsvisninger leses som systemlogg, ikke som noe et menneske skrev.
- **SAMTALER uten ansikter**: nøyaktig det motsatte av det som ble bedt om — identitet bæres kun av tekst og bullet-prikker.

Dette er UI-ekvivalenten til «underscoring», «testament to» og tre-i-rekke i tekst: reflekser modellen griper til når den ikke har tenkt egentlig gjennom hva dette er.

## Tesen

Desken er ikke et kontrollpanel man betjener, det er en loggbok man blar i — én sammenhengende side, ikke faner med ikoner og badges.

## Navigasjonsmodell

Ingen tabs. Én rullende dokumentside, samme prinsipp som Bear eller Obsidians enkeltdokument med en sticky innholdsfortegnelse, og samme prinsipp kartet allerede har (kameraet skjerper seg, det bytter ikke side). Bokstavene (O R A P S F I) hopper deg til et avsnitt i samme dokument, de bytter ikke visning — som Vim-hopp eller Notions outline, ikke som appfaner. 1–4 og C velger sivilisasjon og ruller dit av seg selv.

To unntak forlater dokumentet, akkurat som Focus allerede forlater kartet: **Samtaler** (S) er rosterisiden, bygget som Stardew Valleys egen sosiale side i journalen — portrett og navn på én linje, gruppert per sted, ingen kort. **Innstillinger** (I) er en enkel liste av valg, ikke et skjema i bokser.

## Typografi

To fonter. IBM Plex Mono (som DESIGN.md alt har bestemt) beholdes, men bare der monospace faktisk gjør en jobb: tall, klokkeslett, hurtigtaster, verktøynavn (browser, python, opencode, tsc). All løpende tekst — loggsetninger, navn, sitater fra rådet, samtale-forhåndsvisninger — settes i en humanistisk serif (systemstack, f.eks. Georgia/Iowan). Grunnen: mono i sammenhengende prosa er akkurat det som får hele desken til å lese som en utskrift fra en maskin i stedet for noe skrevet av noen. Størrelser: 13 px brødtekst, 11 px mono-meta, ett nivå større (16 px serif) for navn og saksoverskrifter — ingen 22 px tall-display.

## Farge

Tokenene fra DESIGN.md står. Regelen endres: farge er aldri en boks, aldri en badge, aldri en kant. Grønt er et ord («ja», «live»), rødt er et ord («nei», «krysser mandatet»). Alt annet er krem og grått. Én rød prikk foran en linje er den eneste tillatte formen utover ren tekstfarge.

## Tetthet og hierarki uten bokser

Vekt (fet for navn/titler, ellers regular), innrykk (delegeringstreet rykkes inn per nivå i stedet for å ligge i et kort), én hårfin linje mellom hovedavsnitt (aldri per element), luft mellom linjer, og bokstaven foran en rad (1, 2, 3, 4, C, R) satt i samme vekt som teksten — ingen firkant rundt den.

## Samtaler

En sidetittel («SAMTALER»), så grupper: RÅDET øverst (Rådet er samlet, klikkbart), ROMA (Curia, så sweep watchlist/browser, price 14 listings/python, compare survival), MIDGARD (Ting, world surface prototype/opencode, typecheck/tsc), EDO. Hver rad: et 32 px kvadratisk portrettplaceholder med initialer, navn i serif, verktøy i mono-grått ved siden av. Klikk åpner Focus. Ingen badge, en grønn prikk kun der noen faktisk venter på svar.

## Collapsed og full

**Collapsed**: den lukkede boken — bare ryggen, bokstavene 1-4/C vertikalt og ett tall for saker som venter, ingen ikoner. **Full**: boken slått opp, to sider — venstre er loggen som ruller videre, høyre er hva som var åpent (Samtaler eller Innstillinger). Bredde-modusene blir bokstavelig talt sider i en bok, ikke paneler som endrer størrelse.

## Filer
`/tmp/desk-mock.html` og `/tmp/desk-mock.png` viser Oversikt og Samtaler side ved side i 340 px-bredde.
