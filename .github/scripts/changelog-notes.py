#!/usr/bin/env python3
"""Print one release's CHANGELOG.md section, verbatim, for GitHub Release notes.

    python3 .github/scripts/changelog-notes.py 1.7.0

The v1.7.0 release notes were copied by hand and then diffed against the
changelog afterwards to prove they matched. That check only works because the
diff was run; the release before it had no such evidence. Extracting the section
mechanically makes the two agree by construction, so there is nothing left to
verify by eye.

Verbatim means verbatim: the section body is emitted exactly as written,
including its Markdown, its emphasis, and its links. The heading itself is
dropped — GitHub already titles the release — and surrounding blank lines are
trimmed. Nothing else is rewritten.

Exits non-zero if the version has no released section, which is what stops the
release workflow from creating a Release with empty or wrong notes.

Dependency-free, like the other scripts here, and for the same reason.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHANGELOG = ROOT / "CHANGELOG.md"


def section(version: str, text: str) -> str | None:
    """The body under `## [version]`, up to the next `## ` heading."""
    start = re.search(rf"^## \[{re.escape(version)}\][^\n]*\n", text, re.MULTILINE)
    if start is None:
        return None

    rest = text[start.end():]
    end = re.search(r"^## ", rest, re.MULTILINE)
    return (rest if end is None else rest[:end.start()]).strip("\n")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2

    version = argv[1].lstrip("v")

    # `[Unreleased]` is a heading of the same shape and is not a release. Left
    # unchecked, a mistyped argument would happily emit the pending section as
    # if it were shipped.
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        print(f"'{argv[1]}' is not a MAJOR.MINOR.PATCH version.", file=sys.stderr)
        return 2

    body = section(version, CHANGELOG.read_text(encoding="utf-8"))

    if body is None:
        print(f"CHANGELOG.md has no `## [{version}]` section.", file=sys.stderr)
        print("The changelog is the source of truth for a release; if this "
              "version is real, it belongs there.", file=sys.stderr)
        return 1

    if not body.strip():
        print(f"CHANGELOG.md's `## [{version}]` section is empty.", file=sys.stderr)
        print("A release with no notes says nothing about what changed.",
              file=sys.stderr)
        return 1

    print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
