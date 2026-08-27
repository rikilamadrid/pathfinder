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

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILLS = ROOT / "skills"
ROLES = ROOT / "roles"
INSTALLER = ROOT / "packages" / "create-pathfinder"

# The plugin's own root. `.claude-plugin/` holds the two manifests and nothing
# else: Claude Code reads a plugin's components — `skills/`, `agents/`,
# `hooks/` — from beside this directory, never inside it, so a component
# directory appearing here would be silently dead. The plugin's skills are the
# canonical `skills/` tree itself, which is why no `skills` override is
# allowed in the manifest: pointing it elsewhere would invite a second tree.
PLUGIN_DIR = ROOT / ".claude-plugin"
PLUGIN_MANIFEST = PLUGIN_DIR / "plugin.json"
MARKETPLACE_MANIFEST = PLUGIN_DIR / "marketplace.json"

# What the plugin manifest must carry, and what it must never carry. The
# forbidden list is not stylistic: every one of those fields is a permission or
# a process, and Pathfinder ships skills and nothing else. `skills` is
# forbidden for the separate reason above.
PLUGIN_REQUIRED_FIELDS = ("name", "description", "version", "author",
                          "homepage", "repository", "license", "keywords")
PLUGIN_FORBIDDEN_FIELDS = ("skills", "hooks", "mcpServers", "lspServers",
                           "agents", "bin", "monitors", "userConfig")

# The plugin name is the command namespace: every command is `/<name>:<skill>`
# and there is no opt-out, so this value is user-visible on every invocation.
PLUGIN_NAME = "pathfinder"

# The one harness whose adapters this repository commits. CONTRIBUTING.md states
# the scoping rule in prose; this is the same rule in the checker, so adding a
# second tracked adapter directory has to be a deliberate edit in both places.
ADAPTERS = ROOT / ".claude" / "skills"
ADAPTER_GENERATOR = INSTALLER / "scripts" / "generate-adapters.mjs"

# The marker that makes ownership decidable. Written by the installer's
# renderer; matched here so the validator and the installer cannot disagree
# about which files are generated.
ADAPTER_MARKER = re.compile(r"^<!--\s*pathfinder:adapter v(\d+)(?:\s+source=(\S+))?\s*-->$")

# An adapter is metadata plus a pointer. The real defense against behavior
# leaking into one is `adapter-is-thin` below; this ceiling is the cheap
# backstop that catches a body pasted in wholesale. The generated files are
# around 700 bytes, and the largest input is a long description.
ADAPTER_BYTE_CEILING = 4096

# Lines short enough to collide by coincidence. `---`, a blank line, and a bare
# heading word appear in both a skill and its adapter without meaning anything.
THIN_LINE_THRESHOLD = 40

# A role file states responsibility and constraint, never procedure. The
# ceiling is the crude backstop for that: the moment a role grows past a page
# it has started explaining how to do the work, which is what a skill is for.
# For calibration, skills/feature/actions/complete.md is 22 lines.
ROLE_LINE_CEILING = 40

# Lifecycle entry points assume one responsibility unless the human explicitly
# overrides it with `/role`. The paths are the contract: the `ticket` wrapper
# dispatches to actions whose responsibilities differ, so the action files —
# not the wrapper — carry its four mappings.
LIFECYCLE_ROLE_ASSUMPTIONS = {
    "skills/kickstart-pathfinder/SKILL.md": "planner",
    "skills/to-specs/SKILL.md": "planner",
    "skills/to-tickets/SKILL.md": "planner",
    "skills/ticket/actions/load.md": "developer",
    "skills/ticket/actions/start.md": "developer",
    "skills/ticket/actions/review.md": "tester",
    "skills/ticket/actions/complete.md": "developer",
}

# The one statement of what a destination project receives. Everything else
# that names the list — the README install section, npm's `files` allowlist,
# the installer at runtime — is checked against this file rather than against
# each other in a chain. Not restated here: a copy in the validator is just a
# fourth thing to drift.
CANONICAL_COPY_LIST = INSTALLER / "copy-list.json"

# Delimit the README's install section. Prose changes; these do not. The
# quickstart is due to become `npx create-pathfinder` instead of a `cp -R`
# line, and a rule anchored to the old wording would have started passing
# vacuously at exactly the moment the install path changed.
README_MARKERS = ("<!-- copy-list:start -->", "<!-- copy-list:end -->")

# What the installer's package.json carries until the first npm publication.
# Not a version — a marker meaning "never released".
VERSION_SENTINEL = "0.0.0"

# The release workflow, by exact path. npm's trusted publisher for
# `create-pathfinder` is configured against this *filename*: renaming the file
# does not fail anything locally, it just makes every future publish reject the
# OIDC token with an error that says nothing about a rename.
RELEASE_WORKFLOW = ROOT / ".github" / "workflows" / "release.yml"

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


def adapter_files() -> dict[str, Path]:
    """The committed adapters, by skill name."""
    if not ADAPTERS.is_dir():
        return {}
    return {d.name: d / "SKILL.md" for d in sorted(ADAPTERS.iterdir()) if d.is_dir()}


