---
name: EcoSym (proto), Atlaset
description: Kartpapir med korn, én akvarellvask per sivilisasjon; går du inn i en region, brer vasken seg over hele arket.
colors:
  paper: "light-dark(oklch(96.6% 0.01 92), oklch(21% 0.035 262))"
  paper-2: "light-dark(oklch(94.4% 0.013 90), oklch(18.5% 0.035 262))"
  sheet: "light-dark(oklch(99.2% 0.004 92), oklch(25.5% 0.035 262))"
  sheet-2: "light-dark(oklch(97.5% 0.007 92), oklch(29% 0.035 262))"
  ink: "light-dark(oklch(25% 0.035 262), oklch(94% 0.012 85))"
  ink-2: "light-dark(oklch(43% 0.03 262), oklch(76% 0.014 85))"
  ink-3: "light-dark(oklch(50% 0.025 262), oklch(70% 0.016 85))"
  hairline: "light-dark(oklch(25% 0.035 262 / 0.12), oklch(94% 0.012 85 / 0.1))"
  hairline-strong: "light-dark(oklch(25% 0.035 262 / 0.24), oklch(94% 0.012 85 / 0.2))"
  shadow-ink: "light-dark(oklch(25% 0.05 262), oklch(5% 0.03 262))"
  wash: "light-dark(oklch(88% 0.075 var(--line-hue)), oklch(38% 0.085 var(--line-hue)))"
  wash-deep: "light-dark(oklch(82% 0.1 var(--line-hue)), oklch(46% 0.11 var(--line-hue)))"
  line: "light-dark(oklch(50% 0.12 var(--line-hue)), oklch(78% 0.11 var(--line-hue)))"
  line-ink: "light-dark(oklch(40% 0.11 var(--line-hue)), oklch(84% 0.09 var(--line-hue)))"
  on-stamp: "light-dark(oklch(30% 0.09 var(--line-hue)), oklch(96% 0.03 var(--line-hue)))"
  room-field: "light-dark(oklch(86% 0.085 var(--line-hue) / 0.9), oklch(38% 0.085 var(--line-hue) / 0.6))"
  room-field-2: "light-dark(oklch(82% 0.1 var(--line-hue) / 0.55), oklch(46% 0.11 var(--line-hue) / 0.35))"
  amber: "light-dark(oklch(50% 0.14 70), oklch(82% 0.14 80))"
  red: "light-dark(oklch(47% 0.19 25), oklch(76% 0.15 22))"
  blue: "light-dark(oklch(48% 0.16 256), oklch(78% 0.1 250))"
  on-blue: "light-dark(oklch(99% 0 0), oklch(20% 0.05 250))"
  focus: "light-dark(oklch(35% 0.08 262), oklch(88% 0.06 85))"
typography:
  display:
    fontFamily: "Piazzolla, Noto Serif, Georgia, serif"
    fontSize: "40px"
    fontWeight: 500
    lineHeight: 1.02
    letterSpacing: "-0.012em"
  headline:
    fontFamily: "Piazzolla, Noto Serif, Georgia, serif"
    fontSize: "38px"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-0.012em"
  lead:
    fontFamily: "Piazzolla, Noto Serif, Georgia, serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.4
    fontStyle: "italic"
  title-large:
    fontFamily: "Piazzolla, Noto Serif, Georgia, serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Piazzolla, Noto Serif, Georgia, serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.005em"
  heading:
    fontFamily: "Piazzolla, Noto Serif, Georgia, serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.005em"
  prose:
    fontFamily: "Piazzolla, Noto Serif, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Hanken Grotesk, Noto Sans, Cantarell, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  row:
    fontFamily: "Hanken Grotesk, Noto Sans, Cantarell, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.35
  detail:
    fontFamily: "Hanken Grotesk, Noto Sans, Cantarell, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "Hanken Grotesk, Noto Sans, Cantarell, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.02em"
  stamp:
    fontFamily: "Hanken Grotesk, Noto Sans, Cantarell, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    letterSpacing: "0.05em"
