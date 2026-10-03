# Produkt-realitet for EcoSyms hovedarbeidsskjerm

Grunnlag: PRODUCT.md (631 linjer), ARCHITECTURE.md, SECURITY.md, src/cli.ts,
src/world-snapshot.ts, src/petition-envelope.ts, src/petition-request.ts,
src/projects.ts, src/hermes-projects.ts, src/institution.ts,
src/institution-snapshot.ts, web/App.tsx, docs/petition-identity.md,
docs/design/direction.md. ecosym-proto er IKKE brukt.

## 1) Alle substantiv — observert / erklært / kun ønsket; i kode eller reservert

- **Sivilisasjon** (civilization) — LEVENDE i kode. Grunnlegges/omtegnes/oppløses
  direkte av brukeren (`src/cli.ts:100-105,185-246`), lagret institusjonstilstand
  (`src/institution.ts:7-17`, `src/institution-snapshot.ts:22-34`), vises i
  world-snapshot (`src/world-snapshot.ts:283-285`). Erklært, ikke observert:
  "Institutional state says what *should* exist" (`PRODUCT.md:472-473`).
- **Innbygger** (inhabitant) — KUN ERKLÆRT, finnes ikke som entitet i kode. Intet
  API/CLI/felt heter "inhabitant". "Today every inhabitant is transient... A
  permanent inhabitant... is a future category" (`PRODUCT.md:104-114`).
