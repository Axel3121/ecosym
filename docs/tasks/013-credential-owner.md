---
needs:
  - 012-petition-identity
touches:
  - docs/credential-owner-findings.md
---
# Task 013 — Find out whether any credential owner on this machine can carry a petition

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md`, `DEVELOPMENT.md` and
`docs/petition-identity.md` first. That last one is the contract this task
tests. It is not up for revision here.

Work on branch `task/013-credential-owner` in this worktree. Commit each
coherent verified piece as you go.

## Why this task exists

`docs/petition-identity.md` names its own first blocker:

> First user credential owner and proof profile … Until then no consequential
> petition is implementable.

Every other open decision waits behind it. The design says what a proof must
do; nothing has established that anything available can actually do it.

This task answers that by measurement, not by survey. The honest outcome may
be that nothing on this machine qualifies. That is a real result and must be
reported as one — it stops a consequential petition path from being built on a
proof that cannot be produced.

## Outcome

A written finding at `docs/credential-owner-findings.md` that says, with
evidence a reader can re-run, which credential owners were tested and what each
one actually did. Then a recommendation: which one should be the first proof
profile, or that none of them can be.

## What the design requires of a proof

From `docs/petition-identity.md`. Each is a property to test, not to assume:

1. **Canonical-byte binding.** The signature covers the exact envelope bytes,
   not a summary or a re-encoding.
2. **Trusted transaction confirmation.** The user sees what they are approving,
   from those same bytes. A presence prompt that says "authenticate?" is not
   this, and the difference is the entire point.
3. **Private-key isolation.** The key is not readable by the process asking for
   the signature, and not by an agent sharing the user's account.
4. **Durable verification.** A proof made today still verifies later, after the
   authority it carried has expired.
5. **Current revocation.** A revoked credential fails closed, without
   destroying the verifiability of proofs it made while valid.
6. **Existing-principal mapping.** The runtime can map the credential to the
   same user it already recognises. Ecosym holding a service identity is
   prohibited — see `PRODUCT.md` l. 143.

## What must be true of the work

**Every claim is something you ran.** A property that was reasoned about but
not executed is reported as untested, named as such, with what would settle it.
A capability that documentation asserts and the machine did not demonstrate is
documentation, not evidence.

**A negative result is a result.** If no owner satisfies the profile, say so
plainly and say which property each one failed on. Do not soften it into "with
some work, X could".

**Test the control case.** Before believing a signature verified, confirm that
a tampered byte makes it fail. A verifier that accepts everything looks exactly
like a verifier that works — `DEVELOPMENT.md` owns this rule.

**No credential material in the repository.** No keys, no private material, no
real user secrets in tests, output, or committed files. Synthetic test keys
generated inside the run are fine and must be left behind. `SECURITY.md` owns
this.

**Nothing is installed system-wide.** Test what is present. If a candidate
requires an install to evaluate, say what it would need and leave it untested
rather than changing this machine.

## Candidates

At minimum, establish for each whether it is present and what it can do:

- WebAuthn / FIDO2 platform or roaming authenticators, specifically whether any
  present one supports transaction confirmation over supplied bytes rather than
  presence-only assertion
- `systemd-creds` and TPM2 sealing, if a TPM is present
- GPG smartcard or agent-held keys
- `age` / `minisign` / `signify` style file signers
- SSH agent signing (`ssh-keygen -Y sign`), including whether the agent can be
  made to display what it signs
- OS keychain or secret-service held keys

Add any candidate you find. Remove none without saying why.

Pay attention to property 2. Most signers will pass 1, 3 and 4 and fail 2 —
that is the expected shape of the result, and the finding is *which* ones fail
it and how completely.

## What would prove it worked

A reader who does not trust this document can, from it alone:

- re-run each command and get the same answer;
- see which properties were demonstrated and which were not attempted;
- see one worked example of a signature over canonical envelope bytes, and the
  same verification failing on a single flipped byte;
- tell whether the recommendation follows from the evidence or exceeds it.

## Out of scope

Implementing petition dispatch, admission, the case store, or any change under
`src/`. This task produces a finding and its evidence, nothing else.

Choosing the maximum petition lifetime — that is the user's decision, informed
by this.

## Report

State which owners were tested, which properties each demonstrated, which were
untested and why, and what you recommend. Name anything in
`docs/petition-identity.md` that turned out to be unbuildable as written.