rounded:
  focus: "4px"
  stamp-small: "6px"
  stamp: "8px"
  control: "10px"
  stamp-large: "11px"
  card: "12px"
  tile: "14px"
  sheet-phone: "18px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  tile-gap: "14px"
  lg: "16px"
  board-gap: "20px"
  xl: "24px"
  block: "28px"
  gutter: "44px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
    typography: "{typography.body}"
  button-quiet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    padding: "0"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    size: "34px"
  stamp:
    backgroundColor: "{colors.wash-deep}"
    textColor: "{colors.on-stamp}"
    rounded: "{rounded.stamp}"
    typography: "{typography.stamp}"
    width: "44px"
    height: "30px"
  stamp-small:
    backgroundColor: "{colors.wash-deep}"
    textColor: "{colors.on-stamp}"
    rounded: "{rounded.stamp-small}"
    width: "34px"
    height: "22px"
  stamp-large:
    backgroundColor: "{colors.wash-deep}"
    textColor: "{colors.on-stamp}"
    rounded: "{rounded.stamp-large}"
    width: "60px"
    height: "40px"
  stamp-council:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.stamp-small}"
  badge:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.on-blue}"
    rounded: "{rounded.stamp-large}"
    height: "22px"
    padding: "0 7px"
  search-input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "38px"
    padding: "0 60px 0 14px"
  ask-input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    height: "48px"
    padding: "0 16px"
  textarea:
    backgroundColor: "{colors.sheet-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  nav-item-current:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  card:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "12px 14px 11px"
  region-tile:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "16px 16px 14px"
  matter-sheet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "24px 28px 28px"
  card-panel:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    width: "440px"
    padding: "26px 30px 40px"
  panel-note:
    backgroundColor: "color-mix(in oklch, {colors.blue} 10%, {colors.sheet-2})"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
---

# Design System: EcoSym (proto), Atlaset

## Overview

**Creative North Star: "Atlaset"**

EcoSym-flaten er et atlas. Papiret er kartpapir med et svakt korn (en SVG-turbulensfil lagt over hele arket med multiply, aldri en data-URI). Hver sivilisasjon er en region malt som en myk akvarellvask i sin egen erklærte kulør, med fjærete kanter og aldri en hard fylling. Oversikten er siden der alle regionene ligger side om side; å gå inn i én er at vasken brer seg fra klikkpunktet over hele arket og blir liggende som et stort, svakt felt bak alt i rommet. Teksten er akromatisk blekk (kartblekk-blått om dagen, lampevarmt om natten); farge bor i felt, ikke i bokstaver.

Verdenen har to materialer: papir og ark. Papiret (`paper`) er grunnen, litt mørkere i sidemenyen (`paper-2`). Arket (`sheet`) er alt som ligger oppå papiret: kort, søkefelt, kortpanel, saksark, den aktive navigasjonsraden. Ark har hårstrek og en myk, forskjøvet skygge i blekkets kulør. Regioner og bånd er ikke ark; de er vasker direkte på papiret og har ingen skygge. Tettheten er arbeidsflate: 15 px brødtekst, rader med 14 px høyde-rytme, fire tavlekolonner på 1440.

To skrifter med hvert sitt arbeid: Piazzolla (variabel serif 300–900 med optisk størrelse) for navn, overskrifter, den kursive innledningssetningen, Krønikerens prosa og svarene fra «Spør Krønikeren»; Hanken Grotesk (300–800) for hver kontroll, rad, etikett og hvert tall, med tabulære sifre bare der kolonner står under hverandre. Avviste retninger som fortsatt binder: det flate hårstrek-dashbordet (Linjekartet), det neonaktige glass-dashbordet i mørkt, spill, 3D, svart/hvitt med kort overalt, heltillustrasjon.

**Key Characteristics:**
- Kartpapir med korn i to lys: dagpapir varmt stein, nattpapir dyp blekkblå; blekket bytter temperatur motsatt vei.
- Én vask per sivilisasjon, avledet av `--line-hue` (UT 192, HA 345, HU 128, LÆ 292, AR 70); utenfor et rom står kuløren på sepia 60.
- Regioner og bånd er lagdelte radiale vasker med en svak randglød; rommet får to store, svake vaskefelt bak hele arket via `--room-on`.
- Ark (kort, paneler, felt) har hårstrek pluss `shadow-sheet`; vasker har aldri skygge.
- Funksjonsfargene har én betydning hver og blandes aldri inn i en vask: amber = observert endring, rød = sikt tapt, blå = venter på deg.
- Tegnede strekikoner, 1,5 px strek, 18 px i sidemenyen og 16 px inline; ingenting annet er ikonisk.
- Én signaturbevegelse: vasken brer seg fra klikket som en voksende sirkel på 380 ms.

