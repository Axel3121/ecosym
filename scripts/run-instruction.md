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

Report honestly what you built, what you decided and why, and anything in the
canonical documents that turned out to be wrong or unbuildable.
