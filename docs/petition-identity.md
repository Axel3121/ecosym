# Petition identity

This document defines how a consequential petition identifies the user who
asked, how that proof is bounded, and what must be retained so the petition can
be followed later. It is subordinate to `PRODUCT.md`, `ARCHITECTURE.md`, and
`SECURITY.md`, and is the implementation contract for this boundary.

This is a design, not evidence that a consequential petition path exists. No
connected runtime is known to provide the mandatory, non-bypassable admission
boundary, and no user credential owner or proof profile has been selected. A
consequential request-type definition, validator, and deterministic authority
projection exist and are tested, but nothing is configured to consume them. A
path missing any of those remains unavailable for consequential petitions.

This document does not design jurisdiction or mandate resolution, admission,
the council, durable cases, or the physical petition store. It names the values
those concerns must exchange without assigning their internal mechanisms.

## Decision

A petition identity is three things kept together:

1. An unpredictable, durable `petitionId` used for correlation.
2. An immutable, versioned petition envelope containing the exact request,
   target, authority context, scope, and validity interval the user approved.
3. A request-bound asymmetric proof produced by the user's credential owner
   over that envelope.

The identifier is public and conveys no authority. The proof, not knowledge of
the identifier or envelope, establishes the user. The complete envelope and
proof are recorded before dispatch and remain the identity of what was asked
after their authority has expired.

Ecosym creates the envelope and carries the resulting proof, but it has no
private signing key, reusable user credential, runtime credential, or service
identity. The target runtime maps the proof's credential to the same user
principal it recognizes for requests made outside Ecosym. An Ecosym-specific
principal or a credential that grants Ecosym rights of its own is prohibited.

Version 1 supports direct approval of one petition only. It does not support a
session grant, unattended signing, or a reusable delegation. A future delegated
petition would require a separately designed, attributable, scoped, revocable,
and expiring authority record.

## Distinct identities

The following values are intentionally not interchangeable:

| Value | Owner and purpose | What it does not prove |
| --- | --- | --- |
| `petitionId` | Ecosym-generated durable correlation ID | User identity, approval, admission, execution, or outcome |
| Envelope digest | Exact identity of the bytes the user approved | Who approved them or whether they remain authorized |
| User proof | User credential owner's approval of one envelope for one audience and interval | That the mandate permits it or that a runtime admitted it |
| `admissionId` | Runtime control-plane decision | User approval, launch, or outcome |
| Admission artifact | Runtime control plane's authority for a bounded runtime entry | The user's identity except through its reference to the user proof |
| Execution or effect ID | Runtime/source correlation for actual activity | That an external effect succeeded |
| Source record ID | Source-owned evidence of an outcome | Its petition cause unless the whole correlation chain is present |

Calling all of these a token would hide which owner can assert which fact. A
petition remains a request even after it has been authenticated or admitted.

## Physical form

### Petition identifier

`petitionId` is `petition:` followed by the unpadded base64url encoding of 32
bytes from a cryptographically secure random generator. It is generated before
the envelope is approved and is never reassigned. Randomness prevents collision
and attacker-selected aliases; it is not a secret and is not authentication.

A valid petition cannot be reconstructed from readable state. Anyone may copy a
visible `petitionId` and envelope, but they cannot produce a proof for changed
or new bytes without the user's credential owner. Ecosym and the runtime each
bind a `petitionId` to exactly one envelope digest and `userProofDigest` on first
write.
Presentation of the same bytes is transport redelivery, not a new petition;
presentation of any different envelope or proof under that ID is a protocol
conflict and is refused even if the second proof is otherwise valid.

### Petition envelope

The signed envelope has this version-one shape. Names ending in `Id` are opaque
identifiers in the namespace of their stated owner.