## Colors

Paletten er papir og blekk med én regionsvask lagt oppå; alt regionsfarget er avledet av én kulørvariabel, så nye regioner får sin farge uten nye tokens.

### Primary
- **Regionsvask** (`wash`, `wash-deep`): akvarellvasken i regionens kulør. `wash` er den lyse randen i en region og bakgrunnen for en aktiv linje i sidemenyen (70 % over papir), `wash-deep` er det tette punktet i vasken, stempelets bakgrunn og venstrekanten på Krønikerens svar. Kuløren kommer fra `--line-hue`, som settes på `.app` når du er i et rom og lokalt på hvert element som representerer en sivilisasjon (region, bånd, linje i sidemenyen, stempel, feed-rad, radleder, sakens rute).
- **Regionsstrek** (`line`): den mettede varianten. Fanenes blekkstrek, fokusramme på søke- og spørrefelt, kanten på et åpent kort, den 2 px tykke kanten på kortpanelet (60 % mot hårstrek), `accent-color` på radioknapper, og hover-kanten på regioner og bånd.
- **Regionsblekk** (`line-ink`): kulørt blekk for små bekreftende ord inne i en region: «nå»-tidspunkt, prosjektnavnet på et kort, domenelinjen på et bånd, ikonet i den aktive navigasjonsraden, og markøren i felt (`caret-color`).
- **Stempeltekst** (`on-stamp`): koden på stempelet, mørk kulør på lys vask om dagen og nesten hvit kulør om natten.
- **Romfelt** (`room-field`, `room-field-2`): de to gjennomskinnelige radiale feltene som ligger fast bak hele arket når du er inne i en region (øverst til venstre og nederst til høyre), styrt av `--room-on` 0/1.

### Neutral
- **Papir** (`paper`, `paper-2`): grunnen. Dagpapir er varm stein (kulør 92), nattpapir er blekkblå (kulør 262). `paper-2` er sidemenyens litt mørkere ark (70 % over papir).
- **Ark** (`sheet`, `sheet-2`): alt som ligger oppå papiret: kort, søkefelt, spørrefelt, kortpanel, saksark, aktiv navigasjonsrad, aktiv innstillingsrad. `sheet-2` brukes til tekstfeltet i petisjonen og som base for panelnotatet.
- **Blekk** (`ink`, `ink-2`, `ink-3`): tre grader. `ink` for titler, navn og primærtekst; `ink-2` for brødtekst i prosa, sekundære rader, faner i hvile, navigasjon i hvile; `ink-3` for tidspunkt, tellere, plassholdere, «ingen agent», dempet støttetekst (`.dim`). Blekket er kartblått om dagen og lampevarmt (kulør 85) om natten.
- **Hårstrek** (`hairline`, `hairline-strong`): blekket ved 12 %/24 % (10 %/20 % om natten). Den svake skiller rader, kort og kolonnehoder; den sterke tegner stille knapper, `kbd`, demo-merket, rådsstempelet og understrekninger på lenker.
- **Skyggeblekk** (`shadow-ink`): kilden begge skyggene tegnes fra, dypere blått om natten.

### Tertiary
- **Amber** (`amber`): observert endring. «Noe endret»-signalet, en agent som kjører (navnet, «kjører»-tidspunktet på en kjøring), den pustende prikken. Aldri en flate.
- **Rød** (`red`): sikt tapt. Kilde som ikke svarer, mislykket kjøring, mislykket utfall. Aldri en flate.
- **Blå** (`blue`): venter på deg. Ordet «Venter på deg», kolonnehodet i den kolonnen, prosjekt som ikke er registrert, rådstelleren i sidemenyen (eneste blå flate, med `on-blue` som tekst), og 10 % i panelnotatets bakgrunn.
- **Fokus** (`focus`): 2 px fokusring med 2 px avstand og 4 px radius på alt som kan få tastaturfokus.

