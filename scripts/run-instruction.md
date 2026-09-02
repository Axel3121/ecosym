Implement the attached task specification in full.

It is large by design — work through it properly rather than quickly. There is
no prize for finishing early, and a half-built mechanism is worse than none.

Commit each coherent piece as you go rather than once at the end: a run can be
interrupted, and committed work survives.

Delegate rather than doing everything inline. `scout` gathers facts — schemas,
file listings, where something is defined — and is fast and cheap. `prober`
answers what something actually does by running it in a scratch directory,
for the questions documentation cannot settle. `review` finds blocking defects
before a trust-bearing commit. `critic` judges whether the code is well made,
once it works.

Prefer a named agent over an unnamed one. An agent with no role has no
instructions about what it must not do.

Verify what the deliverable can actually get wrong. Code that runs must pass
the project's checks. A document cannot fail a test suite, and running one
against it proves nothing: check it against the canonical documents it must
not contradict, and stop.

Review once, when the work is coherent. Repeated self-audit of your own output
finds progressively less and costs the same each time; a second opinion is
worth more than a third reading. If a check fails for a reason outside the
work — a missing host path, an absent service — say so plainly and move on
rather than debugging the environment.

Report honestly what you built, what you decided and why, and anything in the
canonical documents that turned out to be wrong or unbuildable.