```json
{
  "schemaVersion": 1,
  "petitionId": "petition:<32 random bytes as base64url>",
  "principal": {
    "issuer": "<runtime identity namespace>",
    "subject": "<runtime's existing user principal>"
  },
  "credentialId": "<public identifier of the user's credential>",
  "proofProfile": {
    "id": "<request-proof profile>",
    "revision": "<immutable revision>",
    "definitionDigest": "sha256:<profile definition digest>"
  },
  "audience": {
    "runtimeId": "<connected runtime>",
    "controlPlaneId": "<its authoritative admission boundary>"
  },
  "civilizationId": "<addressed civilization>",
  "authorityContext": {
    "mandateId": "<institution-owned mandate>",
    "mandateRevision": "<immutable revision>",
    "mandateDigest": "sha256:<digest of that revision>"
  },
  "authorityBasis": {
    "type": "direct-user-petition"
  },
  "request": {
    "type": {
      "id": "<request type>",
      "revision": "<immutable revision>",
      "definitionDigest": "sha256:<request definition digest>"
    },
    "operation": "<request-type-defined operation>",
    "resources": "<request-type-defined resource bounds>",
    "parameters": "<request-type-defined parameters>",
    "limits": "<request-type-defined ceilings>",
    "userText": "<optional non-authoritative text>",
    "consequence": {
      "classification": "ordinary",
      "summary": null,
      "recoverability": null
    }
  },
  "notBefore": "<UTC instant>",
  "expiresAt": "<UTC instant>",
  "predecessorPetitionId": null
}
```

The example shows semantic slots, not permission for arbitrary JSON. Each
consequential request type defines one closed schema, its internal consistency
rules, and one deterministic `authorityProjection` over the complete request.
The projection either fails or returns the request's operation, resource bounds,
limits, and consequence classification. The named request fields are the one
authority-bearing representation, not a second scope beside free-form content;
`parameters` and `userText` cannot add authority. The validator rejects any
parameter whose effect falls outside that projection. Unknown envelope fields,
unknown request types, undefined projections, and values outside the selected
request schema are refused.

`userText`, where a request type permits it, is an objective to reason about and
never authority to perform an effect. It cannot widen or contradict the typed
projection. A request type that needs a model to decide which operation or
resources its text authorizes is ineligible for consequential petitions. The
runtime may reason over text only inside the independently enforced typed
ceiling.

For a destructive or materially irreversible request, `consequence` contains
the operation-specific consequence and recoverability or irreversibility
evidence the user must see. Evidence is identified by owner, source record ID,
digest, observation time, and currentness rather than copied as an unsupported
assertion. The request type defines which evidence is required. Missing,
unknown, stale, or mismatched evidence fails closed. Signing the disclosure
proves what the user approved; it does not make the evidence true, so admission
and final enforcement independently obtain and check the referenced evidence.
If the exact destructive operation becomes known only after reasoning, it needs
a new petition with that operation and disclosure.

`authorityContext` identifies the deterministic institution revision shown to
the user. It does not make that revision true. The control plane must obtain the
current mandate through its authoritative mechanism and require the ID,
revision, digest, owning civilization, and deterministic resolution from the
request's authority projection to match before admission. A missing, changed,
ambiguous, inconsistent, or unverifiable mandate fails closed. How the revision
is resolved or conveyed authoritatively is outside this document.

The request type and proof profile names are not mutable labels. Their full
references permanently identify immutable canonical definition records:

- The petition boundary owns request serialization and schema validation. The
  institution owner owns the authority projection, units, resource semantics,
  subset comparison, consequence classification, required evidence, and trusted
  transaction presentation for that request type.
- The target runtime's identity owner owns the proof algorithm and encoding,
  principal-mapping rules, user-verification and transaction-attestation
  semantics, trusted-surface requirements, and credential-owner data handling.

The content-addressed request definition includes both owners' components and
their conformance vectors. A definition never changes in place: any change to a
field meaning, unit, projection, comparison, disclosure, renderer, algorithm, or
attestation rule receives a new revision and digest. The credential owner and
control plane require the exact signed definitions they were configured to
implement and fail on an unknown or mismatched digest. Definitions are reviewed
application or runtime artifacts; a petition cannot supply executable code for
them.

Both definition records are closed version-one canonical JSON documents. Their
digests use, respectively:

```text
SHA-256(UTF8("ecosym.petition-request-definition.v1\0") || JCS(requestDefinition))
SHA-256(UTF8("ecosym.petition-proof-profile.v1\0") || JCS(proofProfileDefinition))
```

Each digest uses the lowercase `sha256:` representation. The signed `id` and
`revision` must equal the canonical definition's own values as well as matching
its digest. A later request-type or proof-profile task must specify the complete
definition record and conformance vectors; it cannot change these identity and
content-addressing rules.

`predecessorPetitionId` links a semantic retry, replacement, or continuation
without changing the predecessor. The link carries no authority from the old
petition. The new envelope receives its own ID, proof, and validity interval.
Transport redelivery after an uncertain send is different: it resends the exact
original bytes and keeps the original ID.