### Named Rules
**Vaskeregelen.** Farge bor i felt. Regionens kulør vises som vask (radiale gradienter), stempel, strek og små kulørte blekk-ord; brødtekst, titler og navn er alltid akromatisk blekk.

**Én-betydning-regelen.** Amber, rød og blå betyr én ting hver (endring, tapt sikt, venter på deg) og er alltid tekst eller en prikk, aldri en vask eller en bakgrunn. Eneste unntak er rådstelleren og panelnotatets 10 %.

**Avledningsregelen.** Alle regionsfarger avledes av `--line-hue` gjennom `light-dark()`-uttrykk som gjentas på selektorlista ved roten (`.app, .region, .lines-nav > li, .group, .pill, .feed-row, .row-lead, .matter-route, .band`). Nye elementer som skal bære sin egen sivilisasjons farge legges til i den lista; ellers låses de til kuløren på nærmeste forelder.

## Typography

**Display Font:** Piazzolla (variabel, 300–900, normal og kursiv, selvhostet WOFF2; fallback Noto Serif, Georgia)
**Body Font:** Hanken Grotesk (variabel, 300–800, normal og kursiv, selvhostet WOFF2; fallback Noto Sans, Cantarell, system-ui)

**Character:** En kartografs par. Piazzolla har optisk størrelse og gir navn og overskrifter et gravert, litt bokaktig preg i vekt 500 med lett negativ sporing; Hanken Grotesk er nøytral og tett nok til at rader, tall og etiketter leses som instrumentering. Ingen syntetisk fet eller kursiv (`font-synthesis: none`), `font-optical-sizing: auto`.

### Hierarchy
- **Display** (Piazzolla 500, 40 px, 1.02, −0.012em): rommets navn (sivilisasjon eller prosjekt). 30 px på telefon.
- **Headline** (Piazzolla 500, 38 px, 1.08, −0.012em): sidetittel `h1`, inkludert hilsenen «God kveld, Axel.» på oversikten. 30 px på telefon.
- **Lead** (Piazzolla kursiv 400, 22 px, 1.4, `ink-2`, maks 54ch, `text-wrap: pretty`): innledningssetningen under hilsenen. 18 px på telefon.
- **Title large** (Piazzolla 500, 28 px, 1.05, −0.01em): båndets navn på Sivilisasjoner. 24 px på telefon.
- **Title** (Piazzolla 500, 26 px, 1.15, `text-wrap: balance`): kortpanelets oppgavetittel og sakstittelen i Rådets saksark.
- **Heading** (Piazzolla 500, 22 px, 1.1–1.15): regionsnavn, kolonneoverskrifter i triptyken, seksjonsoverskrifter, gruppeoverskrifter, Krønikerens innslagstitler, innstillingsgruppens legend, tomtilstandens tittel. 20 px for mandatets to kolonner, 24 px for ordmerket (600), 15 px for «Linjer» i sidemenyen.
- **Prose** (Piazzolla 400, 17 px, 1.55, `ink-2`): Krønikerens innslag og prosjektets «Om»-avsnitt, maks 66–68ch. Svaret fra «Spør Krønikeren» er samme stemme i 16 px med en 2 px `wash-deep`-kant til venstre.
- **Body** (Hanken 400, 15 px, 1.45): grunnstørrelse; faner, sideundertittel (maks 62ch), signalord på bånd, radleder.
- **Row** (Hanken 500, 14–14.5 px, 1.35): korttittel, feed-tittel, radnavn i sidemenyen, kolonnehoder (13 px 600).
- **Detail** (Hanken 400, 13 px, 1.3–1.5): feed-detalj, kortmeta, tidspunkt, brødsmuler, fakta, notater; 12 px for teller, prosjektslug, foten i sidemenyen; 11 px for `kbd` og det lille stempelet.
- **Stamp** (Hanken 700, 13 px, +0.05em): sivilisasjonskoden i stempelet; 16 px stort, 11 px lite.
- **Label** (Hanken 600, 12 px, +0.02em): «Demo-data»-merket og rådstelleren. Aldri versaler.

### Named Rules
**To-jobber-regelen.** Serif er for det som har et navn eller en stemme (titler, regionsnavn, overskrifter, innledning, prosa, Krønikerens svar). Grotesk er for alt som er kontroll, rad, etikett eller tall. Ingen tredje skrift, ingen monospace.

