#!/usr/bin/env python3
"""Structural validation for the Pathfinder kit.

Run locally with:

    python3 .github/scripts/validate-kit.py

Exits 0 if every rule passes, 1 otherwise. Every failure names the offending
file and the rule it broke, because the audience is a solo maintainer coming
back to this weeks later.

Deliberately dependency-free. NOT_A_FRAMEWORK.md promises the kit has no
runtime and no package manager, so this uses only the standard library and
adds no manifest at the repository root. That includes PyYAML: skill
frontmatter is a flat block of `key: value` lines, so it is parsed here
directly rather than pulling in a dependency to read six lines of text.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILLS = ROOT / "skills"
PROMPTS = ROOT / "prompts"

failures: list[str] = []


def fail(path: Path | str, rule: str, detail: str) -> None:
    where = path if isinstance(path, str) else path.relative_to(ROOT)
    failures.append(f"{where}: [{rule}] {detail}")


def parse_frontmatter(path: Path) -> dict[str, str] | None:
    """Return the frontmatter mapping, or None if the block is malformed.

    Malformed frontmatter is the bug this whole script exists to catch: two
    skills have shipped with a block that opened with a blank line or closed
    with a dashed rule instead of `---`, which made them undiscoverable.
    """
    lines = path.read_text(encoding="utf-8").splitlines()

    if not lines or lines[0].rstrip() != "---":
        fail(path, "frontmatter-open", "line 1 must be exactly `---`")
        return None

    close = next((i for i, ln in enumerate(lines[1:], start=1)
                  if ln.rstrip() == "---"), None)
    if close is None:
        fail(path, "frontmatter-close",
             "no closing `---` found (a dashed rule such as `----` does not count)")
        return None

    data: dict[str, str] = {}
    for offset, line in enumerate(lines[1:close], start=2):
        if not line.strip():
            continue
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not match:
            fail(path, "frontmatter-syntax",
                 f"line {offset} is not a `key: value` pair: {line!r}")
            return None
        data[match.group(1)] = match.group(2).strip()
    return data


def check_skills() -> set[str]:
    """Validate every skill directory. Returns the set of skill names found."""
    names: set[str] = set()
    directories = sorted(d for d in SKILLS.iterdir() if d.is_dir())

    if not directories:
        fail("skills/", "skills-present", "no skill directories found")
        return names

    for directory in directories:
        skill_file = directory / "SKILL.md"
        if not skill_file.is_file():
            fail(f"skills/{directory.name}/", "skill-file-present",
                 "directory has no SKILL.md")
            continue

        names.add(directory.name)
        data = parse_frontmatter(skill_file)
        if data is None:
            continue

        for key in ("name", "description"):
            if not data.get(key):
                fail(skill_file, "frontmatter-field",
                     f"`{key}` is missing or empty")

        declared = data.get("name")
        if declared and declared != directory.name:
            fail(skill_file, "name-matches-directory",
                 f"name is `{declared}` but the directory is `{directory.name}`")

    return names


def check_prompts(skill_names: set[str]) -> None:
    """Every skill needs a launcher; every launcher must point at a real skill.

    Matched on content rather than filename: several launchers are named for
    the task instead of the skill, for example prompts/01-kickstart-project.md
    launches kickstart-pathfinder.
    """
    prompts = sorted(PROMPTS.glob("*.md"))
    if not prompts:
        fail("prompts/", "prompts-present", "no prompt files found")
        return

    referenced: set[str] = set()
    for prompt in prompts:
        text = prompt.read_text(encoding="utf-8")
        hits = {name for name in skill_names
                if re.search(rf"\b{re.escape(name)}\b", text)}
        if not hits:
            fail(prompt, "launcher-references-skill",
                 "does not reference any existing skill by name")
        referenced |= hits

    for orphan in sorted(skill_names - referenced):
        fail(f"skills/{orphan}/", "skill-has-launcher",
             f"no file in prompts/ references `{orphan}`")


def check_claude_md(skill_names: set[str]) -> None:
    """CLAUDE.md's Available skills list must match the skills directory."""
    path = ROOT / "CLAUDE.md"
    text = path.read_text(encoding="utf-8")

    match = re.search(r"^## Available skills\s*$(.*)", text,
                      re.MULTILINE | re.DOTALL)
    if not match:
        fail(path, "available-skills-section",
             "no `## Available skills` section found")
        return

    section = re.split(r"^## ", match.group(1), maxsplit=1, flags=re.MULTILINE)[0]
    listed = set(re.findall(r"^-\s+`([a-z0-9-]+)`", section, re.MULTILINE))

    for missing in sorted(skill_names - listed):
        fail(path, "available-skills-match",
             f"`{missing}` exists in skills/ but is not listed")
    for extra in sorted(listed - skill_names):
        fail(path, "available-skills-match",
             f"`{extra}` is listed but has no directory in skills/")


def check_changelog() -> None:
    """The most recent tag must have a CHANGELOG entry.

    Skipped when there are no tags, or when tags are unavailable — a shallow
    CI clone has no tags, and a fresh branch legitimately has no new tag.
    """
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
    except OSError:
        print("note: git unavailable, skipping changelog-has-tag")
        return

    tag = result.stdout.strip()
    if result.returncode != 0 or not tag:
        print("note: no tags found, skipping changelog-has-tag")
        return

    version = tag.lstrip("v")
    changelog = ROOT / "CHANGELOG.md"
    if f"[{version}]" not in changelog.read_text(encoding="utf-8"):
        fail(changelog, "changelog-has-tag",
             f"most recent tag {tag} has no `[{version}]` entry")


def main() -> int:
    skill_names = check_skills()
    check_prompts(skill_names)
    check_claude_md(skill_names)
    check_changelog()

    if failures:
        print(f"\nFAIL — {len(failures)} problem(s):\n")
        for failure in failures:
            print(f"  {failure}")
        print()
        return 1

    print(f"OK — {len(skill_names)} skills validated, all rules passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