All version-one instants use `YYYY-MM-DDTHH:mm:ss.sssZ`. `notBefore` and
`expiresAt` are user-approved authority bounds, not claims about when signing
actually occurred. Signing time remains unknown unless the selected credential
owner supplies an independently verifiable trusted time. Ecosym's later
`recordedAt` and the control plane's `receivedAt` remain separate source-owned
times.

### Canonical bytes and digest

The proof covers canonical bytes, not an implementation's in-memory object.
Version one uses RFC 8785 JSON Canonicalization Scheme over the envelope and
computes:

```text
SHA-256(UTF8("ecosym.petition-envelope.v1\0") || JCS(envelope))
```

The result is the `envelopeDigest`, represented as lowercase hexadecimal with a
`sha256:` prefix outside the signed envelope. Domain separation prevents an
otherwise identical signature payload from being accepted as another Ecosym
artifact. Implementations preserve the canonical envelope bytes as well as the
digest so the record can be independently checked later.

Changing any signed field, including the principal, audience, authority
revision, request, consequence disclosure, or expiry, creates a different
digest and requires a new `petitionId` and proof. The normalized proof record has
this exact shape:

```json
{
  "schemaVersion": 1,
  "proofProfile": {
    "id": "<request-proof profile>",
    "revision": "<immutable revision>",
    "definitionDigest": "sha256:<profile definition digest>"
  },
  "credentialId": "<public credential identifier>",
  "subjectDigest": "sha256:<petition envelope digest>",
  "proofBytes": "<proof bytes as unpadded base64url>"
}
```

The profile reference and credential ID must exactly equal their signed envelope
values. Non-canonical base64url, including padding or alternate encodings, is
refused. `proofProfile` defines the asymmetric verification algorithm, proof
encoding, trusted transaction-confirmation behavior, user-verification
evidence, and verifier inputs. It is fixed by the runtime connection and
verifier configuration; untrusted petition data cannot select an algorithm or
weaken verification.

The durable `userProofDigest` is:

```text
SHA-256(UTF8("ecosym.user-proof-record.v1\0") || JCS(proofRecord))
```

It is represented as lowercase hexadecimal with a `sha256:` prefix. First-write
bindings, admission references, and causal records use this digest; they never
hash an implementation-specific in-memory proof object.

## Established: proving the user

The user has no Ecosym account. Their principal is the target runtime's existing
stable user principal. Before that runtime can accept consequential petitions,
an explicit bootstrap outside the petition flow maps a user-controlled public
credential to that principal. It uses the runtime's existing authenticated
authority path and grants no permission unique to Ecosym.

The matching private signing capability lives in a dedicated user credential
owner outside the world surface, application core, ordinary stores, runtime
agents, and model context. The owner must:

- keep the private key non-exportable to Ecosym and the runtime execution
  environment;
- process the canonical envelope on the user's machine without sending its
  request, resources, text, or evidence references to a network service;
- accept and validate the canonical envelope bytes, rather than trusting a
  separately supplied digest or display string;
- derive the digest and a human-readable transaction view from those same bytes;
- show the principal, runtime, civilization, request, typed authority ceiling,
  consequence and recoverability disclosure, and absolute expiry on a trusted
  confirmation surface;
- require deliberate user verification and approval of that view for every
  petition;
- attest that transaction confirmation and bind its proof to the resulting
  version-one envelope digest;
- discard the canonical bytes and rendered content after confirmation, retaining
  at most the credential-owned digest and bounded attestation metadata needed to
  verify the proof; never place content in logs, analytics, crash reports, or
  model context;
- identify the credential used without disclosing a reusable secret; and
- expose current revocation or replacement state to the control-plane verifier.

Ecosym may preview the same transaction, but that preview is not the proof of
what the user approved. The credential owner's view is derived from the signed
bytes so Ecosym cannot display envelope A while obtaining a signature for
envelope B. A generic presence prompt that shows no transaction, a background
signing session, an unlocked key API that Ecosym can invoke unattended, an
access token, a cookie, and a shared MAC key do not meet this contract. A shared
key would also let its verifier forge user petitions.

The credential owner sees complete petition content only to provide the trusted
transaction confirmation. That is purpose-limited local disclosure, not
permission to retain or synchronize the content. A cloud-backed signer, remote
identity provider, or profile whose outbound flow and retention cannot be
verified is ineligible for version one.

The target control plane establishes the user only after it has:

1. Recomputed the digest from the received canonical envelope.
2. Required the configured proof profile for that connection.
3. Verified the proof with the currently registered public credential.
4. Required the credential mapping to equal the signed `principal`.
5. Required its own IDs to equal the signed audience.
6. Verified the profile's user-verification and trusted transaction-confirmation
   evidence.
7. Derived the request type's authority projection and checked its signed
   institution and consequence bindings.
8. Checked `notBefore`, `expiresAt`, credential revocation, withdrawal, and the
   first-write petition-ID binding.
9. Durably recorded the verified receipt before considering admission.

Until that happens, Ecosym holds a claimed principal and its evidence, not a
runtime-confirmed identity. The runtime's authenticated receipt is the
source-owned fact that verification succeeded. Invalid proof is a refusal and
never falls back to a less strongly authenticated route.

The durable proof may be retained because it is audience-bound,
request-bound, expiring, and unable to authorize different bytes. A proof
profile that yields only a reusable bearer credential is ineligible. A profile
whose evidence cannot be checked after its online token disappears must instead
produce a durable, signed verification receipt covering the envelope digest,
principal, verifier, transaction-confirmation result, verification time, and
credential status.

## Bound to authority

The user proof is direct approval to ask one control plane to consider one exact
request. It is not admission and does not give Ecosym, a civilization, or a
runtime any authority beyond the request.

The binding has five independent checks:

- The credential owner's trusted confirmation and proof bind the user to the
  exact canonical envelope.
- The request type deterministically derives one authority projection from the
  complete request; duplicated or model-interpreted scope is not accepted.
- The envelope binds that request to one runtime audience, civilization,
  institution revision, consequence disclosure, and interval.
- The control plane independently derives the same projection, checks the
  current institution revision and destructive-effect evidence, and resolves
  whether the request is admissible under it.
- The final runtime enforcement boundary revalidates current authority and
  concrete operation, resource, limit, and consequence evidence before an
  effect.

Neither the user signature nor a signed mandate digest lets a model decide
jurisdiction, equivalence, or authority. A current mandate may reduce what can
be admitted but cannot enlarge the signed request. If the exact request cannot
be admitted, the runtime refuses, defers, or proposes a replacement; it does not
silently reinterpret the signed text.

The proof is weighed as the same principal and direct request would be through
any other accepted runtime entry point. A runtime may apply stricter protective
limits that leave the requested operation and resources unchanged. Any change
to the requested operation, resources, intended effect, audience, or authority
revision requires a replacement petition. No model decides that one request is
"close enough" to another.

For a destructive or materially irreversible effect, identity proof is
necessary but not sufficient. The user must have confirmed the exact
consequence and source-backed recoverability or irreversibility evidence in the
signed envelope, and the final effect boundary must find that operation-specific
authority and evidence still current. Otherwise the effect is refused.

## Scoped

The petition's authority is bounded simultaneously by:

- one random petition ID;
- one credential and runtime-local principal;
- one control-plane audience;
- one civilization and exact institution revision;
- one versioned typed request and deterministic authority projection;
- one operation, resource set, limit set, and consequence classification from
  that projection;
- one validity interval; and
- one immutable predecessor relationship, if present.

The signed scope is a ceiling, not a capability grant. The admission scope must
be no wider than both the petition and the current mandate. The runtime's
concrete capability envelope may narrow budgets, tools, paths, network targets,
or other limits only where the request type defines both the authority
projection and a deterministic subset comparison. The user credential owner and
control plane independently run the versioned projection; disagreement or an
undefined comparison fails closed rather than asking a model whether the change
is harmless.

For version one, every material alteration requires a new petition. The runtime
may return a proposed replacement envelope, but it cannot produce the user's
proof. The user reviews and signs a new ID whose `predecessorPetitionId` points
to the original. The original remains an accurate record of what was first
asked.

## Expired: validity and lifecycle

The petition ID, envelope, and historical proof do not expire or get reused.
Their ability to authorize admission does.

`notBefore` is inclusive and `expiresAt` is exclusive. The control plane's
trusted clock decides the interval. There is no grace after `expiresAt`; clock
uncertainty fails closed and requires a new petition. A credential revocation,
signed petition withdrawal, mandate revision, petition-specific refusal, or
unverifiable authority state can end validity sooner. Nothing silently extends
the signed interval.