**Tabulærregelen.** `tabular-nums` slås på bare der tall står i en kolonne over hverandre (tidspunkt, tellere, statusord i sidemenyen, rådstelleren), aldri globalt.

**Ingen-kicker-regelen.** Ingen overlinjer, øyenbryn eller versal-etiketter over overskrifter. Konteksten står i undertittelen under, i `ink-2`/`ink-3`.

## Layout

Skallet er et to-kolonners rutenett: sidemeny 240 px (`--sidebar`) på `paper-2`, klebrig i full høyde med hårstrek til høyre, og et hovedfelt med 64 px topplinje (søk 440 px bredt + leselinje) og sider med 20/44/64 px innvendig luft. Sider er maks 1100 px; brede sider (Sivilisasjoner, Prosjekter, Agenter, Rådet, oversikten) 1360 px. Horisontal gutter er 44 px overalt på skrivebord (sidepadding, triptykens kolonnegap, rommets padding).

Oversikten fyller høyden (`min-height: calc(100vh − 64px)`) så spørrefeltet kan klebe seg nederst. Regionene ligger i fem like kolonner med 14 px gap og 156 px minstehøyde; triptyken er 1.15fr 1fr 1fr med 44 px gap. Rommet er ett felt, eller `1fr 440px` når et kort er åpent (`--panel`); tavla er fire kolonner på minst 212 px (168 px med panel) med 20 px gap. Rådet er `1.1fr 1fr` med 40 px gap; mandatet to like kolonner med 40 px gap. Lister er rader på 260 / 1fr / 150 px med 28 px gap og 14 px vertikal padding, skilt av hårstreker.

Spacing-rytmen er 2/4/8/12/14/16/20/24/28/44: 2 px mellom navigasjonsrader, 8–12 px inne i kontroller og kort, 14 px mellom fliser, 24 px over fanekroppen, 28 px mellom grupper og under sidehodet, 36 px over seksjonsoverskrifter, 44 px gutter.

Bruddpunkter: **1200 px** (regioner 3 kolonner, triptyk 2 kolonner med den tredje under, Rådet én kolonne) og **760 px** (telefon): sidemenyen blir to horisontale striper øverst (navigasjon med ikoner og maskert overskrolling, stempler med navn under), regionene blir en horisontal snap-rad på 74vw, kolonner stables, tavla snapper 86vw per kolonne, båndene blir stempel + tekst, kortpanelet blir et bunnark på 80vh, spørrefeltet stables og slutter å klebe. Gutter er 16 px og topplinjen 56 px.

## Elevation & Depth

Hybrid: papir er flatt og dybde fortelles først med tonelag (papir → `paper-2` → `sheet` → `sheet-2`) og med vasker; deretter får bare ark en myk skygge tegnet fra `shadow-ink`, aldri fra svart. Vasker (regioner, bånd, romfelt, kolonnefelt) har ingen skygge; deres kant er en 1 px hårstrek blandet 55 % med `wash-deep`, og dybden ligger i de tre lagdelte radiale gradientene med en svak randglød (en ring på 70 % `wash-deep` rundt 78 % av flaten). Kornet ligger over alt på 0.32 med multiply (240 px flis), så også ark får papirtekstur.

### Shadow Vocabulary
- **Ark** (`--shadow-sheet: 0 1px 2px oklch(from var(--shadow-ink) l c h / 0.06), 0 14px 36px -14px oklch(from var(--shadow-ink) l c h / 0.22)`): kort, søkefelt, spørrefelt, primærknapp, aktiv navigasjonsrad, aktiv sak, aktiv innstillingsrad, saksark.
- **Svevende ark** (`--shadow-float: 0 2px 6px oklch(from var(--shadow-ink) l c h / 0.08), 0 28px 60px -20px oklch(from var(--shadow-ink) l c h / 0.35)`): kortpanelet og det klebrige spørrefeltet på oversikten.
- **Ring** (`0 0 0 1px var(--line)` + ark): et åpent kort på tavla; en 1 px ekstra kant i regionsstreken, ingen ny skygge.

