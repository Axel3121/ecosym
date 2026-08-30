# Development

This document owns the stable obligations for developing Axey. Current tools
may implement these obligations but do not redefine them.

## Owns

- how current scope and current facts are established;
- the meaning of coherent work, writer ownership, and evidence;
- implementation, review, publication, and merge boundaries;
- when coordination or additional machinery is justified.

## Does not own

- product, architecture, or security semantics owned by their canonical docs;
- provider, model, agent, worktree, launcher, or command selection as policy;
- exact machine grammars, live branch/session state, or current CI results;
- a lifecycle state machine or custom development control plane.

## Resolve from actual owners

Work begins from the current task, current repository, and relevant canonical
owners. Facts that can change are revalidated when needed:

- Git owns repository content, commits, branches, and refs;
- GitHub owns issue, pull-request, review, and merge state;
- CI owns a check result bound to an exact artifact;
- runtime and configuration own current operational state;
- code, migrations, and tests own current executable behavior;
- `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md`, and this document own their
  respective durable normative meanings.

Research reports, Jarvis history, old plans, issue comments, agent memory, and
session summaries are evidence. They become current reusable direction only
when deliberately promoted to the appropriate owner.

A copy, summary, projection, or mechanism does not become the owner of what it
describes. If no owner can answer a load-bearing question, report the gap rather
than inventing certainty.

## Work units

A meaningful work record states an unresolved problem, desired outcome, durable
constraints, and useful acceptance evidence. It should not freeze implementation
details that discovery should decide.

An issue is useful when work must survive the current session, may be deferred
or reprioritized, has non-obvious acceptance, contains an unresolved human
decision, or coordinates multiple efforts. A separate issue is not required for
a small change already explained durably by its commit and pull request.

A work record describes scope authorized elsewhere. Its text, existence,
assignment, priority, labels, or coordinator allocation does not itself grant
execution or publication authority. Those come from explicit maintainer
instruction or an already-existing scoped delegation.

There is no rule that one issue equals one branch, commit, or pull request. The
delivery unit is the smallest coherent outcome that leaves the repository
useful, understandable, and verifiable.

## Repository artifacts

- Canonical documents own reusable current normative meaning.
- Issues own meaningful unresolved problems, outcomes, and acceptance evidence.
- Code and configuration own current implementation reality.
- Commits own durable historical implementation deltas and rationale.
- Pull requests own coherent candidate delivery, review, and evidence surfaces.
- Comments own local clarification and evidence, not hidden reusable policy.
- ADRs preserve earned historical rationale; they do not replace current
  semantic owners.

## Selection, coordination, and execution

Known, bounded, and authorized work may go directly to execution. Coordination
exists when work must be selected, grouped, prioritized, allocated, or reshaped
to avoid overlap. Coordination never creates or expands authority.

The executor owns repository exploration, decomposition inside the approved
outcome, implementation, tests, and coherent commits. Do not build another
coding harness inside a coordinator.

Optimize trustworthy delivered outcomes per unit of human attention, not busy
agents, issue count, commit count, or parallel sessions.

## Writer ownership and concurrency

At one time, one writer owns each overlapping mutable claim. Work that is truly
disjoint may proceed concurrently when the expected delivery benefit exceeds
the coordination and review cost.

When work overlaps, serialize it, reshape the outcomes, or perform an explicit
handoff. A branch or worktree is a useful mechanism for source isolation but is
not runtime isolation and is not itself the invariant.

Source concurrency does not imply isolated ports, processes, databases,
credentials, caches, or machine resources. Stronger isolation must follow the
actual risk or collision being prevented.

## Implementation and evidence

Implementation stays within the authorized outcome and preserves the relevant
product, architecture, and security invariants. Verification is proportional
to the behavior and boundaries changed.

Normal correctness properties use deterministic tests and checks. Model
behavior uses small repeated evals and human assessment where deterministic
proof is unavailable. Real usefulness is learned through dogfooding and user
outcomes.

Missing verification is reported as unknown, never as success. A passing test
is evidence only for the property it actually establishes.

Repository checks should have one ordinary, agent-independent entry point that
humans, local agents, and CI can run. Add enforcement only for a valuable
property a machine can establish reliably.

