#!/usr/bin/env python3
"""Fold changelog.d/ fragments into CHANGELOG.md's `[Unreleased]` section.

    python3 .github/scripts/assemble-changelog.py

A change records its release note as one new file, `changelog.d/<key>.md`,
instead of editing `CHANGELOG.md`. Two tickets in flight at once then add two
different files and never touch the same hunk, so merging the second one is
not a conflict. This script is the other half: run first while cutting a
release, it appends every fragment to `[Unreleased]` and removes the fragments.

Where the text goes: after the last bullet of the flat list that opens
`[Unreleased]`, before its first `### ` subsection when it has one, otherwise
at the end of the section. A fresh `[Unreleased]` has no subsection, so after a
release that is simply its end. Fragments go in filename order, each one's text
exactly as written, one bullet list with the bullets already there. Nothing
that is already in the changelog is moved or rewritten.

Every fragment is checked before anything is written. The script exits 1,
names each offending file, and changes nothing — neither `CHANGELOG.md` nor
`changelog.d/` — when:

- two fragments have the same text, or a fragment's text is already in
  `[Unreleased]`;
- a filename is not a lowercase ticket key or branch slug ending in `.md`
  (`59.1.md`, `fix-release-notes.md`); `README.md` is the one exception and is
  never assembled;
- a fragment is empty, only whitespace, or not one or more `- ` bullets.

No fragment is a no-op that exits 0, so a second run after a successful one
does nothing. `--root` points it at another checkout, which is how the tests
run it.

Dependency-free, like the other scripts here, and for the same reason.
"""

from __future__ import annotations

import argparse
import os
import re
import stat
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
README = "README.md"

# A ticket key (`59.1`) or a branch slug (`fix-release-notes`): lowercase
# letters and digits, joined by single dots or hyphens.
NAME = re.compile(r"[a-z0-9]+(?:[.-][a-z0-9]+)*\.md")
UNRELEASED = re.compile(r"^## \[Unreleased\][^\n]*(?:\n|\Z)", re.MULTILINE)
NEXT_SECTION = re.compile(r"^## ", re.MULTILINE)
SUBSECTION = re.compile(r"^### ", re.MULTILINE)


