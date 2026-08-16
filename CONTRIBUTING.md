# Contributing to Pathfinder

Thanks for your interest. Pathfinder is a small, deliberately bounded workflow kit. The most useful contributions sharpen what is already here; the least useful expand its scope.

Read [`NOT_A_FRAMEWORK.md`](NOT_A_FRAMEWORK.md) before proposing anything structural. The kit has no runtime, package manager, or build step, and it is meant to stay that way.

## What this repository is

**The kit is Markdown only.** `skills/` holds reusable behavior contracts, `context/` holds the templates a destination project fills in, and `templates/` holds scaffolding. A destination project installs nothing and runs nothing — that promise is about what Pathfinder ships, and it is unchanged.

**The repository that maintains the kit is not.** It also holds the installer (`packages/create-pathfinder/`, a dependency-free Node package with its own tests), the validation script and adapter generator you are expected to run before opening a PR, the committed Claude Code adapters generated from `skills/`, and the documentation site. These are how Pathfinder is built and published, and none of them is copied into your project. The repository root itself stays manifest-free, and CI asserts it.

## Git workflow

The convention, visible in `git log`:

1. Branch off `main`. Descriptive branch name, no prefix convention enforced.
2. Open a pull request against `main`.
3. **Squash merge.** History on `main` is linear — there are no merge commits, and each commit carries its PR number, for example `fix: repair reverse-engineer skill frontmatter (#4)`.
4. Delete the branch after merge.

Commit messages: recent commits use Conventional Commit prefixes (`fix:`, `docs:`, `chore:`), earlier ones use plain sentences. Prefixes are preferred for new work but not enforced by tooling. Write a body when the reason for the change is not obvious from the subject.

## Versioning

Semantic Versioning, scoped to the kit itself and not to destination projects. The policy lives in the [`CHANGELOG.md`](CHANGELOG.md) header and is repeated here for convenience:

- **MAJOR** — a skill is removed or renamed, or `context/` or the agent entry files change in a way that breaks an existing destination project.
- **MINOR** — a new skill or workflow capability that existing projects can adopt without changes.
- **PATCH** — clarifications, corrections, and documentation fixes.

Add your change under `[Unreleased]` in `CHANGELOG.md`. Do not bump the version yourself; releases are cut separately.

Not every change earns a version. The `CHANGELOG.md` header states the scope: the version tracks `skills/`, `context/`, `templates/`, and the agent entry files. CI, brand assets, the website, and the README do not bump it, and a change touching only those publishes nothing to npm.

The `create-pathfinder` npm package mirrors the kit version exactly and has no independent version of its own. Its `package.json` is derived from the changelog by tooling — never edited by hand.

## Releasing

The audience for this section is whoever cuts the next release after a long gap. Follow it in order.

**The version comes from one place.** The newest `## [X.Y.Z]` heading in `CHANGELOG.md` is the source of truth. The Git tag and the installer's `package.json` are derived from it, and CI fails if they drift.

**Nothing public exists until npm has the package.** Steps 1–6 prepare a release and are reversible. Step 7 hands the rest to [`.github/workflows/release.yml`](.github/workflows/release.yml), which publishes to npm *first*, reads the version back off the registry, and only then pushes the tag and creates the GitHub Release. A published version, a pushed tag, and a Release are all permanent, and a mistake is corrected by superseding it, never by removing it.

**There is no credential to check, because there is no credential.** npm mints a short-lived publish token from the workflow's own OIDC identity ([trusted publishing](https://docs.npmjs.com/trusted-publishers/)). Nobody types an OTP, no token expires, and there is nothing to authenticate before starting.

That is a direct fix for a failure that happened three releases running — `v1.4.1` stopped at an OTP prompt, `v1.5.0` found an expired token, `v1.7.0` was refused with `EOTP` — every time *after* the tag was already public. The old preflight advice was to run `npm whoami` first. **Do not reintroduce it. `npm whoami` proves identity and says nothing about publish entitlement**, which is exactly why it predicted none of the three.