## Commits and history

A commit is a meaningful durable implementation delta or checkpoint. It should
leave the repository understandable and record useful rationale where the diff
alone is insufficient.

Do not commit every agent turn, formatting detour, failed attempt, or process
artifact. Related corrections may be consolidated when that produces clearer
history; distinct consequential corrections may remain distinct.

Rewriting shared or published history is a separate destructive action and
requires explicit approval.

## Runtime facts do not belong in specifications

A work item states what must be true, not what happened to be true when it was
written. Row counts, current states, file listings, and similar runtime facts go
stale between writing a specification and executing it — sometimes within
minutes — and a stale fact written as an acceptance criterion makes correct work
look wrong.

Where a specification needs a current fact, it names the command that produces
it or expresses it as an assertion a test evaluates. It does not copy the value
into prose.

## Review

Review challenges a completed candidate; it does not own implementation or
merge authority.

Review depth is proportional to consequence and uncertainty. Independent
review is required when the candidate affects a consequential boundary, when
deterministic verification cannot establish a load-bearing property, or when
the current work record or maintainer explicitly requires it. Once required
and the exact candidate is frozen, the current execution mechanism should
invoke that review automatically rather than depend on the writer remembering
to request it.

A candidate is consequential — review is mandatory, not a judgement call — when
it touches any of: credentials or capabilities; external effects; personal data
flow; authority or admission; migrations or otherwise irreversible change;
concurrency or isolation; or any claim that deterministic checks cannot prove.

Where mandatory review cannot be run, the status is blocked or unknown. It is
never waived by absence.

Independent review uses:

- fresh or separate context from the writer;
- a structurally read-only role;
- an exact candidate artifact and comparison base;
- the intended outcome, relevant changed surface, and verification evidence;
- targeted questions derived from plausible failure modes and affected
  invariants.

Independence is necessary but not sufficient. Generic requests to "find bugs"
can miss important defects even when the reviewer is fresh and read-only. The
artifact, context, and questions must make the relevant consequence visible.

A finding is a challenge supported by a failure scenario, counterexample,
contract violation, or other concrete evidence. Valid findings return to the
writer for correction. Invalid findings are rejected with evidence. Persistent
concrete disagreement becomes a human decision rather than an automated debate.

A material candidate change invalidates review evidence for the affected
surface. Re-run deterministic checks and re-review only what the correction or
new change made uncertain.

When independent review is required, failure to start or complete the reviewer
leaves review status unknown or blocked; it is never evidence that the
candidate passed. When independent review is not required, the delivery
evidence records the proportionality rationale.

One independent review is the normal minimum when it is required, not a
permanent maximum. Security, migration, concurrency, personal-data, or
authority changes may justify a distinct specialist question or additional
perspective.

## Publication and merge

Implementation, publication, and merge are separate actions.

- Implementation produces a verified local candidate.
- Publication pushes a finished branch and opens or updates one coherent pull
  request with outcome, evidence, and material risks.
- CI verifies the exact published head.
- Merge always requires an explicit decision from a current maintainer.

Neither a model, reviewer, assignment, passing check, label, nor workflow state
grants merge authority. Native repository protections should enforce the
branch, pull-request, and check properties they can prove.

## Complexity must be earned

Prefer an existing capable owner or native mechanism. Add a scheduler, workflow
engine, agent database, risk grammar, reviewer loop, worktree manager, custom
governance system, or separate runtime only after a repeated concrete failure
shows that current owners cannot provide the required property.

Security isolation is the exception: it is justified by an unmet invariant, a
threat model, or blast radius, and does not wait for a failure to occur first.
`SECURITY.md` owns when isolation is required.

The sequence is:

```text
simple mechanism
  → observe repeated failure
  → identify the violated invariant
  → test whether an existing owner can enforce it
  → add the smallest mechanism that closes that gap
  → keep semantic ownership unchanged
```

Architecture that exists only to protect Axey from hypothetical future choices
is not earned complexity.

## Decision records

Architecturally significant, costly-to-reverse decisions may receive an ADR
when preserving alternatives and rationale has durable value. Current library
or tool selections do not earn ADRs merely because they were selected. No ADR
framework or directory is required before the first decision qualifies.