class Refusal(Exception):
    """Every problem found, one line each. Nothing has been written."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("\n".join(problems))
        self.problems = problems


def fragment_text(raw: str) -> str:
    """The fragment as it will appear: its text with outer blank lines trimmed."""
    lines = raw.splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)


def bullets(text: str) -> list[str | None]:
    """`text` as its `- ` bullets, each with its continuation lines.

    Blank lines between bullets are not part of either. Any other line — a
    `### ` heading, a paragraph — becomes None, so a run of bullets is never
    matched across it.
    """
    items: list[str | None] = []
    current: list[str] | None = None
    for line in text.splitlines():
        if line.startswith("- "):
            current = [line.rstrip()]
            items.append(None)
        elif line.strip() and line[0] in " \t" and current is not None:
            current.append(line.rstrip())
        elif not line.strip():
            continue
        else:
            current = None
            items.append(None)
            continue
        items[-1] = "\n".join(current)
    return items


def contains_run(haystack: list[str | None], run: list[str | None]) -> bool:
    width = len(run)
    return any(haystack[i:i + width] == run
               for i in range(len(haystack) - width + 1))


def bullet_problem(text: str) -> str | None:
    """Why `text` is not one or more `- ` bullets, or None when it is.

    A bullet starts at column 0 with `- `. A line after it is either another
    bullet, an indented continuation, or blank. Anything else — a heading,
    unindented prose, a `*` bullet — is not the changelog's format.
    """
    if not text:
        return "is empty or only whitespace"
    lines = text.split("\n")
    if not lines[0].startswith("- ") or not lines[0][2:].strip():
        return "does not start with a `- ` bullet"
    for number, line in enumerate(lines[1:], start=2):
        if not line or line.startswith("- ") or line[0] in " \t":
            if line.startswith("- ") and not line[2:].strip():
                return f"line {number} is an empty bullet"
            continue
        return f"line {number} is neither a `- ` bullet nor an indented continuation"
    return None


def unreleased_bounds(changelog: str) -> tuple[int, int, int] | None:
    """(body start, insertion end, section end) of `[Unreleased]`, or None."""
    heading = UNRELEASED.search(changelog)
    if heading is None:
        return None
    start = heading.end()
    following = NEXT_SECTION.search(changelog, start)
    end = len(changelog) if following is None else following.start()
    subsection = SUBSECTION.search(changelog, start, end)
    insert = end if subsection is None else subsection.start()
    return start, insert, end


def read_fragments(directory: Path, unreleased: str) -> list[tuple[Path, str]]:
    """Every fragment in filename order, validated; raises Refusal on any problem."""
    problems: list[str] = []
    fragments: list[tuple[Path, str]] = []
    for path in sorted(directory.iterdir(), key=lambda p: p.name):
        if path.name == README:
            continue
        label = f"changelog.d/{path.name}"
        if not path.is_file():
            problems.append(f"{label}: not a file; changelog.d/ holds only fragments")
            continue
        if not NAME.fullmatch(path.name):
            problems.append(
                f"{label}: not a lowercase `<ticket-key-or-branch-slug>.md` name")
            continue
        try:
            with path.open(encoding="utf-8", newline="") as handle:
                text = fragment_text(handle.read())
        except (OSError, UnicodeDecodeError) as error:
            problems.append(f"{label}: could not be read as UTF-8: {error}")
            continue
        problem = bullet_problem(text)
        if problem is not None:
            problems.append(f"{label}: {problem}")
            continue
        fragments.append((path, text))

    # Compared bullet by bullet, ignoring trailing spaces and the blank lines
    # between bullets, so a reformatted copy is still a copy and a bullet that
    # merely begins like an existing one is not.
    existing = bullets(unreleased)
    seen: dict[tuple[str | None, ...], Path] = {}
    for path, text in fragments:
        label = f"changelog.d/{path.name}"
        items = bullets(text)
        key = tuple(items)
        if key in seen:
            problems.append(
                f"{label}: same text as changelog.d/{seen[key].name}")
        else:
            seen[key] = path
        if contains_run(existing, items):
            problems.append(f"{label}: its text is already in [Unreleased]")

    if problems:
        raise Refusal(problems)
    return fragments


def assemble(changelog: str, texts: list[str]) -> str:
    """`changelog` with `texts` appended to `[Unreleased]`'s opening bullet list."""
    bounds = unreleased_bounds(changelog)
    if bounds is None:
        raise ValueError("CHANGELOG.md has no `## [Unreleased]` section")
    start, insert, _ = bounds
    region = changelog[start:insert]
    core = region.rstrip("\n")
    tail = region[len(core):]
    block = "\n".join(texts)
    if not core.strip():
        # Nothing in front of the insertion point but blank lines: a fresh
        # section, or one that opens straight into a subsection.
        follows = insert < len(changelog)
        region = "\n" + block + "\n" + ("\n" if follows else "")
    else:
        region = core + "\n" + block + (tail if tail else "\n")
    return changelog[:start] + region + changelog[insert:]


def write_atomically(path: Path, text: str) -> None:
    """Replace `path` whole, keeping its mode, so a failed write changes nothing."""
    mode = stat.S_IMODE(path.stat().st_mode)
    descriptor, temporary = tempfile.mkstemp(prefix=".changelog-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def run(root: Path) -> int:
    directory = root / "changelog.d"
    changelog_path = root / "CHANGELOG.md"

    if not directory.is_dir():
        print("No changelog.d/ — nothing to assemble.")
        return 0
    if not any(path.name != README for path in directory.iterdir()):
        print("No fragments in changelog.d/ — nothing to assemble.")
        return 0

    try:
        with changelog_path.open(encoding="utf-8", newline="") as handle:
            changelog = handle.read()
    except OSError as error:
        print(f"CHANGELOG.md could not be read: {error}", file=sys.stderr)
        return 1
    bounds = unreleased_bounds(changelog)
    if bounds is None:
        print("CHANGELOG.md has no `## [Unreleased]` section to assemble into.",
              file=sys.stderr)
        return 1

    try:
        fragments = read_fragments(directory, changelog[bounds[0]:bounds[2]])
    except Refusal as refusal:
        print("Refusing to assemble; nothing was changed:", file=sys.stderr)
        for problem in refusal.problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    write_atomically(changelog_path, assemble(changelog, [t for _, t in fragments]))
    for path, _ in fragments:
        path.unlink()
        print(f"assembled changelog.d/{path.name}")
    print(f"{len(fragments)} fragment(s) added to [Unreleased] in CHANGELOG.md.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Fold changelog.d/ fragments into CHANGELOG.md [Unreleased].")
    parser.add_argument("--root", type=Path, default=ROOT,
                        help="checkout to assemble (default: this repository)")
    args = parser.parse_args(argv)
    return run(args.root)


if __name__ == "__main__":
    sys.exit(main())
