# Changelog fragments

A change to Pathfinder records its release note here, as one new file, instead
of editing `CHANGELOG.md`. Two pull requests in flight at once then add two
different files, so neither has to resolve a conflict in the other's hunk of
`[Unreleased]`.

- **One fragment per change**, named by its ticket key or its branch slug:
  `changelog.d/59.1.md`, `changelog.d/fix-release-notes.md`. Lowercase letters
  and digits joined by dots or hyphens, ending in `.md`.
- **The bullet text exactly as it should appear under `[Unreleased]`**: one or
  more `- ` bullets, continuation lines indented two spaces, the same flat
  format the changelog already uses. No heading, no front matter.
- **Do not edit `CHANGELOG.md` in the pull request.** The fragment is the
  release note.

While a release is being cut, `python3 .github/scripts/assemble-changelog.py`
appends every fragment, in filename order, to `[Unreleased]`'s bullet list and
deletes the fragments. It checks every fragment first and changes nothing if
any is badly named, empty, not bullets, or a duplicate of another fragment or
of a bullet already there. This README is never assembled.

This directory belongs to Pathfinder's own repository. It is not part of the
kit, and no destination project receives it.