### Named Rules
**Ark-har-skygge-regelen.** Skygge betyr «dette ligger oppå papiret». Bare `sheet`-flater får `shadow-sheet`/`shadow-float`; regioner, bånd, kolonnefelt og romfelt er malt på papiret og har ingen. Et ferdig kort mister skyggen og går 60 % gjennomsiktig.

**Blekkskygge-regelen.** Skygger tegnes fra `shadow-ink` (blått), aldri fra svart, og aldri som hard forskyvning uten uskarphet.

## Shapes

Mykt avrundet kartpapir. Tre familier: **kontroller** på 10 px (knapper, navigasjonsrader, søkefelt, tekstfelt, ikonknapp, panelnotat), **kort** på 12 px (tavlekort, spørrefelt, kolonnefelt, saksrad) og **fliser** på 14 px (`--radius`: regioner, bånd, saksark). Stemplene har egen trapp: 6 / 8 / 11 px etter størrelse (lite/standard/stort), rådstelleren er en 11 px pille, fokusringen 4 px. Kortpanelet er skarpt på skrivebord (bare en 2 px venstrekant i regionsstreken) og et 18 px toppavrundet bunnark på telefon. Faner har 6 px toppradius og en 2 px blekkstrek under den valgte som glir. Kanter er 1 px hårstrek; oppløste regioner og bånd tegnes med stiplet `hairline-strong` og et tomt stempel. Ingenting er kvadratisk og ingenting er en pille utover telleren, prikken og badgen.

## Components

### Buttons
Rolige, papirtunge; primær er blekk på papir.
- **Shape:** kontrollradius (10 px), padding 9 px 16 px, Hanken 500.
- **Primary** (`.button`): `ink` på `paper`-tekst, `shadow-sheet`. Aktiv: `scale(0.97)` på 160 ms `--ease-out`. Deaktivert: 40 % opasitet uten skygge («Send» i petisjonen er deaktivert i prototypen).
- **Quiet** (`.button.quiet`): `sheet` med innvendig 1 px `hairline-strong`, samme mål. Brukes som «Avslå» ved siden av «Godkjenn».
- **Text** (`.text-button`, `.more`, `.inline-link`, `.row-link`): ren tekst i `ink-2` med understrek 3 px under i `hairline-strong`; hover løfter til `ink` (tekstknapp) eller til `line-ink` på understreken (lenker).
- **Icon button** (`.icon-button`): 34 px, 10 px radius, gjennomsiktig; hover 6 % blekk, aktiv `scale(0.94)`. Bare for lukk-krysset i panelet.
- **Focus:** global 2 px `focus`-ring med 2 px avstand; felt viser i tillegg `line` som kantfarge.

### Chips (stempler)
Regionens kode på en liten vask.
- **Style** (`.pill`): 44×30, 8 px radius, `wash-deep` bakgrunn, `on-stamp` tekst, Hanken 700 13 px med +0.05em. Stort (60×40, 11 px, 16 px tekst) i romhodet; lite (34×22, 6 px, 11 px tekst) i sidemenyen, feed-rader, brødsmuler, radledere og sakens rute.
- **State:** rådsstempelet («RÅD») er gjennomsiktig med innvendig `hairline-strong` og `ink-2`; stempelet i en oppløst region er det samme, i `ink-3`. Stempelet bærer alltid sin egen `--line-hue` når det står utenfor sin region.
- **Badge** (`.badge`): rådstelleren, 22 px høy pille i `blue` med `on-blue`, Hanken 600 12 px, tabulære sifre.
- **Demo-merket** (`.demo`): 12 px 600 i `ink-2` med `hairline-strong`-kant og 6 px radius, i sidemenyens fot.

