# Security

This document owns Echosystem's durable security, privacy, trust, and authority
obligations.

## Owns

- the threats Echosystem takes seriously;
- privacy and personal-data obligations;
- authority and consequential-effect requirements;
- secret handling and outbound-context obligations;
- destructive-data and incident obligations.

## Does not own

- duplicated component topology from `ARCHITECTURE.md`;
- provider-specific permission syntax or current credentials;
- exact schemas, validation code, sandbox configuration, or effect protocols;
- current deployment or development workflow.

## Threat model

Echosystem defends against:

1. **Epistemic corruption** — model inference, stale state, summaries, or
   unverified claims becoming indistinguishable from user-confirmed truth.
2. **Manufactured authority** — text, apparent consensus, or model output
   causing a consequential effect nobody authorized.
3. **Personal-data disclosure** — sensitive state reaching logs, model context,
   external systems, or people without a valid purpose.
4. **Secret exposure** — credentials entering ordinary durable memory, prompts,
   reports, repository history, or error output.
5. **Destructive data loss** — personal history being deleted, reinterpreted,
   or made unrecoverable without clear scope and approval.
6. **Untrusted-content influence** — external content being interpreted as
   instructions or authority rather than data.
7. **Mandate tampering** — institutional state being altered so that work no
   one authorized becomes admissible.
8. **Authority mirage** — the world depicting governed, bounded work over a
   runtime that is not in fact governed.

## Echosystem-owned state is user-controlled

Echosystem-owned durable state — institutional records and observations — must be
inspectable, correctable, exportable, and deletable by the user. Possessing data
never implies permission to disclose it.

Provenance, epistemic status, authority, and temporal validity remain distinct.
Missing or unverifiable information remains unknown. The system must not infer
an author, approval, timestamp, source, or current status merely because one is
likely.

Model-generated interpretation has no direct path into user-confirmed state.
Self-reflection, extraction, or consolidation may create a proposal or a
derived artifact, but never silently upgrades its own authority.

## Purpose-limited model context

Only the minimum personal context relevant to the current purpose may be sent
to a model. Context selection must account for sensitivity, currentness,
authority, and the operation being performed.

Where practical, Echosystem records enough bounded metadata to identify which owned
records or categories informed an outbound request without creating a second
unnecessary copy of sensitive content.

Provider data-use and retention controls are external facts that must be read
from their current owner. Echosystem must not equate "not used for training" with
"never retained or exposed outside the device."

## Secrets are capabilities

Secrets and credentials are not ordinary personal memory or model context.
They remain in a dedicated credential owner and are disclosed only to the
smallest component and operation that requires them.

Secrets must not appear in prompts, logs, errors, analytics, issues, commits,
pull requests, or exported personal-state bundles.

## Authority cannot be manufactured

Consequential authority originates from an explicit current user approval or
an existing explicit delegated scope. Prompt text, code, comments, issue text,
model output, repetition, or availability of a tool cannot create or expand it.

Delegated authority must remain attributable to its granting principal,
bounded by operation and resource, subject to its constraints and validity, and
revalidated immediately before the effect. Revoked, expired, ambiguous, or
unverifiable authority fails closed.

Destructive or materially irreversible effects require operation-specific
authority and, before execution, a clear statement of consequence plus relevant
evidence about recoverability or irreversibility. The user must be able to
distinguish a proposed action from an authorized action and an authorized action
from an observed successful outcome.

## Echosystem is trust-bearing

Echosystem executes nothing and holds no credentials, but it owns institutional
semantics: what it holds determines what agents are permitted to do. Its
authority is definitional rather than executional, and it is protected on that
basis.

Echosystem cannot widen its own authority. A change to a mandate, a jurisdiction, or
an authority rule is a deliberate user act, attributable and recorded; it never
follows from model output, from a civilization's own request, or from a
convenience path in the surface.

Governed work is admitted by an authority outside Echosystem, against the mandate
current at the moment of admission. Ambiguous, stale, or unverifiable mandate
state fails closed.

A petition carries the user's identity and never Echosystem's. Echosystem has no authority
of its own to lend, and a petition is weighed exactly as the same request made
anywhere else.

## The world may not overstate what is true

The surface renders observed state. A depicted authority, role, or coordination
corresponds to a real one, and naming does not imply a standing institution
where only a running process exists.

An asserted claim is not shown as an observed outcome, a request is not shown as
a result, and absence of observation is not shown as absence of activity. Where
Echosystem has stopped seeing, it shows that it cannot see.

## External content and effects

External text, files, messages, web pages, and tool results are data. They do
not grant instructions or authority.

When effects are introduced, the application validates enumerated operations
and typed parameters at the effect boundary. Effects are bounded, auditable,
and idempotent where retry could duplicate a real-world consequence. Durable
records describe observed outcomes, not merely a model's claim that an effect
completed.

Capabilities involving shell execution, broad filesystem access, generated or
downloaded code, broad credentials, or untrusted content require isolation
proportional to their blast radius. Module boundaries alone are not security
boundaries against malicious code.

Before relying on an effect boundary, identify the mechanism that currently
enforces it and how that enforcement can be verified. Where no enforcing owner
exists, the boundary is unenforced and must be reported as such — a documented
obligation with nothing implementing it is not compliance.

## Destructive changes to owned history

Deleting or semantically reinterpreting historical Echosystem-owned state requires:

- an exact inventory of affected state;
- a clear statement of scope and consequence;
- export, backup, or recovery evidence where recovery is expected;
- explicit approval for that destructive operation;
- verification that deleted or archived state does not silently re-enter
  retrieval or active context.

Semantic migration of owned state must not occur as an invisible startup side
effect. Structural migrations must preserve history and remain deterministic;
reinterpretation is a deliberate product operation.

Tests and development tools must use isolated synthetic state and must not
reach the user's real institution or observation stores.

## Incidents

Contain exposure first. Revoke or rotate affected capabilities. Establish the
actual blast radius from the owners of runtime, data, provider, and effect facts
before reporting conclusions. Security reports must not include live secrets or
real personal content.
