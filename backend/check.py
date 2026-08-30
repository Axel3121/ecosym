"""Ordinary backend check: deterministic tests, then live-source verification."""

from __future__ import annotations

import unittest
from pathlib import Path

import connected_sources


def main() -> int:
    tests = unittest.defaultTestLoader.discover(Path(__file__).parent / "tests")
    result = unittest.TextTestRunner(verbosity=2).run(tests)
    if not result.wasSuccessful():
        return 1
    return connected_sources.main(["verify"])


if __name__ == "__main__":
    raise SystemExit(main())