### Cards / Containers
- **Tavlekort** (`.card`): `sheet`, 1 px `hairline`, 12 px radius, 12/14/11 px padding, `shadow-sheet`. Tittel Hanken 500 14.5 px; meta i 13 px med agentnavn i `ink` 500 (amber + pustende prikk når den kjører), prosjektslug i `line-ink` 12 px, tidspunkt `ink-3`, utfall i `ink-2` (rødt hvis mislykket, blått i «Venter på deg»). Hover løfter 1 px og går til `hairline-strong`; åpent kort har `line`-kant og 1 px ring; ferdig kort er skyggeløst, 60 % ark, tittel i `ink-2` 400.
- **Kolonnefelt** (`.column`): en svak vertikal vask (38 % `wash` øverst → 10 % ved 60 % → gjennomsiktig) med 12 px radius og 10 px padding; kolonnehode Hanken 600 13 px i `ink-2` med teller i `ink-3`, hårstrek under. «Venter på deg»-hodet er blått.
- **Region** (`.region`): flis på 14 px, min 156 px høy, tre radiale vasker over `sheet` (lys `wash` oppe til venstre, `wash-deep` nede til høyre, randglød) med en hårstrek blandet 55 % `wash-deep`. Innhold: stempel + serif-navn 22 px, en eller to signallinjer 13.5 px 500 (amber/rød/`line-ink`), nederst en «nå»-rad med hvem (`ink` 500) / når (`line-ink`) / hva (to linjer klippet). Hover løfter 2 px og setter kanten til `line`. Oppløst: flatt `sheet`, stiplet kant, tomt stempel, navn i `ink-2`.
- **Bånd** (`.band`): regionen i full bredde på Sivilisasjoner: 44 / 300 / 1fr med 28 px gap, 24/28/24/22 px padding, min 140 px høy, samme vasker rotert til venstre kant. Navn i serif 28 px, domene i `line-ink`, signaler 15 px, «nå»-rader på 160 / 1fr / 56 px.
- **Saksark** (`.matter-detail`): flis på 14 px, `sheet`, hårstrek, `shadow-sheet`, 24/28/28 px padding; tittel serif 26 px balansert, mellomtitler Hanken 600 15 px, «Godkjenn»/«Avslå» i en `decide`-rad med 22 px topp. Den valgte saken i lista er selv et ark (10 px radius via `matter-link` 12 px, `shadow-sheet`).
- **Panelnotat** (`.panel-note`): 10 px radius, 10 % blå over `sheet-2`, 14 px/1.5, for oppgavens notat.

### Inputs / Fields
- **Søk** (`.search input`): 38 px høyt ark med hårstrek, 10 px radius, `shadow-sheet`, plassholder i `ink-3`, `⌘K` som `kbd` (11 px, `hairline-strong`, 5 px radius) til høyre. Stor variant 48 px / 17 px på Søk-siden.
- **Spør Krønikeren** (`.ask input`): 48 px, 12 px radius, `sheet`, hårstrek, `shadow-sheet`; klebrig nederst på oversikten med `shadow-float` og en 6 px-rundet notatlapp på 85 % papir under. Svar i serif 16 px med `wash-deep`-kant til venstre.
- **Tekstområde** (`.petition textarea`): `sheet-2`, `hairline-strong`, 10 px radius, 10/12 px padding, vertikal resize; deaktivert i `ink-3` med not-allowed.
- **Radiovalg** (`.choice-item`): 18 px / 1fr rutenett med 12/10 px padding og hårstrek under; radioknappen får `accent-color: line`; valgt rad blir et ark (10 px radius, `shadow-sheet`).
- **Focus:** kant til `line`, fokusring skjult når fokus ikke er synlig; markør i `line-ink`.

### Navigation
- **Sidemeny:** 240 px på 70 % `paper-2`, ordmerket «EcoSym» i Piazzolla 600 24 px, åtte rader med tegnet 18 px-ikon (`ink-3`) + navn i `ink-2`, 8/10 px padding, 10 px radius, 2 px gap. Hover 5 % blekk; aktiv rad er et ark med `shadow-sheet`, `ink` 500 og ikon i `line-ink`. Rådet bærer telleren. Under: «Linjer» (serif 15 px) med en rad per sivilisasjon: lite stempel (34 px kolonne), navn 14 px 500, statusord 12 px i funksjonsfargen (amber/rød/blå) eller `ink-3`; hover 45 % `wash`, aktiv 70 % `wash`. Foten har demo-merket og én dempet setning.
- **Topplinje:** 64 px, søk til venstre, leselinje («Lest for … · Les på nytt») 13 px til høyre.
- **Faner** (`.tabs`): 15 px i `ink-2`, 10/12 px padding, teller i `ink-3` 12 px; valgt fane `ink` 500 med en 2 px `line`-strek som glir under på 160 ms.
- **Brødsmuler** (`.crumbs`): 14 px i `ink-2`, lite stempel + navn, skilt av «/» i `ink-3`.
- **Telefon:** sidemenyen blir to horisontale, maskerte striper; «Linjer»-overskrift, statusord og fot skjules; aktiv rad mister skyggen.

