#!/usr/bin/env python3
"""Prove the check.yml gate tests catch the two bugs that shipped.

Green tests are not the gate; mutation is. Each mutation below restores a
defect that was live in main, and must turn a NAMED test red.
"""
import pathlib
import re
import subprocess
import sys

WORKFLOW = pathlib.Path(".github/workflows/check.yml")
TEST = ["node", "--test", "--test-reporter=tap", "test/check-workflow.test.ts"]

MUTATIONS = [
    (
        "skip-total read from the wrong TAP key (the bug that shipped)",
        "skipped=$(awk '/^# skipped [0-9]+$/ { s=$3 } END { print s + 0 }' tap.txt)",
        "skipped=$(awk '/^# skip [0-9]+$/ { s=$3 } END { print s + 0 }' tap.txt)",
    ),
    (
        "failure diagnostics discarded — the log says a count and nothing else",
        '            grep -E "^ *not ok " tap.txt >&2 || true\n            cat tap.txt\n',
        "",
    ),
    (
        "the skipped summary line is no longer required to be present",
        "for field in pass fail cancelled skipped; do",
        "for field in pass fail cancelled; do",
    ),
    (
        # The hole that shipped in the first version of this gate: a skip
        # anywhere excused a non-zero runner status. Measured on node v24.19.0
        # (what .nvmrc pins), a skipped test exits 0, so the excuse never had
        # a real case -- it only ever waved crashes through.
        "a skip excuses a crashed runner again",
        'if [ "$status" -ne 0 ]; then',
        'if [ "$status" -ne 0 ] && [ "$skipped" -eq 0 ]; then',
    ),
]


def failing_tests(output: str) -> set[str]:
    return {
        match.group(1).strip()
        for match in re.finditer(r"^not ok \d+ - (.+)$", output, re.MULTILINE)
    }


def run() -> tuple[int, set[str]]:
    result = subprocess.run(TEST, capture_output=True, text=True)
    return result.returncode, failing_tests(result.stdout)


original = WORKFLOW.read_text()
status, failures = run()
if status != 0:
    print(f"baseline is already red: {sorted(failures)}", file=sys.stderr)
    sys.exit(1)
print("baseline green")

survivors = []
try:
    for name, present, replacement in MUTATIONS:
        if present not in original:
            print(f"SKIPPED (text not found): {name}", file=sys.stderr)
            survivors.append(name)
            continue
        WORKFLOW.write_text(original.replace(present, replacement, 1))
        status, failures = run()
        if status == 0:
            print(f"SURVIVED: {name}")
            survivors.append(name)
        elif not failures:
            # A non-zero exit is not proof on its own. If the runner dies
            # before it emits a single `not ok` -- a syntax error, a missing
            # binary, an unparseable workflow -- then every mutation looks
            # "caught" and this harness certifies tests that never ran.
            # That is the exact failure the gate under test exists to stop,
            # so accepting it here would be the same bug one level up.
            print(f"UNPROVEN: {name} -- suite exited {status} with no "
                  f"'not ok' record; no named test refused the mutation")
            survivors.append(name)
        else:
            print(f"caught:   {name}")
            for failure in sorted(failures):
                print(f"            -> {failure}")
finally:
    WORKFLOW.write_text(original)

status, failures = run()
if status != 0:
    print(f"restore failed, suite still red: {sorted(failures)}", file=sys.stderr)
    sys.exit(1)
print("restored, green")

if survivors:
    print(f"\n{len(survivors)} mutation(s) survived: {survivors}", file=sys.stderr)
    sys.exit(1)
print(f"\nall {len(MUTATIONS)} mutations caught")