def read_tree(root: Path) -> dict[str, bytes]:
    """Every file under `root`, keyed by its path relative to it."""
    if not root.is_dir():
        return {}
    return {
        str(path.relative_to(root).as_posix()): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def check_adapters(skill_names: set[str]) -> None:
    """Validate this repository's committed Claude Code adapters.

    Pathfinder commits harness adapters only for the harness its own maintainers
    use, and these are generated files: the point of checking them is that a
    generated file in version control is only tolerable while something proves
    it still matches its source.

    The rules split deliberately. Everything below reads the committed files
    directly and needs nothing but Python — so a broken adapter is named even
    where Node is unavailable. Freshness and determinism need the real renderer
    and are checked by running it, in `check_adapter_generation`, because
    re-implementing the renderer here would create the second source of truth
    the whole adapter design exists to avoid.

    `adapter-no-orphans` below is also the successor to the retired
    `check_prompts` rule. That rule enforced "every skill has some way to invoke
    it" by requiring a launcher in `prompts/`; when `prompts/` was removed in
    favour of native harness invocation, the invariant did not go away, it moved:

        Every canonical Pathfinder skill must have the expected generated
        adapter for each registered native harness the repository configuration
        requires.

    A skill added without an adapter is therefore still caught by name — the
    same class of failure the launcher rule existed to prevent.
    """
    adapters = adapter_files()

    # `adapter-no-orphans`: the committed set is exactly the canonical set. A
    # skill added or removed without regenerating fails here by name, which is
    # the failure a maintainer is most likely to cause.
    for missing in sorted(skill_names - adapters.keys()):
        fail(f".claude/skills/{missing}/SKILL.md", "adapter-no-orphans",
             f"`{missing}` exists in skills/ but has no committed adapter; "
             "run packages/create-pathfinder/scripts/generate-adapters.mjs")
    for extra in sorted(adapters.keys() - skill_names):
        fail(f".claude/skills/{extra}/SKILL.md", "adapter-no-orphans",
             f"adapter for `{extra}`, which is not a skill in skills/")

    for name, path in adapters.items():
        if not path.is_file():
            fail(f".claude/skills/{name}/", "adapter-file-present",
                 "directory has no SKILL.md")
            continue

        text = path.read_text(encoding="utf-8")

        # `adapter-marker`: ownership is decided by the marker and nothing else.
        # An adapter without one is a file the installer would refuse to
        # regenerate — it would report it as a conflict in this very repository.
        marker = next((m for m in (ADAPTER_MARKER.match(ln.strip())
                                   for ln in text.splitlines()) if m), None)
        if marker is None:
            fail(path, "adapter-marker",
                 "no `pathfinder:adapter` marker; the installer would treat "
                 "this as a user-authored file and never regenerate it")
            continue

        # `adapter-target-exists`: the pointer has to point somewhere.
        source = marker.group(2)
        if not source:
            fail(path, "adapter-target-exists", "marker names no source file")
        elif not (ROOT / source).is_file():
            fail(path, "adapter-target-exists",
                 f"delegates to `{source}`, which does not exist")

        canonical = SKILLS / name / "SKILL.md"
        if not canonical.is_file():
            continue

        check_adapter_metadata(path, canonical, name)
        check_adapter_is_thin(path, text, canonical)


def check_adapter_metadata(path: Path, canonical: Path, name: str) -> None:
    """`adapter-metadata-matches`: verbatim, or not at all.

    An adapter carries the canonical `name`, `description`, and `argument-hint`
    unchanged. Re-wording or truncating a description is the quiet failure this
    catches: the skill still works when invoked, but the tool's own listing
    describes it differently from the file that defines it.
    """
    adapter_data = parse_frontmatter(path)
    canonical_data = parse_frontmatter(canonical)
    if adapter_data is None or canonical_data is None:
        return

    for key in ("name", "description", "argument-hint"):
        want = canonical_data.get(key)
        got = adapter_data.get(key)
        if want != got:
            fail(path, "adapter-metadata-matches",
                 f"`{key}` is {got!r} but skills/{name}/SKILL.md declares {want!r}")


def check_adapter_is_thin(path: Path, text: str, canonical: Path) -> None:
    """`adapter-is-thin`: no behavior may leak into an adapter.

    The architectural invariant, enforced mechanically rather than by
    discipline. A canonical skill is the single behavior contract; an adapter
    that reproduces even one substantive line of it has started to become a
    second one, and the two will drift.

    Compared line by line against the canonical body, ignoring anything short
    enough to collide by coincidence — `---`, blank lines, a bare heading word.

    Frontmatter is excluded from both sides, and that exclusion is the whole
    reason the two adapter rules do not contradict each other:
    `adapter-metadata-matches` *requires* the description line to be identical,
    so a rule that forbade repeated lines everywhere would fail on every
    correctly generated file. Metadata is copied on purpose; behavior is not.
    """
    size = len(text.encode("utf-8"))
    if size > ADAPTER_BYTE_CEILING:
        fail(path, "adapter-is-thin",
             f"{size} bytes exceeds the {ADAPTER_BYTE_CEILING}-byte ceiling; "
             "an adapter is metadata and a pointer, not content")

    body = strip_frontmatter(canonical.read_text(encoding="utf-8"))
    substantive = {ln.strip() for ln in body if len(ln.strip()) > THIN_LINE_THRESHOLD}
    for line in strip_frontmatter(text):
        stripped = line.strip()
        if stripped in substantive:
            fail(path, "adapter-is-thin",
                 f"reproduces a line of {canonical.relative_to(ROOT)}: {stripped[:60]!r}")
            return


def strip_frontmatter(text: str) -> list[str]:
    """The lines after the frontmatter block, or all of them if there is none.

    Tolerant on purpose: this is used by a rule that reports a problem, so a
    malformed block must not raise here. `parse_frontmatter` is the thing that
    reports malformed frontmatter, and it has already run by this point.
    """
    lines = text.splitlines()
    if not lines or lines[0].rstrip() != "---":
        return lines
    close = next((i for i, ln in enumerate(lines[1:], start=1)
                  if ln.rstrip() == "---"), None)
    return lines if close is None else lines[close + 1:]


def check_adapter_generation() -> None:
    """Run the real generator: `adapter-freshness` and `adapter-generation-deterministic`.

    Freshness asks the shipped generator whether the committed files are what it
    would write now. Determinism renders twice into scratch directories and
    compares bytes — the property that makes committing generated files
    tolerable at all, since without it every run would produce a diff.

    Skipped without Node, following the same convention as `copy-list-installer`:
    the pure-Python rules above still name a broken adapter, and CI has Node.
    """
    if not ADAPTER_GENERATOR.is_file():
        fail("packages/create-pathfinder/scripts/generate-adapters.mjs",
             "adapter-freshness", "the generator is missing")
        return

    def generate(*arguments: str) -> subprocess.CompletedProcess[str] | None:
        try:
            return subprocess.run(
                ["node", str(ADAPTER_GENERATOR), *arguments],
                cwd=ROOT, capture_output=True, text=True, check=False,
            )
        except OSError:
            return None

    result = generate("--check")
    if result is None:
        print("note: node unavailable, skipping adapter-freshness")
        return

    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or "generator failed"
        fail(".claude/skills/", "adapter-freshness",
             "committed adapters are not what the generator would write:\n    "
             + "\n    ".join(detail.splitlines()))

    with tempfile.TemporaryDirectory() as scratch:
        first, second = Path(scratch) / "a", Path(scratch) / "b"
        for out in (first, second):
            run = generate("--out", str(out))
            if run is None or run.returncode != 0:
                fail(".claude/skills/", "adapter-generation-deterministic",
                     "the generator failed to render into a scratch directory")
                return

        left, right = read_tree(first), read_tree(second)
        if left != right:
            differing = sorted(
                set(left) ^ set(right)
                | {name for name in set(left) & set(right) if left[name] != right[name]}
            )
            fail(".claude/skills/", "adapter-generation-deterministic",
                 "two runs produced different output: " + ", ".join(differing))


def released_version() -> str | None:
    """The newest `## [X.Y.Z]` heading in the changelog. `[Unreleased]` is not one."""
    for match in re.finditer(r"^## \[(\d+\.\d+\.\d+)\]",
                             (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"),
                             re.MULTILINE):
        return match.group(1)
    return None


def check_version_agreement() -> None:
    """The changelog, the installer manifest, and the release tag must agree.

    The installer mirrors the kit version exactly, so a drift here is
    user-visible: `npx create-pathfinder@1.3.0` would install something other
    than the v1.3.0 kit. The plugin manifest is the same promise on the other
    distribution path: `claude plugin update` hands users a new version only
    when that number changes, so a plugin left behind at the previous release
    is a release nobody receives.

    Both manifests are compared against the changelog rather than against each
    other. That is what makes a single drifted file produce a single failure
    naming it, instead of one failure per pair.

    Careful about when this is allowed to fail. Ordinary commits between
    releases must pass: work accumulates under `[Unreleased]` without a bump,
    so the manifest legitimately sits at the last released version. Only two
    things are checked — the manifest matches the newest *released* changelog
    section, and, when HEAD is a release commit, its tag matches too.
    """
    manifest_path = INSTALLER / "package.json"
    versions: dict[Path, str | None] = {}
    for path in (manifest_path, PLUGIN_MANIFEST):
        try:
            versions[path] = json.loads(path.read_text(encoding="utf-8")).get("version")
        except (OSError, json.JSONDecodeError) as error:
            fail(path, "version-agreement", f"could not be read: {error}")
            versions[path] = None
    version = versions[manifest_path]

    changelog_version = released_version()
    if changelog_version is None:
        fail("CHANGELOG.md", "version-agreement",
             "no released `## [X.Y.Z]` section found")
        return

    # Before the first npm publication the manifest carries a sentinel rather
    # than a version. Nothing to agree with yet, and the publish guard refuses
    # to publish it.
    published = version != VERSION_SENTINEL
    if not published:
        print(f"note: create-pathfinder is unpublished ({VERSION_SENTINEL}), "
              "skipping manifest/changelog agreement")
    elif version != changelog_version:
        fail(manifest_path, "version-agreement",
             f"installer is {version} but the newest released changelog "
             f"section is {changelog_version}; the installer mirrors the kit "
             "version exactly. Run .github/scripts/set-release-version.py")

    # The plugin manifest has no sentinel: it was written already carrying a
    # released number, and there is no unpublished state for it to sit in.
    plugin_version = versions[PLUGIN_MANIFEST]
    if plugin_version is not None and plugin_version != changelog_version:
        fail(PLUGIN_MANIFEST, "version-agreement",
             f"the plugin is {plugin_version} but the newest released "
             f"changelog section is {changelog_version}; one release number, "
             "three files. Run .github/scripts/set-release-version.py")

    # A release commit is one that carries a version tag. Between releases
    # there is no exact-match tag and this check does not apply.
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--exact-match"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
    except OSError:
        print("note: git unavailable, skipping release-tag agreement")
        return

    if result.returncode != 0:
        return

    tag = result.stdout.strip()
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        return

    tagged_version = tag.lstrip("v")
    if tagged_version != changelog_version:
        fail("CHANGELOG.md", "version-agreement",
             f"HEAD is tagged {tag} but the newest released section is "
             f"{changelog_version}")
    if published and tagged_version != version:
        fail(manifest_path, "version-agreement",
             f"HEAD is tagged {tag} but the installer is {version}")
    if plugin_version is not None and tagged_version != plugin_version:
        fail(PLUGIN_MANIFEST, "version-agreement",
             f"HEAD is tagged {tag} but the plugin is {plugin_version}")


def load_plugin_json(path: Path) -> dict | None:
    """Read one `.claude-plugin` manifest, or record why it could not be read."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(path, "plugin-manifest",
             "missing; the repository is its own Claude Code plugin and this "
             "file is what makes it one")
        return None
    except (OSError, json.JSONDecodeError) as error:
        fail(path, "plugin-manifest", f"could not be parsed: {error}")
        return None
    if not isinstance(data, dict):
        fail(path, "plugin-manifest", "is not a JSON object")
        return None
    return data


def check_plugin_manifests() -> None:
    """The two manifests that make this repository a plugin and a marketplace.

    Pure Python against two JSON files, deliberately: CI must not depend on the
    `claude` binary being installed. `claude plugin validate .` is the
    release-time manual check and catches a different class of problem — this
    catches the ones specific to Pathfinder's architecture, where the plugin
    root *is* the repository root and the plugin's skills *are* the canonical
    tree.
    """
    plugin = load_plugin_json(PLUGIN_MANIFEST)
    marketplace = load_plugin_json(MARKETPLACE_MANIFEST)

    # The plugin distributes commands; the kit installs project state. They are
    # separate paths on purpose, and the moment `.claude-plugin/` joins the copy
    # list every project that installs the kit starts carrying a manifest
    # claiming to be Pathfinder.
    for entry in load_copy_list() or ():
        if entry == PLUGIN_DIR.name or entry.startswith(PLUGIN_DIR.name + "/"):
            fail(CANONICAL_COPY_LIST, "plugin-manifest",
                 f"lists {entry!r}; the plugin is not part of the kit and "
                 "never reaches a destination project")

    # A component directory here is silently dead: Claude Code reads them from
    # beside `.claude-plugin/`, not inside it. Anything other than the two
    # manifests is either that mistake or a second thing to keep in step.
    for entry in sorted(PLUGIN_DIR.iterdir()) if PLUGIN_DIR.is_dir() else []:
        if entry.is_dir():
            fail(entry, "plugin-manifest",
                 "is a directory inside .claude-plugin/; plugin components live "
                 "beside that directory, never inside it, so this one would "
                 "never be loaded")
        elif entry.name not in {"plugin.json", "marketplace.json"}:
            fail(entry, "plugin-manifest",
                 ".claude-plugin/ holds plugin.json and marketplace.json and "
                 "nothing else")

    if plugin is not None:
        name = plugin.get("name")
        if name != PLUGIN_NAME:
            fail(PLUGIN_MANIFEST, "plugin-manifest",
                 f"name is {name!r} but the command namespace is "
                 f"{PLUGIN_NAME!r}; every command is /<name>:<skill> and "
                 "renaming this renames all of them")
        for field in PLUGIN_REQUIRED_FIELDS:
            if not plugin.get(field):
                fail(PLUGIN_MANIFEST, "plugin-manifest",
                     f"has no `{field}`")
        for field in PLUGIN_FORBIDDEN_FIELDS:
            if field in plugin:
                fail(PLUGIN_MANIFEST, "plugin-manifest",
                     f"declares `{field}`; Pathfinder ships skills and nothing "
                     "else, and its skills are the canonical skills/ tree")

    if marketplace is None:
        return

    for field in ("name", "owner", "plugins"):
        if not marketplace.get(field):
            fail(MARKETPLACE_MANIFEST, "plugin-manifest", f"has no `{field}`")

    entries = marketplace.get("plugins")
    if not isinstance(entries, list):
        return

    for entry in entries:
        if not isinstance(entry, dict):
            fail(MARKETPLACE_MANIFEST, "plugin-manifest",
                 f"plugin entry {entry!r} is not an object")
            continue
        if entry.get("name") != PLUGIN_NAME:
            fail(MARKETPLACE_MANIFEST, "plugin-manifest",
                 f"lists a plugin named {entry.get('name')!r}; this "
                 f"marketplace serves {PLUGIN_NAME!r} and nothing else")
        check_marketplace_source(entry.get("source"))


def check_marketplace_source(source: object) -> None:
    """A `source` must resolve to this repository, as a path or as a pinned repo.

    The path form is what chunk 1 verified and what the entry uses: the
    repository is both its own marketplace and its own plugin. The `github`
    form is the documented fallback, and is accepted here so that switching to
    it is a one-line edit rather than a validator change too.
    """
    if isinstance(source, str):
        resolved = (ROOT / source).resolve()
        if not resolved.is_dir():
            fail(MARKETPLACE_MANIFEST, "plugin-manifest",
                 f"source {source!r} does not resolve to an existing "
                 f"directory ({resolved})")
        elif not (resolved / ".claude-plugin" / "plugin.json").is_file():
            fail(MARKETPLACE_MANIFEST, "plugin-manifest",
                 f"source {source!r} resolves to {resolved}, which holds no "
                 ".claude-plugin/plugin.json")
        return

    if isinstance(source, dict) and source.get("source") == "github":
        if not source.get("repo"):
            fail(MARKETPLACE_MANIFEST, "plugin-manifest",
                 "a github source needs a `repo`")
        return

    fail(MARKETPLACE_MANIFEST, "plugin-manifest",
         f"source {source!r} is neither a path relative to the marketplace "
         "root nor a github source")


def check_release_workflow() -> None:
    """The release workflow's safety properties, none of which are visible in a diff.

    Three releases in a row published late or not at all because the workflow
    order put an irreversible public act ahead of a fallible one. The order is
    now correct, but "correct order" is not a thing YAML can express, so it is
    asserted here: the publish step must appear before the tag push, and the
    registry read-back must sit between them. Reordering the steps while
    refactoring is exactly the accident this catches.

    The authentication properties are checked the same way. They are each one
    line, each easy to add back by habit from another repository's workflow, and
    each silently fatal to OIDC publishing.

    Deliberately textual rather than parsed: PyYAML is not a dependency here,
    for the same reason nothing else in this script is, and every property below
    is a property of a line rather than of a mapping.
    """
    if not RELEASE_WORKFLOW.exists():
        fail(".github/workflows/release.yml", "release-workflow",
             "the release workflow is missing; releasing has no defined path")
        return

    # Comments are stripped first, and every check below reads the result. The
    # workflow explains at length why it does *not* use a token and why it is
    # not on a self-hosted runner, and a rule that searched the prose would fire
    # on its own documentation. The same strip stops a commented-out `npm
    # publish` from satisfying the ordering rule.
    text = "\n".join(
        line for line in RELEASE_WORKFLOW.read_text(encoding="utf-8").splitlines()
        if not line.lstrip().startswith("#")
    )

    def position(needle: str) -> int | None:
        index = text.find(needle)
        return None if index < 0 else index

    # Authentication. Trusted publishing needs the OIDC permission, and breaks
    # in confusing ways if anything reintroduces a token path.
    if "id-token: write" not in text:
        fail(RELEASE_WORKFLOW, "release-workflow",
             "no `id-token: write` permission, so npm cannot mint a publish "
             "credential from this workflow's identity")

    if re.search(r"^\s*registry-url:", text, re.MULTILINE):
        fail(RELEASE_WORKFLOW, "release-workflow",
             "`registry-url:` makes setup-node write an .npmrc with an empty "
             "_authToken, which npm prefers over the OIDC exchange; the publish "
             "then fails with a misleading 404")

    for token in ("NODE_AUTH_TOKEN", "NPM_TOKEN", "secrets.NPM"):
        if token in text:
            fail(RELEASE_WORKFLOW, "release-workflow",
                 f"`{token}` reintroduces long-lived token publishing, the "
                 "credential class trusted publishing exists to remove")

    if "self-hosted" in text:
        fail(RELEASE_WORKFLOW, "release-workflow",
             "trusted publishing rejects self-hosted runners")

    # Ordering. The whole point of the rewrite.
    publish = position("npm publish")
    confirm = position("registry.npmjs.org/create-pathfinder/$VERSION")
    tag_push = position("git push origin \"refs/tags/")
    release = position("gh release create")

    missing = [name for name, found in
               (("npm publish", publish), ("the registry read-back", confirm),
                ("the tag push", tag_push), ("gh release create", release))
               if found is None]
    if missing:
        fail(RELEASE_WORKFLOW, "release-workflow",
             f"cannot find {', '.join(missing)}; the ordering rule below can "
             "only pass vacuously, so it is failed instead")
        return

    if not publish < confirm < tag_push < release:
        fail(RELEASE_WORKFLOW, "release-workflow",
             "steps are out of order. It must be publish -> confirm on the "
             "registry -> push the tag -> create the Release. Anything else "
             "can leave a public tag or Release naming a version npm does not "
             "serve, which has happened three times")


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


def check_no_junk_tracked() -> None:
    """No OS or editor junk may be tracked, at any depth.

    .gitignore already keeps these out, but an ignore rule is advisory: a
    single `git add -f` defeats it, and `skills/.DS_Store` was quietly copied
    into destination projects by the installer before that was caught. This
    makes the invariant enforced rather than merely intended.
    """
    junk = ("*.DS_Store", "Thumbs.db", "._*", "__MACOSX")
    try:
        result = subprocess.run(
            ["git", "ls-files", "--", *junk],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
    except OSError:
        print("note: git unavailable, skipping no-junk-tracked")
        return

    if result.returncode != 0:
        print("note: git ls-files failed, skipping no-junk-tracked")
        return

    for tracked in sorted(filter(None, result.stdout.splitlines())):
        fail(tracked, "no-junk-tracked",
             "OS/editor junk is tracked; remove it with `git rm --cached`")


KIT_SOURCE = INSTALLER / "src" / "kit.mjs"
BOOTSTRAP_SKILL = SKILLS / "kickstart-pathfinder" / "SKILL.md"
BOOTSTRAP_HEADING = "## Kit Bootstrap"


def installer_never_ships(rule: str) -> tuple[str, ...] | None:
    """The installer's exclusion set, read out of the one file that declares it.

    Parsed from source rather than imported, because `NEVER_SHIPS` is module
    private and exporting it to satisfy a checker would be the tail wagging the
    dog. A parse that finds nothing is a hard failure, never a skip: the trap
    `check_installer_copy_list` fell into once was a rule that quietly stopped
    checking anything, and a regex that silently matches nothing is that same
    rule with a different spelling.

    Two rules derive from this set now — `bootstrap-exclusions` and
    `never-ships` — so the caller says which one to report a parse failure
    under. Both are equally stuck without it.
    """
    try:
        source = KIT_SOURCE.read_text(encoding="utf-8")
    except OSError as error:
        fail(KIT_SOURCE, rule, f"could not be read: {error}")
        return None

    block = re.search(r"const NEVER_SHIPS = new Set\(\[(.*?)\]\)",
                      source, re.DOTALL)
    if block is None:
        fail(KIT_SOURCE, rule,
             "no `const NEVER_SHIPS = new Set([...])` to read; this rule "
             "derives the exclusions from here and cannot check anything "
             "without them")
        return None

    paths = tuple(re.findall(r'"([^"]+)"', block.group(1)))
    if not paths:
        fail(KIT_SOURCE, rule,
             "`NEVER_SHIPS` parsed as empty; the exclusions could not be read")
        return None
    return paths


def check_bootstrap_exclusions() -> None:
    """The plugin bootstrap and the installer must not be able to disagree.

    `kickstart-pathfinder`'s Kit Bootstrap step lays the kit down for someone
    who arrived through `/plugin install` and has no npx step in their history.
    It is a second implementation of the installer's copy, written in prose for
    an agent to carry out, and a second implementation is exactly where the two
    can drift apart without anyone noticing.

    So the section is held to naming its sources instead of restating them. Add
    a fourth path to `NEVER_SHIPS` and the bootstrap picks it up on its next
    run, because it reads that set rather than remembering it. The failure this
    prevents is the quiet one: a bootstrap handing a project the very file
    `npx create-pathfinder` refuses to hand it.

    Both lists are derived here from the files that own them. This rule states
    neither, which is the whole point — a checker carrying its own copy of the
    list would be the third thing to keep in step.
    """
    never_ships = installer_never_ships("bootstrap-exclusions")
    copy_list = load_copy_list()

    try:
        body = BOOTSTRAP_SKILL.read_text(encoding="utf-8")
    except OSError as error:
        fail(BOOTSTRAP_SKILL, "bootstrap-exclusions",
             f"could not be read: {error}")
        return

    start = body.find(BOOTSTRAP_HEADING)
    if start == -1:
        fail(BOOTSTRAP_SKILL, "bootstrap-exclusions",
             f"has no `{BOOTSTRAP_HEADING}` section; the plugin bootstrap step "
             "is what this rule checks, and it cannot be found")
        return

    end = body.find("\n## ", start + len(BOOTSTRAP_HEADING))
    section = body[start:end if end != -1 else len(body)]

    # Naming the source is the requirement. Reading it is what makes the
    # bootstrap follow the installer instead of a memory of it.
    for path, why in ((CANONICAL_COPY_LIST, "what the kit is"),
                      (KIT_SOURCE, "what the kit never hands over")):
        reference = path.relative_to(ROOT).as_posix()
        if reference not in section:
            fail(BOOTSTRAP_SKILL, "bootstrap-exclusions",
                 f"does not name `{reference}`, which is the one statement of "
                 f"{why}; the bootstrap has to read it rather than restate it")

    for path in never_ships or ():
        if path in section:
            fail(BOOTSTRAP_SKILL, "bootstrap-exclusions",
                 f"names `{path}` literally; that is one of the installer's "
                 f"`NEVER_SHIPS` paths and restating it here creates a second "
                 "list that can drift out of step with "
                 f"{KIT_SOURCE.relative_to(ROOT).as_posix()}")

    # Partial mentions stay legal — the section may well need to say
    # `context/`. Naming every entry is what makes it a restatement of the list.
    if copy_list and all(entry in section for entry in copy_list):
        fail(BOOTSTRAP_SKILL, "bootstrap-exclusions",
             f"names every copy-list entry ({', '.join(copy_list)}); that is a "
             "second statement of the copy list, which "
             f"{CANONICAL_COPY_LIST.relative_to(ROOT).as_posix()} already owns")


def check_never_ships() -> None:
    """Files that live in a copy-list directory but must never reach a project.

    The set is read from `kit.mjs` rather than restated here, for the reason
    `bootstrap-exclusions` established: a checker carrying its own copy of the
    list is one more thing to keep in step, and the copy that falls behind is
    always the one nobody is looking at.

    `.gitignore` covers most of them, and `neverShips()` filters both the
    installer and the staging script. This rule exists because an ignore rule
    is advisory — one `git add -f` defeats it — and because the installer
    filter is only as good as the memory of why it is there. Same argument as
    `check_no_junk_tracked`, applied to a second invariant.

    Two routes lead out of this repository, and the entries do not all take
    both:

      1. **the published tarball** — a staged copy under the installer package.
         `stage-kit.mjs` copies from the working tree, so `.gitignore` has no
         say here at all, and the staged path is itself ignored, which puts it
         beyond the reach of the check below. This is the route that would
         actually have leaked, and it applies to *every* entry: never shipping
         is what the whole set means.
      2. **version control** — `git ls-files`, the `git add -f` case. This one
         applies only to the entries that are meant to be ignored, and
         `context/history.md` is not one of them. That file is durable project
         truth and is required to be tracked; demanding it be untracked would
         enforce the opposite of the contract.

    Which entries are ignore-able is asked of Git rather than written down
    again — `git check-ignore` answers from the ignore rules, and `--no-index`
    makes it answer for a tracked path too, so a `git add -f` cannot talk its
    way out of route two by having already succeeded.

    The two halves are independent: git being unavailable skips route two and
    must not silently take route one with it.
    """
    never_ships = installer_never_ships("never-ships")
    if not never_ships:
        return

    _check_never_ships_unstaged(never_ships)

    ignorable = _never_ships_ignorable(never_ships)
    if ignorable is None:
        return
    _check_never_ships_untracked(ignorable)


def _never_ships_ignorable(never_ships: tuple[str, ...]) -> tuple[str, ...] | None:
    """Which never-ships entries `.gitignore` claims, asked of Git itself.

    Returns None when the question could not be put — a missing git binary, or
    a failure that is not the documented "nothing matched". Route two is then
    skipped rather than guessed at.
    """
    try:
        result = subprocess.run(
            ["git", "check-ignore", "--no-index", "--", *never_ships],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
    except OSError:
        print("note: git unavailable, skipping never-ships (tracked)")
        return None

    # 0: at least one path is ignored. 1: none are, which is an answer.
    if result.returncode not in (0, 1):
        print("note: git check-ignore failed, skipping never-ships (tracked)")
        return None

    ignored = set(filter(None, result.stdout.splitlines()))
    return tuple(entry for entry in never_ships if entry in ignored)


def _check_never_ships_untracked(ignorable: tuple[str, ...]) -> None:
    """Route two: an entry `.gitignore` claims must not be tracked anyway."""
    if not ignorable:
        return

    try:
        result = subprocess.run(
            ["git", "ls-files", "--", *ignorable],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
    except OSError:
        print("note: git unavailable, skipping never-ships (tracked)")
        return

    if result.returncode != 0:
        print("note: git ls-files failed, skipping never-ships (tracked)")
        return

    for tracked in sorted(filter(None, result.stdout.splitlines())):
        fail(tracked, "never-ships",
             "is tracked, but `.gitignore` names it as this repository's own "
             "local state; it was added past the ignore rule with `git add "
             "-f`. Remove it with `git rm --cached` and keep it local")


def _check_never_ships_unstaged(never_ships: tuple[str, ...]) -> None:
    """Route one: no entry may be sitting in a staged kit, whatever its kind.

    A staged kit is transient — `prepack` writes it and `postpack` removes it —
    so on a clean checkout this finds nothing. It fires when a crashed or
    interrupted `npm pack` leaves staging behind, which is exactly when the
    next pack would publish it.
    """
    for entry in never_ships:
        staged = INSTALLER / Path(entry)
        if staged.exists():
            fail(f"packages/create-pathfinder/{entry}", "never-ships",
                 "is staged for publication, but must never reach a "
                 "destination project; remove the staged kit with "
                 "`node packages/create-pathfinder/scripts/stage-kit.mjs --clean`")


def load_copy_list() -> tuple[str, ...] | None:
    """Read the canonical copy list, or report why it could not be read."""
    try:
        data = json.loads(CANONICAL_COPY_LIST.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(CANONICAL_COPY_LIST, "copy-list-canonical",
             f"could not be read: {error}")
        return None

    entries = data.get("entries")
    if not isinstance(entries, list) or not entries:
        fail(CANONICAL_COPY_LIST, "copy-list-canonical",
             "`entries` must be a non-empty list of top-level names")
        return None

    for entry in entries:
        # A path rather than a name would mean the installer copies part of a
        # directory, which nothing else in the design expects.
        if not isinstance(entry, str) or "/" in entry or entry in ("", ".", ".."):
            fail(CANONICAL_COPY_LIST, "copy-list-canonical",
                 f"{entry!r} is not a plain top-level name")
            return None

    return tuple(entries)


def check_copy_list() -> None:
    """Everything that names the copy list must agree with copy-list.json.

    Until this rule existed, the `cp -R` line in the README was the only
    statement of what a destination project receives, and adding a seventh
    top-level directory to the kit would have silently failed to ship it.

    The README is checked between explicit markers rather than by matching the
    install command, because the install command is about to change. A rule
    anchored to `cp -R` would not have failed when that line disappeared — it
    would have quietly stopped checking anything, which is worse than never
    having existed.
    """
    copy_list = load_copy_list()
    if copy_list is None:
        return

    for entry in copy_list:
        if not (ROOT / entry).exists():
            fail(entry, "copy-list-exists",
                 "named in the copy list but missing from the repository")

    check_readme_copy_list(copy_list)

    check_installer_copy_list(copy_list)

    check_staging_ignored(copy_list)

    # npm allowlist: the kit entries must all be published, and nothing
    # kit-external may be listed alongside them.
    manifest_path = INSTALLER / "package.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        # Reported rather than raised: a traceback names Python's line numbers,
        # not the file the maintainer has to fix.
        fail(manifest_path, "copy-list-files", f"could not be read: {error}")
        return

    files = manifest.get("files", [])
    for entry in copy_list:
        if entry not in files:
            fail(manifest_path, "copy-list-files",
                 f"`{entry}` is in the copy list but not in `files`, "
                 "so it would be missing from the published package")
    for extra in files:
        if extra not in copy_list and extra not in ("bin", "src", "copy-list.json"):
            fail(manifest_path, "copy-list-files",
                 f"`{extra}` is published but is neither installer code nor "
                 "part of the copy list")


def check_staging_ignored(copy_list: tuple[str, ...]) -> None:
    """Every staged copy-list source must be git-ignored, and none may be tracked.

    `stage-kit.mjs` copies the kit into `packages/create-pathfinder/` so npm can
    see it, because `files` cannot reach outside the package directory. Those
    copies are transient: `prepack` writes them and `postpack` removes them. A
    staged source that `.gitignore` does not cover shows up as untracked noise
    in `git status` during a pack, and a `git add -A` in that window commits a
    second copy of the kit — the root copy and a stale duplicate underneath the
    installer, with nothing to keep them in agreement.

    This rule exists because that is exactly what happened when `roles` was
    added to the copy list in 2.0.0: the copy list, the installer, the npm
    allowlist, and the README were all updated together and checked by the rules
    above, while `.gitignore` was not, because nothing checked it. The staging
    list is the copy list plus `LICENSE`, mirroring `STAGED` in stage-kit.mjs.
    """
    staged = [*copy_list, "LICENSE"]

    for entry in staged:
        # A directory-only pattern does not match a path that does not exist, and
        # a staged copy exists only between prepack and postpack. Probing a path
        # *inside* the directory asks the question the pattern can answer on a
        # clean checkout.
        probe = f"packages/create-pathfinder/{entry}"
        if (ROOT / entry).is_dir():
            probe = f"{probe}/probe"

        try:
            result = subprocess.run(
                ["git", "check-ignore", "-q", "--", probe],
                cwd=ROOT, capture_output=True, text=True, check=False,
            )
        except OSError:
            print("note: git unavailable, skipping staging-ignored")
            return

        # 0 ignored, 1 not ignored, anything else is git failing rather than
        # answering — do not read that as a passing check.
        if result.returncode == 1:
            fail(".gitignore", "staging-ignored",
                 f"`packages/create-pathfinder/{entry}` is staged by "
                 "stage-kit.mjs but is not git-ignored, so a pack leaves a "
                 "committable duplicate of the kit behind")
        elif result.returncode != 0:
            print("note: git check-ignore failed, skipping staging-ignored")
            return

    try:
        tracked = subprocess.run(
            ["git", "ls-files", "--",
             *(f"packages/create-pathfinder/{entry}" for entry in staged)],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
    except OSError:
        return

    if tracked.returncode != 0:
        return

    for path in sorted(filter(None, tracked.stdout.splitlines())):
        fail(path, "staging-ignored",
             "is a staged copy of the kit that has been committed; the copy at "
             "the repository root is the only one in version control. Remove it "
             "with `git rm --cached`")


def check_installer_copy_list(copy_list: tuple[str, ...]) -> None:
    """Ask the installer what it would copy, and compare.

    Grepping kit.mjs for `copy-list.json` was the first version of this rule
    and it was worthless: the string also appears in that file's own comments,
    so the check passed even when the list had been replaced by a hardcoded
    array. Importing the module and reading COPY_LIST tests the behaviour
    rather than the spelling.
    """
    script = "import('./src/kit.mjs').then(m => console.log(JSON.stringify(m.COPY_LIST)))"
    try:
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=INSTALLER, capture_output=True, text=True, check=False,
        )
    except OSError:
        print("note: node unavailable, skipping copy-list-installer")
        return

    if result.returncode != 0:
        fail("packages/create-pathfinder/src/kit.mjs", "copy-list-installer",
             f"could not be loaded: {result.stderr.strip().splitlines()[-1:]}")
        return

    found = tuple(json.loads(result.stdout))
    if found != copy_list:
        fail("packages/create-pathfinder/src/kit.mjs", "copy-list-installer",
             f"the installer would copy {found}, but the canonical list is "
             f"{copy_list}")


def check_readme_copy_list(copy_list: tuple[str, ...]) -> None:
    """The README's install section must name every entry, between markers.

    Deliberately checks only that each entry is mentioned, not that nothing
    else is. The section legitimately names files a project must *not* copy —
    the root CHANGELOG.md — and a rule forbidding kit-external names there
    would fail on correct prose.
    """
    readme = ROOT / "README.md"
    text = readme.read_text(encoding="utf-8")
    start_marker, end_marker = README_MARKERS

    start = text.find(start_marker)
    end = text.find(end_marker)
    if start == -1 or end == -1:
        fail(readme, "copy-list-readme",
             f"install section is not delimited by {start_marker} and "
             f"{end_marker}; without them nothing checks that the README "
             "describes the real copy list")
        return
    if end < start:
        fail(readme, "copy-list-readme",
             f"{end_marker} appears before {start_marker}")
        return

    section = text[start + len(start_marker):end]
    for entry in copy_list:
        # The entry must appear as itself — `templates` or `templates/` — and not
        # merely as the first segment of a deeper path. Before this was tightened,
        # deleting the `templates/` row from the table still passed, because
        # `templates/CHANGELOG.template.md` further down the section satisfied the
        # match. The rule read as if it checked the table and did not.
        if not re.search(rf"(?<![\w./-]){re.escape(entry)}/?(?![\w./-])", section):
            fail(readme, "copy-list-readme",
                 f"`{entry}` is in the copy list but the install section "
                 "never mentions it")

    # When the section still carries a literal `cp -R {a,b,c}` command, check it
    # exactly — mention-anywhere is too lenient on its own, since a name dropped
    # from the command usually survives in the surrounding prose. This is
    # conditional on purpose: when the quickstart becomes `npx create-pathfinder`
    # the command disappears and the checks above still hold.
    command = re.search(r"cp -R [^\s{]*\{([^}]*)\}", section)
    if command is not None:
        copied = tuple(part.strip() for part in command.group(1).split(","))
        if copied != copy_list:
            fail(readme, "copy-list-readme",
                 f"the `cp -R` command copies {copied}, but the canonical "
                 f"list is {copy_list}")


def check_roles(skill_names: set[str]) -> None:
    """Every role file must be well-formed, current, and short.

    The skill-name rule is the one that earns its keep. A role names the
    skills it uses, and renaming a skill leaves those mentions pointing at
    nothing — with no adapter and no import to break, a stale role would go on
    being read as instructions until a human happened to notice. This is the
    same class of rule as `check_claude_md`.
    """
    if not ROLES.is_dir():
        fail("roles", "roles-exist",
             "the roles directory is missing, so the copy list would ship "
             "an entry that does not exist")
        return

    for path in sorted(ROLES.glob("*.md")):
        data = parse_frontmatter(path)
        if data is None:
            continue

        for key in ("name", "description"):
            if not data.get(key):
                fail(path, "role-frontmatter", f"`{key}` is missing or empty")

        expected = path.stem
        if "name" in data and data["name"] != expected:
            fail(path, "role-name",
                 f"frontmatter name is `{data['name']}` but the file is "
                 f"`{expected}.md`; a role is named by naming its file")

        lines = path.read_text(encoding="utf-8").splitlines()
        if len(lines) > ROLE_LINE_CEILING:
            fail(path, "role-length",
                 f"{len(lines)} lines, over the {ROLE_LINE_CEILING}-line "
                 "ceiling; a role this long has probably become a procedure")

        check_role_skills(path, skill_names)


def check_role_skills(path: Path, skill_names: set[str]) -> None:
    """Every skill a role names under `## Use` must exist.

    A role is prose. Nothing imports it and nothing generates from it, so a
    role naming a skill that was since renamed or removed goes on being read
    as instructions until a human happens to notice. This rule is the only
    thing standing between a stale role and that outcome.

    The slim role shape lists what a role uses as bullets under `## Use`, and
    backticks exactly the skill names — a role is free to describe its other
    tooling ("the project's existing test commands") in plain prose on the
    same list. That convention is what makes the rule decidable: a validator
    cannot tell a skill name from a tool name by looking at it, so it reads
    only the backticked tokens and leaves unbackticked prose alone.
    """
    text = path.read_text(encoding="utf-8")

    match = re.search(r"^## Use\s*$(.*)", text, re.MULTILINE | re.DOTALL)
    if not match:
        fail(path, "role-sections", "no `## Use` section found")
        return

    section = re.split(r"^## ", match.group(1), maxsplit=1, flags=re.MULTILINE)[0]

    names = re.findall(r"`([a-z0-9-]+)`", section)
    if not names:
        fail(path, "role-use-empty",
             "the `## Use` section names no skill; a role that uses no skill "
             "has no need to exist")
        return

    for name in sorted(set(names)):
        if name not in skill_names:
            fail(path, "role-skill-exists",
                 f"names `{name}` under `## Use`, but there is no "
                 f"`skills/{name}/` directory")


def check_lifecycle_role_assumptions() -> None:
    """Every lifecycle entry point declares exactly its one default role."""
    for relative_path, expected_role in LIFECYCLE_ROLE_ASSUMPTIONS.items():
        path = ROOT / relative_path
        if not path.is_file():
            fail(relative_path, "lifecycle-role-assumption", "file is missing")
            continue

        text = path.read_text(encoding="utf-8")
        headings = re.findall(r"^## Assumed role\s*$", text, re.MULTILINE)
        if len(headings) != 1:
            fail(path, "lifecycle-role-assumption",
                 f"expected one `## Assumed role` section, found {len(headings)}")
            continue

        section = re.search(
            r"^## Assumed role\s*$\n(.*?)(?=^## |\Z)",
            text, re.MULTILINE | re.DOTALL,
        )
        body = section.group(1) if section else ""
        named_roles = re.findall(r"`roles/(planner|developer|tester)\.md`", body)
        if named_roles != [expected_role]:
            fail(path, "lifecycle-role-assumption",
                 f"expected only `roles/{expected_role}.md`, found {named_roles}")
        if f"assume `{expected_role}`" not in body:
            fail(path, "lifecycle-role-assumption",
                 f"does not declare `{expected_role}` as its assumed role")
        if "explicit role overrides" not in body:
            fail(path, "lifecycle-role-override",
                 "does not preserve the human's explicit `/role` override")


def check_help_text() -> None:
    """`--help` must document every flag the parser accepts, and every harness.

    This rule belongs to no single feature, which is why it went unwritten while
    four features in a row added flags. Each one documented its own additions
    correctly; the risk is the fifth.

    The help text is captured by running `--help` rather than by reading the
    USAGE constant, because what a user sees is the output, not the variable.
    The accepted flags are read from the parser's own `case` labels — the
    switch is the definition of what the tool accepts, so a flag added there
    and nowhere else is exactly the drift being caught.
    """
    cli_source_path = INSTALLER / "src" / "cli.mjs"
    try:
        cli_source = cli_source_path.read_text(encoding="utf-8")
    except OSError as error:
        fail(cli_source_path, "help-text", f"could not be read: {error}")
        return

    try:
        help_result = subprocess.run(
            ["node", "bin/create-pathfinder.mjs", "--help"],
            cwd=INSTALLER, capture_output=True, text=True, check=False,
        )
    except OSError:
        print("note: node unavailable, skipping help-text")
        return

    if help_result.returncode != 0:
        fail(cli_source_path, "help-text",
             f"`--help` exited {help_result.returncode}")
        return

    help_text = help_result.stdout

    # Every long flag the parser switches on. `-h` is matched by `--help`'s
    # entry in the same table, so short forms are not required separately.
    accepted = sorted(set(re.findall(r'case "(--[a-z-]+)":', cli_source)))
    if not accepted:
        fail(cli_source_path, "help-text",
             "no `case \"--flag\":` labels found in the argument parser; this "
             "rule cannot see what the tool accepts and would pass vacuously")
        return

    for flag in accepted:
        if flag not in help_text:
            fail(cli_source_path, "help-text",
                 f"`{flag}` is accepted by the parser but never named in "
                 "`--help`, so it is an undocumented flag")

    # The harness list in the help text must come from the registry. It is
    # interpolated today; this fails if someone types it out and the two drift.
    script = ("import('./src/harnesses/index.mjs')"
              ".then(m => console.log(JSON.stringify(m.HARNESS_IDS)))")
    try:
        registry = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=INSTALLER, capture_output=True, text=True, check=False,
        )
    except OSError:
        return

    if registry.returncode != 0:
        fail("packages/create-pathfinder/src/harnesses/index.mjs", "help-text",
             "HARNESS_IDS could not be loaded")
        return

    for harness_id in json.loads(registry.stdout):
        if harness_id not in help_text:
            fail(cli_source_path, "help-text",
                 f"harness `{harness_id}` is in HARNESS_IDS but is not named "
                 "in `--help`, so `--agents` accepts a value the help omits")


def main() -> int:
    skill_names = check_skills()
    check_claude_md(skill_names)
    check_adapters(skill_names)
    check_adapter_generation()
    check_copy_list()
    check_roles(skill_names)
    check_lifecycle_role_assumptions()
    check_help_text()
    check_no_junk_tracked()
    check_never_ships()
    check_version_agreement()
    check_plugin_manifests()
    check_bootstrap_exclusions()
    check_changelog()
    check_release_workflow()

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