### Vasken som brer seg (signaturbevegelse)
Alle lenker inn i eller ut av et rom kjører `document.startViewTransition`: det gamle bildet står stille, det nye klippes som en sirkel som vokser fra klikkpunktet (`--vt-x`/`--vt-y`) til 160 % på 380 ms `--ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`). Rommet setter `--line-hue`, `--room-on: 1` og klassen `in-room` på `.app`, og de to romfeltene toner inn bak arket. Kortpanelet glir inn 16 px med `@starting-style` på 220 ms; fanestreken glir på 160 ms; kort og knapper svarer på 160 ms; farge- og bakgrunnsskift på 120–140 ms. Eneste ambiente bevegelse er den pustende prikken (`breathe`, 2 s). Med `prefers-reduced-motion` erstattes sirkelen av 160 ms overtoning, panelet toner bare inn, og alle løft/transisjoner skrus av.

### Kortpanelet
`aside.panel`, klebrig i full høyde til høyre, 440 px, `sheet`, 2 px venstrekant i 60 % `line`, `shadow-float`, 26/30/40 px padding, får fokus når det åpner. Lukk-kryss oppe til høyre (ikonknapp), tittel serif 26 px, én setning i `ink-2` om kolonne, agent og prosjekt, valgfritt panelnotat, «Kjøringer» som rader på 1fr/auto med hårstrek (mislykket i rødt, pågående tidspunkt i amber), og «Melding til worker» med deaktivert tekstområde og knapp. På telefon et fast bunnark på 80vh med 18 px topphjørner og hårstrek øverst.

## Do's and Don'ts

### Do:
- **Do** avled all regionsfarge fra `--line-hue` og legg nye elementer som bærer egen sivilisasjonsfarge til selektorlista ved roten, så `wash`/`line`/`on-stamp` regnes ut lokalt.
- **Do** bruk `sheet` + 1 px `hairline` + `shadow-sheet` for alt som ligger oppå papiret, og `shadow-float` bare for kortpanelet og det klebrige spørrefeltet.
- **Do** mal regioner og bånd som tre lagdelte radiale vasker over `sheet` med randglød og en kant blandet 55 % `wash-deep`; oppløste tegnes flatt, stiplet og med tomt stempel.
- **Do** sett Piazzolla 500 på alt som har navn eller stemme, og Hanken Grotesk på alt som er kontroll, rad eller tall; kursiv Piazzolla 400 bare på innledningssetningen.
- **Do** hold amber/rød/blå som tekst eller prikk med én betydning hver, og bruk `line-ink` for kulørte småord inne i en region.
- **Do** kjør inngang og utgang av rom gjennom view transition med klipp-sirkel fra klikkpunktet på 380 ms `--ease-out`, og fall tilbake til 160 ms overtoning ved redusert bevegelse.
- **Do** tegn ikoner selv: 18 px i sidemenyen, 16 px inline, 1,5 px strek, runde ender, `currentColor`.
- **Do** legg kornet (`grain.svg`, 240 px flis) som en fast pseudo-flate på 0.32 med multiply bak hele appen.

### Don't:
- **Don't** legg skygge på regioner, bånd, kolonnefelt eller romfelt; vasker er malt på papiret.
- **Don't** bruk svart eller grå skygge, harde forskjøvne skygger eller skygge uten uskarphet; alt tegnes fra `shadow-ink`.
- **Don't** farg brødtekst, titler eller navn med regionens kulør; farge bor i felt og stempler, tekst er blekk.
- **Don't** bruk amber, rød eller blå som bakgrunn eller vask (unntak: rådstelleren og panelnotatets 10 %).
- **Don't** legg til overlinjer, øyenbryn, versal-etiketter, emoji, ikonfonter eller en tredje skrift.
- **Don't** bruk `tabular-nums` globalt eller på løpende tekst.
- **Don't** flatt fyll en region med én farge, eller gjør dark mode til neon og glass.
- **Don't** legg til ambient bevegelse utover den pustende prikken.