1. **Decide the version** using the scope rule above, and confirm validation is green: `python3 .github/scripts/validate-kit.py`.
2. **Write the changelog entry.** Rename `[Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and add a fresh empty `[Unreleased]` above it. Write it carefully: the GitHub Release notes are this section, extracted verbatim by [`changelog-notes.py`](.github/scripts/changelog-notes.py), not written again later.
3. **Derive the installer version:** `python3 .github/scripts/set-release-version.py`. This rewrites `packages/create-pathfinder/package.json` from the changelog. Do not type the version there yourself.
4. **Regenerate every version-bearing transcript, from a real run, after the bump.** The installer prints its own version, so any captured output that shows it — the `getting-started` guide's transcript today — is stale the moment step 3 lands. Re-capture it by running the local release source in a pty and rendering what the terminal is left showing. **Never search-and-replace the version inside captured output:** the point of a transcript is that a run actually produced it, and editing it by hand turns evidence into an illustration that agrees with itself. Then confirm the embedded version matches the release. This has already caught a defect no test did.
5. **First publication only** — remove `"private": true` from `packages/create-pathfinder/package.json`. This is the deliberate boundary before `create-pathfinder` exists publicly and permanently under that name. Do it once, knowingly.
6. **Commit, open the PR, squash merge**, per the Git workflow above. Re-run validation on `main` afterwards; the version-agreement rule now has something to check.
7. **Run the release workflow:** `gh workflow run release.yml --ref main -f version=X.Y.Z`, or the *Run workflow* button on the Actions tab. It refuses to start unless the dispatched version, the changelog, and the manifest all say the same thing and `main`'s tip is the commit being released. Then, in order: validate, test, publish to npm, confirm the registry serves the version and that its `gitHead` is the release commit, push the annotated tag, create the Release with notes taken verbatim from the changelog.
8. **Verify from outside:** `npm view create-pathfinder version`, `gh release view vX.Y.Z`, and an `npx create-pathfinder@X.Y.Z` install into a scratch repository. Install from the published package, not from a local checkout — the point is to exercise what a user gets. In that scratch repository, confirm that adapters are generated (`npx create-pathfinder@X.Y.Z --agents claude-code`) and that a second identical run is idempotent: it writes the same bytes, reports the adapters as already up to date, and leaves the tree unchanged.

Never force-push, never move or delete a published tag, and never rewrite released history.

### When the workflow fails

**Re-dispatch it.** Every step checks whether its own effect already exists and skips if so, so a second run resumes rather than repeats. A failure before the publish leaves nothing behind. A failure after it leaves a published version that the next run will tag and release without publishing again.

Never invent a new version to get past a failed run. The version is a statement about the kit, not a retry counter.

The one thing to look at first is the `Plan the release` step, which prints what it decided and why before anything is written.

### Publishing by hand, if the workflow cannot be used

Only when GitHub Actions is unavailable, and knowing it needs an OTP:

```sh
cd packages/create-pathfinder
PATHFINDER_PUBLISH=yes npm publish
# then, only after the registry serves it:
git tag -a vX.Y.Z -m "vX.Y.Z — <summary>" && git push origin vX.Y.Z
gh release create vX.Y.Z --verify-tag --title "Pathfinder vX.Y.Z" \
  --notes-file <(python3 ../../.github/scripts/changelog-notes.py X.Y.Z)
