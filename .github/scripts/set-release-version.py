#!/usr/bin/env python3
"""Derive the installer's version from CHANGELOG.md.

The newest released section heading in CHANGELOG.md is the single source of
truth for the release version. This copies it into the installer's
package.json, so the number is never typed twice.

    python3 .github/scripts/set-release-version.py            # write it
    python3 .github/scripts/set-release-version.py --check    # report only

Run this while cutting a release, before the release commit is made and
tagged. It is deliberately not wired into `npm publish`: the version has to be
inside the commit that gets tagged, and mutating a manifest during a publish
would put the value somewhere nobody can inspect before it becomes permanent.

Only the `version` line is rewritten, in place, so the rest of package.json
keeps its formatting and key order exactly.

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


def manifest_version() -> str | None:
    match = re.search(r'^(\s*"version":\s*")([^"]*)(")',
                      MANIFEST.read_text(encoding="utf-8"), re.MULTILINE)
    return match.group(2) if match else None


def write_manifest_version(version: str) -> None:
    text = MANIFEST.read_text(encoding="utf-8")
    updated, count = re.subn(r'^(\s*"version":\s*")([^"]*)(")',
                             lambda m: m.group(1) + version + m.group(3),
                             text, count=1, flags=re.MULTILINE)
    if count != 1:
        sys.exit(f"{MANIFEST}: no `version` field to rewrite")
    MANIFEST.write_text(updated, encoding="utf-8")


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

    current = manifest_version()
    if current is None:
        print(f"{MANIFEST}: no `version` field found")
        return 1

    if current == target:
        print(f"create-pathfinder is already at {target}, matching CHANGELOG.md.")
        return 0

    if args.check:
        # The sentinel is not drift, so it does not get drift's wording. It is
        # still a non-zero exit: nothing agrees yet, and a release script
        # calling --check should stop and derive the version first.
        if current == SENTINEL:
            print(f"create-pathfinder has never been released ({SENTINEL}). "
                  f"The newest release in CHANGELOG.md is {target}.")
            print("Run this without --check while cutting a release.")
        else:
            print(f"MISMATCH — CHANGELOG.md says {target}, "
                  f"package.json says {current}.")
        return 1

    write_manifest_version(target)
    moved_from = f"{current} (the never-released sentinel)" if current == SENTINEL else current
    print(f"create-pathfinder {moved_from} -> {target}, from CHANGELOG.md.")
    print("Commit this with the release, then tag that commit "
          f"`v{target}`.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
