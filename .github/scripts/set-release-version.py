#!/usr/bin/env python3
"""Derive the release version from CHANGELOG.md.

The newest released section heading in CHANGELOG.md is the single source of
truth for the release version. This copies it into every manifest that has to
carry it — the installer's package.json and the plugin's plugin.json — so the
number is never typed twice.

    python3 .github/scripts/set-release-version.py            # write it
    python3 .github/scripts/set-release-version.py --check    # report only

Run this while cutting a release, before the release commit is made and
tagged. It is deliberately not wired into `npm publish`: the version has to be
inside the commit that gets tagged, and mutating a manifest during a publish
would put the value somewhere nobody can inspect before it becomes permanent.

Only the `version` line is rewritten, in place, so each manifest keeps its
formatting and key order exactly.

Dependency-free, like validate-kit.py, and for the same reason.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHANGELOG = ROOT / "CHANGELOG.md"
MANIFEST = ROOT / "packages" / "create-pathfinder" / "package.json"
PLUGIN_MANIFEST = ROOT / ".claude-plugin" / "plugin.json"

# Every manifest carrying the release number, with the name used to talk about
# it. One release number, one changelog, this many files. Adding a third
# manifest is a line here and nothing else.
MANIFESTS: tuple[tuple[str, Path], ...] = (
    ("create-pathfinder", MANIFEST),
    ("the pathfinder plugin", PLUGIN_MANIFEST),
)

# package.json carries this until the first npm publication. It is not a
# version; it is a marker meaning "never released", and the publish guard
# refuses to publish it.
SENTINEL = "0.0.0"


def released_version() -> str | None:
    """The newest `## [X.Y.Z]` heading. `[Unreleased]` is not one."""
    for match in re.finditer(r"^## \[(\d+\.\d+\.\d+)\]",
                             CHANGELOG.read_text(encoding="utf-8"), re.MULTILINE):
        return match.group(1)
    return None


VERSION_LINE = re.compile(r'^(\s*"version":\s*")([^"]*)(")', re.MULTILINE)


def manifest_version(path: Path = MANIFEST) -> str | None:
    match = VERSION_LINE.search(path.read_text(encoding="utf-8"))
    return match.group(2) if match else None


def write_manifest_version(version: str, path: Path = MANIFEST) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = VERSION_LINE.subn(
        lambda m: m.group(1) + version + m.group(3), text, count=1)
    if count != 1:
        sys.exit(f"{path}: no `version` field to rewrite")
    path.write_text(updated, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="report agreement without writing")
    args = parser.parse_args()

    target = released_version()
    if target is None:
        print("No released version in CHANGELOG.md — nothing to derive from.")
        print("Add a `## [X.Y.Z] - DATE` section for the release first.")
        return 1

    # Read every manifest before writing any of them, so a missing `version`
    # field in the second one does not leave the first one rewritten.
    current: dict[Path, str] = {}
    for label, path in MANIFESTS:
        try:
            found = manifest_version(path)
        except OSError as error:
            print(f"{path}: could not be read: {error}")
            return 1
        if found is None:
            print(f"{path}: no `version` field found")
            return 1
        current[path] = found

    if all(version == target for version in current.values()):
        print(f"Every manifest is already at {target}, matching CHANGELOG.md.")
        return 0

    if args.check:
        for label, path in MANIFESTS:
            version = current[path]
            if version == target:
                print(f"{label} is already at {target}.")
            elif version == SENTINEL:
                # The sentinel is not drift, so it does not get drift's
                # wording. It is still a non-zero exit: nothing agrees yet, and
                # a release script calling --check should stop and derive the
                # version first.
                print(f"{label} has never been released ({SENTINEL}). "
                      f"The newest release in CHANGELOG.md is {target}.")
            else:
                print(f"MISMATCH — CHANGELOG.md says {target}, "
                      f"{path.name} says {version}.")
        print("Run this without --check while cutting a release.")
        return 1

    for label, path in MANIFESTS:
        version = current[path]
        if version == target:
            print(f"{label} is already at {target}.")
            continue
        write_manifest_version(target, path)
        moved_from = (f"{version} (the never-released sentinel)"
                      if version == SENTINEL else version)
        print(f"{label} {moved_from} -> {target}, from CHANGELOG.md.")

    print("Commit this with the release, then tag that commit "
          f"`v{target}`.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