```

The order is the same and for the same reason. The publish guard refuses unless intent is explicit, the tree is clean, the changelog agrees, and the commit is contained in `main`. It no longer requires a tag at `HEAD` — under the workflow the tag does not exist yet — but it still refuses if a tag is there and names a different version.

### One-time setup, outside this repository

Not part of a release. Done once, by a human with the npm account, and needed before the first workflow run:

1. On <https://www.npmjs.com/package/create-pathfinder/access>, under **Trusted Publisher**, choose GitHub Actions and enter organization/user `rikilamadrid`, repository `pathfinder`, workflow filename **`release.yml`**, no environment. Allow the `npm publish` action.
2. Leave "require 2FA for publishing" on. It does not apply to a trusted publisher, and it is what protects the human path.
3. Delete any remaining `create-pathfinder` automation or bypass-2FA tokens. Nothing uses them now, and npm is [removing their ability to publish](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/) in January 2027.

**The trusted publisher is bound to the workflow's filename.** Renaming `release.yml` silently breaks every future publish, so `validate-kit.py`'s `release-workflow` rule fails if the file is missing — but only npmjs.com can be told about a rename.

## Adding a skill

The bar is high on purpose. Pathfinder currently has 20 skills and does not want 40.

Add a new skill only when:

- a repeated task keeps going wrong
- an existing skill does not already own the responsibility
- the new skill has a narrow and clearly defined trigger
- it produces a concrete, verifiable result
- its inputs and outputs are explicit
- its boundaries with neighboring skills are documented
- it improves the workflow without silently expanding Pathfinder's scope

Review the existing skills for overlap first. "This is useful" is not sufficient — the test is repeated, demonstrated pain that no current skill covers.

**New skills go through [`skillsmith`](skills/skillsmith/SKILL.md).** It exists to force the questions above into an explicit contract: trigger, bounded context, ordered process, human checkpoints, concrete output, stop condition, and guardrails. A skill proposed without going through it will be sent back through it.

Every skill needs valid YAML frontmatter with `name` and `description`. Malformed frontmatter makes the skill undiscoverable — this has already happened once, in `2e3d0c6`.

**A new skill needs no adapter work by hand, but the committed adapters must be regenerated.** Harness adapters are generated from a skill's frontmatter, so adding, removing, or renaming a skill — or editing its `description` or `argument-hint` — changes `.claude/skills/`. Run:

```bash
node packages/create-pathfinder/scripts/generate-adapters.mjs
```

and commit the result, or CI fails by name on `adapter-freshness`. Editing a skill *body* produces no adapter diff, which is the property that makes committing generated files tolerable.

The generator only rewrites files it wrote itself, identified by a marker comment. If an adapter loses that marker — a hand-edit, a bad merge resolution — the generator reports it as a `conflict`, leaves it alone, and exits non-zero. The recovery is to delete the conflicted file and re-run.

**Pathfinder commits harness adapters only for the harness its own maintainers use.** That is Claude Code today, and it is one directory. Every other harness is generated on demand by users and is git-ignored here. Tracking a second one is a deliberate decision, not something a new harness should acquire by default.

The documentation site reads `skills/` in place, so a new skill's page appears immediately while `site/` is running. Its **sidebar entry appears after a dev-server restart**, because the grouping is read at config load. Until you place it in a workflow loop in `site/src/nav.mjs`, it shows up under `Ungrouped skills` — that is deliberate, so a skill is never silently missing from the navigation.

## Changing existing skills

Changes to `skills/`, `context/`, `templates/`, `AGENTS.md`, or `CLAUDE.md` land in every project that adopts the kit next. Say in the PR description what a destination project has to do differently, if anything.

## Where documentation lives

Pathfinder has three documentation surfaces, and each one owns a different job. Before adding an explanation, find the surface that owns it and put it there once; every other surface links to it.

| Surface | Owns |
| --- | --- |
| [`README.md`](README.md) | **The landing page.** What Pathfinder is and is not, the quickstart, an overview of the workflow, and links out. Not the reference manual. |
| [`site/`](site/) | **The canonical detailed documentation.** Concepts, guides, and the generated skill reference. |
| [`packages/create-pathfinder/README.md`](packages/create-pathfinder/README.md) | **CLI and package usage.** Invocation, flags, what the installer writes, requirements. Not the workflow tutorial. |

A fact repeated on two surfaces has two chances to go stale and no way to tell which copy is current. The exceptions are deliberate and few: the install command, the five-entry copy-list table, the Kickstart prompt, and the never-overwrites guarantee appear on more than one surface because each is the first thing a reader of that surface needs. The five-entry table in `README.md` additionally sits between `<!-- copy-list:start -->` and `<!-- copy-list:end -->` markers, and `validate-kit.py` checks that block against `copy-list.json` — moving or unwrapping it makes the check pass vacuously.

**The site publishes what a destination project receives — `context/` and `skills/` — plus the authored guides and concepts. Repository governance stays on GitHub.** [`LICENSE`](LICENSE), this file, [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), [`SECURITY.md`](SECURITY.md), and [`NOT_A_FRAMEWORK.md`](NOT_A_FRAMEWORK.md) are read by contributors and by GitHub's own community-profile tooling, none of them is in the copy list, and none has a site page. Link to them at their GitHub path.

## The documentation site

The site lives in [`site/`](site/) and deploys to <https://pathfinder-kit.vercel.app> from `main`. Every pull request gets its own preview URL. Neither is part of the kit: the site is unversioned, publishes nothing to npm, and a destination project never receives it.

**The build reads the kit in place.** Nothing under `site/` is a copy. The skill reference is generated from `skills/`, the concepts pages read `context/`, and the logo and favicons come from `assets/`. That is why the build-skip rule in [`site/vercel.json`](site/vercel.json) watches four paths and not just one:

```sh
[ "$VERCEL_GIT_COMMIT_REF" = "main" ] && git diff --quiet HEAD^ HEAD -- :/site :/skills :/context :/assets
```

Vercel reads the exit code backwards from a test: **0 skips the build, non-zero runs it.** `git diff --quiet` already answers in exactly that shape — no changes in those four paths means nothing the site renders has moved, so there is nothing to rebuild. A commit touching only `packages/`, `templates/`, `.github/`, `.claude/`, or a root document does not deploy. A commit touching a skill body does, because that text is on a page.

**The rule only skips on `main`, and that restriction is load-bearing.** `HEAD^` is a safe basis for comparison exactly when a push advances the branch by one commit, which is guaranteed on `main` by the squash-merge workflow above and guaranteed nowhere else. On a pull request branch the test fails on the first clause, the command exits non-zero, and the build always runs.

The first version of this rule did not have that restriction, and it published a stale site within the hour: a two-commit push whose first commit changed `site/` and whose second changed only `README.md` was skipped, because `HEAD^..HEAD` saw only the README. Comparing against `VERCEL_GIT_PREVIOUS_SHA` instead does not fix it — that variable does not resolve to the last deployed commit in this project's builds, and the fallback silently returns to `HEAD^`. Preview builds are cheap; a preview that lies about what is on the branch is not.

`:/` anchors each path at the repository root, so the rule does not depend on the command's working directory.

**The site is installable, and the build proves it before it deploys.** `npm run build` in `site/` ends with [`scripts/check-manifest.mjs`](site/scripts/check-manifest.mjs) as a `postbuild` step: it reads `dist/`, not the sources, and fails the build if the manifest is missing or unparseable, if any icon it declares does not resolve at its declared size and type, if the `any` or `maskable` purposes are unrepresented, if the landing page stops linking the manifest, or if `<meta name="theme-color">` and the manifest's `theme_color` disagree. It also checks **every** built page — not a sample — for the `apple-touch-icon` link and for `<meta name="apple-mobile-web-app-title">` agreeing with the manifest's `short_name`. It is deliberately dependency-free, so it runs on any install.

Every page, because iOS names a Web Clip from the page it was added from: without that meta tag Safari falls back to the document title, so adding from a deep page proposes `Getting started | Pathfinder`. Fixing the landing page's `<title>` fixes only the landing page. This is a real defect that shipped to a preview and was caught by testing the actual Add to Home Screen flow rather than an HTTP response.

That is the whole automated gate — there is no site job in GitHub Actions, and it does not need one: the check rides the Vercel build that actually publishes, so a broken deploy fails as a deploy rather than passing a green pull request. Note what it cannot tell you. Installability is a browser judgement, so whether a browser *offers* to install the site still has to be observed against a preview or production URL.

The icons themselves are brand files under [`assets/`](assets/), regenerated by hand with `npm run icons` when the mark changes and copied into `site/public/` by `sync-brand.mjs`. No build rasterises anything. See [`assets/README.md`](assets/README.md).

**The build's Node version is pinned in the Vercel project settings** (currently `24.x`), not in `site/package.json`. The `engines.node` range there says which versions the site is known to work on, which is a wider and different statement — writing the pin into it would claim that newer versions are unsupported, which is not true. If you change the pin, change it in the project settings.

## Reporting problems

Open an issue for bugs, unclear instructions, or a skill that misfires. Include the skill involved and what you expected it to do. For anything security-related, see [`SECURITY.md`](SECURITY.md) instead.

## A note on maintenance

This is a small project maintained by one person alongside other work. Issues and pull requests are read, but there is no service-level commitment on response time, and a well-argued proposal may still be declined to keep the kit small.
