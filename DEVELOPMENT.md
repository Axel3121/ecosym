# Development

The v1 development flow. Nothing beyond this is in place, and nothing beyond
this should be added until this flow proves insufficient.

## INPUT

- repo
- issues
- current main
- canonical product/architecture docs

## SUPERVISOR

- choose one coherent outcome
- decide whether multiple issues belong together
- stop only for a genuine human decision

## EXECUTION

- Herdr creates an isolated worktree
- Claude or Codex becomes the writer
- writer implements, tests and commits

## REVIEW

- use the other model
- reviewer is read-only
- review the exact commit
- findings return to the same writer
- repeat until PASS

## PUBLICATION

- verify main/head
- push one finished branch
- Ready PR
- CI

## STOP

- present the PR
- Axel decides whether to merge