No admission mechanism may authorize work at or after `expiresAt` or create an
artifact whose authority extends beyond it. Consequential effect enforcement
also receives the petition expiry and refuses a new effect at or after it.
Long-running work therefore needs an expiry the user actually approved.
Continuing beyond it requires a new signed petition linked to the earlier one;
restart or delay is not authority to renew it.

Runtime responses preserve the original identity as follows:

| Runtime response or event | Identity consequence |
| --- | --- |
| Invalid or unmapped proof | Ecosym's local asked record remains; the runtime records an authentication refusal if it can do so safely; no admission artifact capable of starting work exists. |
| Refused | The immutable petition and refusal remain historical. The same ID cannot later become a different request or a fresh approval. A retry is a new linked petition. |
| Deferred | The same petition may be reconsidered only while its proof, credential, mandate revision, and interval remain current. Deferral creates no artifact capable of starting work and does not pause expiry. |
| Altered | The runtime returns a proposal only. Execution waits for a new envelope, ID, and user proof. |
| Admitted | The admission record references the exact envelope digest and `userProofDigest`. Admission is still not execution or outcome. |
| Withdrawn | Once the control plane records the signed withdrawal, no later admission or effect may rely on the petition. Withdrawal does not undo an effect that already happened. |
| Proof expired or was revoked | No new admission, resumed work, or consequential effect may rely on it. The historical record remains inspectable. |
| Duplicate delivery | The runtime returns the already recorded receipt or decision for the same envelope and normalized proof record. A different envelope digest or `userProofDigest` under the same ID is a protocol conflict and is refused. |

The user withdraws one petition with this exact version-one artifact:

```json
{
  "schemaVersion": 1,
  "withdrawalId": "withdrawal:<32 random bytes as base64url>",
  "petitionId": "petition:<original petition ID>",
  "envelopeDigest": "sha256:<original envelope digest>",
  "principal": {
    "issuer": "<same runtime identity namespace>",
    "subject": "<same runtime user principal>"
  },
  "credentialId": "<current public credential identifier>",
  "proofProfile": {
    "id": "<request-proof profile>",
    "revision": "<immutable revision>",
    "definitionDigest": "sha256:<profile definition digest>"
  },
  "audience": {
    "runtimeId": "<same connected runtime>",
    "controlPlaneId": "<same admission boundary>"
  },
  "action": "withdraw"
}
```

`withdrawalId` uses the same random-byte and canonical base64url rules as a
petition ID. The `withdrawalDigest` is
`SHA-256(UTF8("ecosym.petition-withdrawal.v1\0") || JCS(withdrawal))`, with the
same lowercase `sha256:` representation as an envelope digest. Its normalized
proof record has the shape defined above with `subjectDigest` equal to the
withdrawal digest; the same proof-record formula produces a distinct
`withdrawalProofDigest`.

Any currently valid credential mapped to the principal may prove the withdrawal,
which preserves withdrawal after key rotation. The credential owner receives
both canonical artifacts, verifies that the original envelope has the stated
digest and identity, and shows the original transaction plus the withdrawal
action on its trusted surface before proving the withdrawal digest. The artifact
contains no purported effective time and grants no authority, so it does not
need an expiry. Ecosym records the withdrawal artifact, normalized proof, and
their digests before forwarding them.

The control plane verifies the exact artifact and proof, current credential
mapping, principal, audience, and trusted confirmation attestation. It binds
`withdrawalId` to `withdrawalDigest` and `withdrawalProofDigest` on first write;
exact
redelivery is idempotent and conflicting bytes are refused. If the petition is
already present, its envelope digest must match. If it has not yet arrived, the
control plane records the signed digest in a tombstone keyed by principal,
audience, and petition ID. A later matching petition is recorded as withdrawn
and cannot be admitted; a later different envelope under that ID is a conflict.
If no user credential is available, the runtime's existing
credential-revocation path may invalidate all petitions under that principal,
but Ecosym cannot forge a petition-specific withdrawal.

Petition receipt, withdrawal, admission authorization, and final effect
authorization share one authoritative per-petition order at the control plane.
Their implementation may vary, but it must be linearizable: each operation
commits before or after the others, and no cache or check-then-act gap may
authorize from an earlier validity snapshot. Final enforcement obtains an
operation-specific authorization from that ordering point immediately before
the effect begins. If withdrawal commits first, later admission and effect
authorization are refused. If effect authorization commits first, that exact
effect may proceed and the later withdrawal cannot claim to undo it. The
control-plane receipt records this order and its own `withdrawnAt`; that
source-owned record, not a caller-supplied time, establishes when withdrawal
took effect.

