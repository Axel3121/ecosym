# Findings on the sandbox source boundary and the guard sweep

These are review findings, not instructions. They were written into two task
specifications while those still lived in `docs/tasks/`, and would have been
lost when that directory left the repository — the specifications moved to the
external specification root, but a finding is evidence a reader can act on and
belongs here.

Both findings concern work that is specified but not yet delivered. They are
recorded so the next run does not have to rediscover them, and so a reviewer
can check the delivered work against them.

## The source boundary is coarser than the thing it protects

`prepareSandboxSources` marks a source's whole containing directory read-only
(`src/sandbox.ts`, `dirname(destination)`), not the source file.

The consequence is a silent one: a file that merely happens to sit next to a
registered source — same directory, not itself a source — loses write access.
Nothing in the sandbox tests covers that case, so every listed requirement can
pass while the requirement that "nothing legitimately writable loses it" is
false.

What settles it is a sibling-file case: create a file beside a registered
source, confirm it stays writable, and report the result alongside the
registered and unregistered cases. Whether the fix narrows the granularity or
accepts the directory-level boundary is an implementation choice; the choice
has to be stated and justified either way, because accepting it means
accepting that neighbours of a source are read-only.

A second gap in the same area: `src/readers.ts` supports four source types
(`sqlite`, `jsonl`, `json`, `csv` — read the `case` arms rather than trusting
this list). A test that registers only SQLite passes while the other three stay
writable. Either cover every type, or show that the shared mechanism protecting
them is reached for each.

## A mutation sweep has no completeness criterion, and should not

An open-ended sweep across a module is discovery. A quota turns it into
theatre: mutations get chosen because they will die, and the number stops
meaning anything.

What is reportable instead is the record of what was actually done — how
mutations were selected, how many ran per module, and the surviving count
against the run count. A reviewer judges the sweep by that record. Claims of
thoroughness are not evidence and should not be treated as any.

This applies only to the open-ended part. Named guards are a different thing:
they are pass/fail, and each one is proven by removing it, showing the suite
goes red, restoring it, and showing the suite goes green.

## Why this file exists

`DEVELOPMENT.md` distinguishes instructions from evidence: task specifications
live outside the repository, findings and evidence produced by the work stay
in it. When `docs/tasks/` was removed, that split was not made — the whole
directory was deleted and these findings went with it, recoverable only from
Git history and from copies outside the repository.

They are restored here as evidence. If a later run resolves either finding,
the resolution belongs in the same place: in-tree, next to the code it
describes.