- **Petisjon** (petition) — RESERVERT for konsekvensiell bruk. Skjema/validering
  finnes (`src/petition-envelope.ts:192-271`, `src/petition-request.ts:492-542`),
  men er IKKE koblet til noe CLI-kommando (fraværende i listen,
  `src/cli.ts:66-87`) eller HTTP-rute (kun world-snapshot GET og to
  project-POST'er, `src/world-server.ts:48-50,99`). "nothing is configured to
  consume either" (`PRODUCT.md:388`); "no petition reaches a runtime"
  (`PRODUCT.md:412`).
- **Krav** — to ulike ting, begge LEVENDE: (a) ressurs-lease med `claim`,
  `heartbeat`, `release`, `claims` (`src/cli.ts:106-113,248-307`,
  `PRODUCT.md:131-137`); (b) epistemisk status "claim" på en lagret fact,
  distinkt fra "observation" (`src/world-snapshot.ts:205-224`,
  `src/cli.ts:34-38`).
- **Mandat** — LEVENDE, erklært av bruker. `MandateConfig`
  (`src/institution.ts:7-13`), revisjonskjede via `redraw`
  (`src/cli.ts:202-219`), `authorityContext` i petisjonsskjema
  (`src/petition-envelope.ts:114-118`).
- **Rådet** (council) — KUN ERKLÆRT, ikke i kode. "The council does not exist
  yet" (`PRODUCT.md:188`).
- **Kronikeren** (chronicler) — KUN ERKLÆRT. Ikke i "What is built"-inventaret
  (`PRODUCT.md:372-414`). Omtalt som "Ecosym's own voice"
  (`PRODUCT.md:230-231`), adresserbar direkte av bruker (`PRODUCT.md:245-246`).
- **Prosjekt** — LEVENDE. `ProjectService` (`src/projects.ts:34-77`),
  Hermes-adapter (`src/hermes-projects.ts:14-147`), felt i world-snapshot
  (`src/world-snapshot.ts:250-275`), UI-komponent (`web/App.tsx:47-128`).
- **Kilde/tilkobling** (source/connection) — LEVENDE. `connect`/`disconnect`/
  `collect`/`status` (`src/cli.ts:96-99,158-183,326-340,342-402`).
- **Observasjon** — LEVENDE, epistemisk status "observation"
  (`src/world-snapshot.ts:205-224`, `src/cli.ts:34-38`).
- **Spor** (trace) — KUN ERKLÆRT som begrep i "Active-work view"
  ("the traces of what finished", `PRODUCT.md:120`). Ingen egen `Trace`-type i
  kode; nærmeste implementerte analog er collection-attempts/forget-records
  (`src/cli.ts:394-399`).
- **Narrator/forteller** — finnes IKKE som produktnavn. CLI-kommandoen
  `narrate` (`src/cli.ts:404-449`) er en strukturert JSON-øyeblikksrapport
  (tilkoblinger, pågående forsøk, observasjoner, krav + fullstendighets-varsler)
  — ingen språklig fortellerstemme. Det nærmeste produktbegrepet for en "stemme"
  er kronikeren, som er erklært, ikke bygget.
- **Active-work view** — ERKLÆRT begrep, ikke i "what is built"-inventaret.
  Definert `PRODUCT.md:116-124`.
- **City hall** — eksplisitt RESERVERT navn, ikke i kode. `PRODUCT.md:126-129`.

## 2) Alt brukeren kan GJØRE i dag

CLI-verb (`src/cli.ts:66-87`): connect, disconnect, found, redraw, dissolve,
claim, heartbeat, release, claims, resolve-authority, collect, status, query,
narrate, verify, resolve-record-index, retire-collection-attempt, export,
forget, forget-civilization.

Web-UI (`web/App.tsx`): les verden på nytt (`:186`), dra/panorer/zoom kartet
(`:191-210,238`), velg/inspiser et sted=sivilisasjon (`:225-233,241-249`),
opprett prosjekt / prøv registrering igjen (`:47-128`).

HTTP-API (`src/world-server.ts:48-50,99`): GET `/api/world-snapshot`,
POST `/api/civilizations/:id/projects`, POST `/api/projects/:id/retry`. Ingen
andre skriverruter finnes.

**Konsekvensielle**: found/redraw/dissolve (suveren, ingen rådsbehandling,
`PRODUCT.md:94-97`), claim/heartbeat/release (ekte lease), connect/disconnect,
collect (utfører faktisk I/O mot kilde), forget/forget-civilization
(irreversibelt, krever eksport+bekreftelse, `src/cli.ts:676-784`),
resolve-record-index/retire-collection-attempt (to-trinns bekreftelse),
prosjekt-opprettelse/retry (lager mappe + forsøker ekte Hermes-registrering).
**Ikke-konsekvensielle/lesende**: status, query, claims (liste), verify,
export, narrate.

**Petisjon/chat til en koordinator er IKKE levende i API'et.** Skjemaet
valideres (`petition-envelope.ts`, `petition-request.ts`), men ingen CLI-verb
eller HTTP-rute sender en. Det er RESERVERT — dokumentert som blokkert til
identitet, kildehjemmel og ikke-forbigåelig admisjon finnes
(`PRODUCT.md:166-181`, `docs/petition-identity.md:8-13`).

**CLI `narrate`** er en JSON-datarapport (tilkoblinger, pågående forsøk,
observasjoner, krav, fullstendighets-caveat), ikke naturlig språk
(`src/cli.ts:404-449`). Produktet ønsker en fortellerstemme man kan adressere —
det er kronikeren, "Ecosym's own voice" som brukeren kan spørre direkte
(`PRODUCT.md:230-231,245-246`) — men den er erklært, ikke bygget, og har intet
med CLI `narrate` å gjøre utover navnelikhet.

## 3) Eksakte felter i world-snapshot v2 (`src/world-snapshot.ts:19-42,250-346`)

`WorldSnapshot`: `schemaVersion` (1|2), `civilizations[]`, `sourcePictures[]`,
`projects[]` (valgfri, kun skjema 2), `observationsTruncated`, `claimsTruncated`.

`FoundedCivilizationSnapshot` (`institution-snapshot.ts:22-34`): civilizationId,
name, foundedAt, bodyReadable, domain, sources[], mayActAlone[], mustEscalate[],
mandate: {status:"active"|"dissolved", mandateId, revision, recordedAt} eller
{status:"unreadable"}.

`WorldSourcePicture`: civilizationId, sources[]. `WorldSourceSnapshot`:
connectionId, collection (connectionId, connectionVersion, lastAttemptAt,
reason [collected/failed/incomplete/never-run/nothing-new/
record-index-unknown/retired/skipped], status[changed/quiet/unread]) eller
null, attemptsInProgress[] (attemptId, connectionId, connectionVersion,
startedAt), observations[], claims[] (StoredFact), sourceReport? (rik
provenance/verifikasjon/friskhet/usikkerhet).

`StoredFact`: id, collectedAt, connectionId, connectionVersion, collectionAsOf
(attemptId/activationId/startedAt/completedAt eller null), epistemicStatus
[observation|claim], factOwner, kind, payload (skalar-map), sourceRecordedAt,
sourceRecordId, subject, temporalStatus [current|historical|unknown],
valgfri sourceReport{reportId, epistemicType}.

`WorldProjectSnapshot` (`:250-275`): projectId, civilizationId, name, slug,
workspacePath, state [requested|directory-created|external-unknown|
established|failed], attempt, reason (feilkode|null), harness
{id:"hermes", externalId, externalSlug, externalArchived,
provenance[created|adopted], observedAt} eller null.

**Det en skjerm kan vise sant med null backend-arbeid i dag:** grunnlagte
sivilisasjoner med domene/mandat/kilder; per sivilisasjon: hvilke kilder,
tilkoblingsstatus (endret/stille/ulest) og siste forsøkstid; observasjoner og
krav med eksakt payload, kilde-tid vs. innsamlingstid, current/historical/
unknown; pågående innsamlingsforsøk (tidsstemplet, ikke bekreftet levende);
prosjekter med eksakt provisjoneringstilstand og eventuell harness-binding.
Ingenting om agenter, verktøy, delegeringstre, kø, råd eller petisjoner —
det finnes ikke i kontrakten.

## 4) PRODUCT.md-sitater om beboet sted, forflytning, city hall, active-work
view, fokus, dialog, form/tilstand/varighet/rytme

- "Ecosym is a **world of civilizations**: a living, inhabited representation
  of the domains one person cares about, and of the agents working inside
  them." (`PRODUCT.md:3-4`)
- "A person understands the state of their own domains faster from an
  inhabited place they can move through than from a dashboard they must
  interpret." (`PRODUCT.md:69-70`)
- "Where a civilization's current coordination is visible: the agents running
  now, their lineage and delegation tree, the tools they hold, what they are
  doing, what was interrupted, and the traces of what finished. All of it
  time-bounded and stamped as a live operation." (`PRODUCT.md:118-121`)
- "This is what can honestly be shown today, and it is why it is not called a
  town hall. No coordination that survives a process has been observed."
  (`PRODUCT.md:123-124`)
- "**City hall** is reserved. The name may be used when a civilization has a
  lasting institution — identity, mandate, lifecycle, and coordination that
  survives any single agent or session. Until then, using it would depict
  standing office where there is only a running process." (`PRODUCT.md:126-129`)
- "The user can address the chronicler directly. The world is the surface;
  asking is available within it." (`PRODUCT.md:245-246`)
- "Form — is it a thing, or a condition? ... Duration — does it persist, or is
  it gone afterward? ... Rhythm — once, or recurring?"
  (`PRODUCT.md:437,445,452`, full seksjon `428-461`)
- Ordene "focus" og "dialogue" forekommer IKKE ordrett i PRODUCT.md. Nærmeste
  substans for "dialog" er kronikeren-sitatet over; "fokus" har ingen
  motpart i teksten.

## 5) [Historisk, rev 1 — erstattet] Én meningsbestemt paragraf: hva en skjerm man ARBEIDER I må ha

> **Historisk (rev 1).** Anbefalingen under om å redigere mandat og kilder
> direkte i skjermen tilhører den avviste rev 1 («Phase A») og er erstattet
> av `direction-decision.md` rev 2/3: alt går gjennom agenter, og skjermen
> viser bare det world-snapshot faktisk bærer. Beholdt som bevis for hva
> backenden hadde, ikke som gjeldende produktveiledning.

En skjerm man arbeider i, ikke bare leser, må ha ett sted brukeren skriver
noe og noe konkret skjer i verden — ikke bare et lesevindu på en world-snapshot.
Gitt hva som faktisk er bygget i dag, er det ærlige arbeidsobjektet
sivilisasjonens mandat og dens kilder/krav, fordi found/redraw/dissolve,
connect/disconnect/collect og claim/heartbeat/release er de eneste
konsekvensielle verbene som finnes i systemet nå (`src/cli.ts`). En chat-boks
mot "en koordinator" eller en fortellerstemme kan vises som et adressefelt,
men den kan ikke sende noe reelt før petisjonsidentitet, admisjon og
kildehjemmel finnes (`PRODUCT.md:166-181`, `docs/petition-identity.md:8-13`) —
å late som den gjør ville bryte invarianten "asking is not happening"
(`PRODUCT.md:492-499`). Rev 1-anbefalingen, trukket tilbake og ikke gjeldende:
skjermen burde vise et sted (sivilisasjon), la brukeren redigere dets mandat og
kilder direkte (sovereign, uten rådsbehandling
per `PRODUCT.md:94-97`), vise dets observasjoner/krav/prosjekter fra
world-snapshot ærlig merket med epistemisk status, og reservere ett synlig men
tydelig "ikke sendt ennå"-felt for petisjon/chat — en adresselinje som
forklarer at den ikke gjør noe reelt før petisjonsveien er bygget, i stedet for
å late som en chat-boks er arbeid. Det gjør skjermen sann til produktet i dag:
et sted du former (mandat, kilder, krav, prosjekt), ikke et dashbord du leser,
og en tydelig grense der "agent"/"fortelling" fortsatt er erklæring, ikke
observasjon.

## 6) Åpne spørsmål PRODUCT.md merker uavklart som en UI må ta stilling til

Fra `PRODUCT.md:613-631`:

- Hvilket varig substrat bærer en sak som venter dager på svar?
- Hvordan løses jurisdiksjon deterministisk, uten at en modell avgjør?
- Hvordan vises forfall uten at det leses som straff?
- Hvordan representeres rådets kø inne i verden?
- Hva regnes som en kilde som "eier" et faktum, og hvordan bæres opprinnelse
  fra petisjon til observert utfall?
- Hvordan etableres brukerens identitet ved EcoSym-grensesnittet for en
  petisjon, og hva registrerer den?
- Hvor mye kan rådet forberede en sak selv før brukeren ser den — kan
  velbelagte saker avgjøre seg selv? (Retning, ikke vedtak; krever et
  eksplisitt brukergitt mandat.)

Fra `docs/petition-identity.md:732-740` (åpne beslutninger en UI også må
forholde seg til hvis den viser petisjon/chat): valg av første
brukeranlegg/bevisprofil, maks gyldighetstid for en petisjon, og
admisjonsmekanisme — ingen av disse er valgt, så en skjerm kan ikke late som
petisjonsflyten er ferdig.

Hver av disse betyr i praksis: enhver "kø"-, "råd"-, "agent"- eller
"chat"-visning i skjermen må eksplisitt markeres som ennå-ikke-bygget/erklært,
aldri som om spørsmålet allerede er besvart av UI-et selv.