This document does not decide how a durable matter resumes after a process
restart or how duplicate execution is prevented. Any later admission or case
design must preserve the petition identity, check its current validity, and
must not depict a resumed process as a newly asked petition.

## Relationship to runtime admission

The signed single-use grant proposed by the 2026-08-31 admission-control
research could belong after user-proof verification and mandate resolution,
between the control plane and a locked launch boundary. It is not the petition
identity, and this document does not select it as the admission mechanism.

The candidate's manifest hash, `admissionId`, runner identity, capability
envelope, nonce, and expiry are useful launch bindings. To fit this identity
contract it would also have to reference the petition ID, envelope digest,
`userProofDigest`, verified principal, and current mandate
revision. Its signer would
be the runtime control plane, never Ecosym. Its signature would prove what that
control plane admitted, not who asked or what happened afterward.

An opaque online redemption or another mechanism could carry the same
references. Signed versus opaque transport, one-use enforcement, launch
atomicity, retry, crash behavior, and process restart all belong to the later
admission and case designs. Whatever is selected must be non-bypassable and may
not authorize beyond the petition's signed scope or expiry. Refusal, deferral,
and an alteration proposal create no artifact capable of starting work.

## Recorded: durable ownership

The petition boundary is the logical owner of Ecosym's petition identity
record. The choice of database and schema remains open, but the following
record is committed atomically before dispatch:

- canonical envelope bytes and parsed schema version;
- `petitionId` and `envelopeDigest`;
- normalized proof record and `userProofDigest`;
- a uniqueness binding from `petitionId` to the envelope digest and
  `userProofDigest`;
- local `recordedAt`, classified as Ecosym's record time rather than user
  approval or runtime receipt time; and
- the intended dispatch audience and a unique dispatch-intent ID, without a
  claim that transport already happened.

If this commit fails, Ecosym does not dispatch. If dispatch succeeds but its
response is lost, Ecosym retries the same bytes and identity; it does not mint a
new identity merely because delivery is uncertain.

Dispatch and lifecycle facts are appended after their respective events. The
petition boundary owns local dispatch-attempt records: when an attempt began,
which immutable dispatch intent it used, and the transport's local return. A
successful local send is not runtime receipt. The observation owner separately
stores authenticated runtime receipts, decisions, launches, and external source
records with their provenance. The petition record refers to those observation
IDs; it neither owns nor rewrites their facts.

Signed withdrawal artifacts retain their canonical bytes, withdrawal digest,
normalized proof record, `withdrawalProofDigest`, first-write withdrawal-ID
binding, local record time, and dispatch intents. They append to the petition
history and never mutate the original envelope or proof.

The target control plane separately records, before admission or launch:

- the exact received envelope and normalized proof record or durable
  content-addressed copies;
- its source-owned receipt time;
- a first-write uniqueness binding from petition ID alone to exactly one
  envelope digest and `userProofDigest`, with exact redelivery idempotent and any
  conflict refused. The binding is global, not scoped to a principal: two
  principals presenting different envelopes under one visible ID would break
  the correlation the ID exists to provide;
- proof verification result, profile, credential mapping, and current
  revocation evidence;
- the mandate revision and evidence used for its decision;
- refusal, deferral, or admission with a unique `admissionId`;
- any verified petition withdrawal, including a pre-petition tombstone, its
  normalized proof and digests, and its effective receipt time;
- the authoritative per-petition order of receipt, withdrawal, admission
  authorization, and effect authorization; and
- references to separately owned launch and execution records, if those events
  occur.

Storage location does not transfer authority. In particular:

| Concern | May hold | Must not hold |
| --- | --- | --- |
| User credential owner | User private key, trusted transaction renderer, credential lifecycle, user-verification policy, bounded proof metadata | Petition content after confirmation, outbound content disclosure, petition authority on Ecosym's behalf, or a runtime control-plane key |
| Ecosym petition record | Envelope, public proof, digests, local dispatch history, withdrawal artifacts, references to observations | User private key, reusable user credential, runtime credential, control-plane signing key, or usable admission capability |
| Runtime control plane | Public user verifier and principal mapping, verification, withdrawal, and admission records, its own protected admission capability | An Ecosym principal substituted for the user or the user's private key |
| Runner | Only the verification or redemption material a later admission design permits, plus execution correlation | User credential, control-plane issuance capability, or authority to alter the petition |
| Observation owner | Source-attributed observations and causal references | A manufactured cause or a runtime claim stored as a source-owned outcome |

