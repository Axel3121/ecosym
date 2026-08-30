Implement the attached task specification in full.

It is large by design — work through it properly rather than quickly. There is
no prize for finishing early, and a half-built mechanism is worse than none.

Commit each coherent piece as you go rather than once at the end: a run can be
interrupted, and committed work survives.

Delegate rather than doing everything inline. `scout` gathers facts — schemas,
file listings, where something is defined — and is fast and cheap. `review`
finds blocking defects before a trust-bearing commit. `critic` judges whether
the code is well made, once it works.

Report honestly what you built, what you decided and why, and anything in the
canonical documents that turned out to be wrong or unbuildable.
