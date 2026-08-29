# Security

This document owns Axey's durable security, privacy, trust, and authority
obligations.

## Owns

- the threats Axey takes seriously;
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

Axey defends against:

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

## Personal state is user-controlled

Axey-owned personal state must be inspectable, correctable, exportable, and
deletable by the user. Possessing personal data never implies permission to
disclose it.

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

Where practical, Axey records enough bounded metadata to identify which owned
records or categories informed an outbound request without creating a second
unnecessary copy of sensitive content.

Provider data-use and retention controls are external facts that must be read
from their current owner. Axey must not equate "not used for training" with
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

## Destructive changes to personal data

Deleting or semantically reinterpreting historical personal data requires:

- an exact inventory of affected state;
- a clear statement of scope and consequence;
- export, backup, or recovery evidence where recovery is expected;
- explicit approval for that destructive operation;
- verification that deleted or archived state does not silently re-enter
  retrieval or active context.

Semantic migration of personal state must not occur as an invisible startup
side effect. Structural migrations must preserve history and remain
deterministic; reinterpretation is a deliberate product operation.

Tests and development tools must use isolated synthetic state and must not
reach the user's real personal database.

## Incidents

Contain exposure first. Revoke or rotate affected capabilities. Establish the
actual blast radius from the owners of runtime, data, provider, and effect facts
before reporting conclusions. Security reports must not include live secrets or
real personal content.