Usable bearer values and private material never enter logs, errors, model
context, exports, or ordinary durable records. The exact petition proof is not a
bearer secret under this design: it can validate only the already recorded,
audience-bound envelope and replay is refused.

Petition identity records are Ecosym-owned state and must be inspectable,
exportable, and deletable by the user. Correction appends a superseding record;
it does not rewrite what was asked. Deletion must state that it can make later
attribution unverifiable, and deleted records must not silently re-enter from an
index or cache. Retention periods and the physical deletion workflow remain a
separate product decision.

## Later outcome attribution

Temporal proximity is never causal evidence. A later outcome may be attributed
to a petition only when every link below is established by a record from the
owner of that relationship and observed with its provenance:

```text
petitionId + envelopeDigest + userProofDigest
  -> verified runtime receipt
  -> admissionId
  -> launch and execution identity
  -> effect-request identity
  -> source-owned effect receipt or record
  -> Ecosym observation of that source record
```

No single copied chain or runtime report satisfies this requirement. The
required owners and evidence are:

| Relationship | Owner-backed evidence |
| --- | --- |
| Petition to verified receipt | The user credential owner's proof plus the control plane's authenticated receipt for those exact digests |
| Receipt to admission | The authoritative control plane's decision record containing the receipt and `admissionId` |
| Admission to execution | The runtime's authoritative launch boundary record binding the admission to the actual launch and execution ID |
| Execution to effect request | The final enforcement boundary's pre-effect record binding the execution, admission, canonical effect operation and parameters, and a fresh `effectRequestId` |
| Effect request to source result | A source-owned acceptance or operation record that associates its native operation ID or enforced idempotency key with the exact operation and result |
| Source result to observation | The observation owner's record of that source-owned record, including source owner, source ID, source time, and collection time |

The final enforcement boundary creates `effectRequestId` before the effect and
binds it to a digest of the exact typed effect operation, resources, and
parameters it checked. The request carries that identity through the actual
effect boundary. The external source must enforce or durably associate the
identity with the operation it accepted and the status it owns. Merely echoing
caller-supplied metadata without binding it to a source-native operation is not
causal evidence.

The observation owner stores each available owner record separately and derives
the chain from their exact references. A runtime-authored statement that an
external effect succeeded remains a claim even when it contains all of the IDs
above.

If a source cannot preserve a correlation value, the resulting source-owned
fact may still be a valid observation, but its petition cause is unknown. A
copied `petitionId` in arbitrary metadata, an admission audit entry, matching
content, a source that only echoes an unbound label, or closeness in time does
not repair the missing link.

An altered or renewed petition begins a new chain. Its predecessor link explains
history but does not let an outcome under the replacement be attributed to the
original request.

## Existing confirmation previews

`confirmation_previews` in `src/store.ts` is useful prior art for exact binding
and replay resistance, but it proves a different fact.

The store generates an unpredictable bearer token and, while it is usable,
retains only its hash with the exact operation, arguments, state fingerprint,
and issue time. Successful confirmation consumes that preview atomically; the
operation's audit record then retains the presented token after it can no longer
be used. This fixed Task 011's defect, where a caller could compute the old
confirmation from values printed by `status`. It proves that a matching preview
was issued and its token presented once. It does not prove who requested or
confirmed the preview.

A petition reuses the principles that readable state is insufficient, exact
bytes are bound, and replay is recorded. It differs because:

- its public ID is correlation rather than a bearer secret;
- an external user credential, not Ecosym randomness, proves the principal;
- its proof binds an audience, institution revision, typed scope, and explicit
  expiry;
- refusal and deferral must remain meaningful without any launch-capable
  admission artifact; and
- its identity participates in a source-backed causal chain after dispatch.

Confirmation previews deliberately do not expire because unchanged local state
preserves the previewed consequence. That reasoning cannot apply to a petition:
credential validity, mandate state, and consequential authority all change with
time.

## Limits

This design cannot:

- prove a biological person rather than control of a registered credential;
- survive compromise of the user's credential owner, its confirmation surface,
  the control plane, or the authoritative principal mapping;
- use a generic authenticator prompt that proves presence but does not show the
  canonical transaction as proof of informed approval;
- make a runtime's launch path non-bypassable merely by signing an artifact;
- turn a runtime claim about an external effect into an observation;
- recover causal attribution when the effect path or source discards its
  correlation identity;
- guarantee exactly-once launch or effect from petition identity;
- preserve independently verifiable attribution after its required records are
  deleted; or
- allow useful work after expiry without another explicit user approval.

Cryptographic forgery is computationally rather than mathematically impossible.
The structural property required here is that every component able to read or
copy petition state lacks the user's signing capability, while every accepting
control plane requires that capability's proof and durable replay state. An
attacker controlling the credential owner is outside that property and is
reported as credential compromise, not treated as an impossible event.

## Open decisions

The identity invariants and exchanged records above are fixed. The following
mechanism and product choices remain open. Each is a named blocker; an
implementation may not settle it silently.

| Decision | Options and consequences | What settles it |
| --- | --- | --- |
| First user credential owner and proof profile | The profile needs trusted transaction confirmation derived from canonical envelope bytes, not just a signature or presence prompt. It must process content on-device without network disclosure or content retention. A transaction-signing platform authenticator may add enrollment, recovery, origin, and interaction design. OS peer credentials alone are insufficient wherever agents or unattended Ecosym code share the user's account. An Ecosym service key is prohibited. | Select the first runtime and empirically demonstrate canonical-byte parsing, the exact trusted display, digest binding, user verification, private-key isolation, durable verification, current revocation, mapping to its existing principal, outbound isolation, and bounded retention. Until then no consequential petition is implementable. |
| First consequential request type | **Settled.** A narrow typed operation defines a total authority projection and consequence evidence; a free-form request whose authority depends on model interpretation cannot. | The closed request schema, validator, and deterministic projection exist, with tests showing that conflicting text/parameters, civilization/mandate mismatches, destructive disclosures, and subset comparisons fail closed. Nothing is configured to consume the type yet. This does not choose jurisdiction or mandate rules. |
| Credential bootstrap, rotation, recovery, and revocation | These may use the runtime's existing authenticated credential-management path. Building an Ecosym identity provider would create product and authority scope not approved here. | Document the selected runtime owner's current mechanism and test that an old or revoked credential fails closed without losing historical verification. |
| Maximum petition lifetime and renewal interaction | A short interval limits stale authority but interrupts long work; a long interval approaches standing authority. The signed field, withdrawal path, and fail-closed behavior are fixed, but no duration is justified yet. | A user decision informed by the first real petition and runtime restart case. The trusted transaction surface must show the chosen absolute expiry; an implementation may not hide a default. |
| Admission mechanism | A signed self-contained grant tolerates a temporarily unavailable control plane but still needs replay/revocation state. Online opaque redemption centralizes those checks but makes launch depend on that service. This document selects neither. | The later admission design identifies a non-bypassable launch owner and demonstrates denial of direct launch, whatever replay property it claims, and current-authority checks. |
| Source correlation | Some effect owners enforce and retain idempotency or operation IDs; others only echo metadata or retain none. The latter cannot support petition attribution. | Each effect integration demonstrates the enforcement-bound effect digest and a source-owned operation record carrying its native or enforced pre-effect identity. Unsupported integrations report cause as unknown. |
| Petition store and retention | The logical record and user-control obligations are fixed; database, schema, backup, and retention are not. Deletion can intentionally break future attribution. | A storage task inventories the records, chooses deterministic structural migration, and obtains the user's retention and deletion decision without designing the case store. |

There is no contradiction among the canonical documents. There are current,
load-bearing gaps rather than hidden implementation freedom:

- `ARCHITECTURE.md` names the petition boundary and durable identity but not a
  physical source of record;
- no trusted transaction-confirmation credential owner or proof profile has
  been selected;
- a consequential request-type definition, validator, and deterministic authority
  projection exist and are tested, but nothing is configured to consume them;
- mandate resolution and authoritative delivery to a control plane remain
  undesigned outside this boundary;
- no runtime is known to provide non-bypassable admission; and
- no effect integration has demonstrated the owner-backed causal chain.

This document fixes the logical identity record, proof semantics, validity,
withdrawal, and exchanged references without pretending those mechanisms
exist. Representation and storage tasks can now be written against it. A
consequential dispatch task remains blocked until its credential profile,
runtime admission boundary, and effect correlation path are each selected and
proven.
