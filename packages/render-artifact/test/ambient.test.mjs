/**
 * Nothing ambient reaches rendering — proved twice, at two different costs.
 *
 * **Structurally**, by walking the render path's import graph. The engine's
 * determinism note claims the render path imports not one `node:` builtin
 * between its modules, and that claim is what makes determinism a property of
 * the code rather than of the runs that happened to be observed. A module with
 * no way to reach a clock, a hostname, or the filesystem cannot read one by
 * accident in a case nobody tested. This is the cheaper and the stronger of the
 * two checks, and it is the one that fails the moment somebody adds an import.
 *
 * **Observationally**, by looking for this machine's own identity in delivered
 * HTML. Weaker — absence in one artifact is not absence in every artifact —
 * but it is the check that would catch a value arriving by a route the import
 * graph does not describe, and it costs almost nothing.
 *
 * CI does not mutate the machine's hostname. It does not need to: the import
 * graph shows there is nothing in scope to ask.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { hostname, userInfo, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";

import { forbiddenUses } from "../lib/forbidden.mjs";
import {
  ENGINE_ROOT, REPO_ROOT, SPECS, cleanUpTemporaryDirectories, deliverInSubprocess,
} from "../lib/harness.mjs";

after(cleanUpTemporaryDirectories);

/**
 * The render path's entry point. Everything reachable from here is what runs
 * when an artifact is produced.
 */
const RENDER_ENTRY = join(ENGINE_ROOT, "render", "index.mjs");

/**
 * The modules the determinism note names. Asserting they are present keeps the
 * note and the code from drifting apart; the closure walk below is what
 * actually enforces the rule, and covers any module added later.
 */
const DOCUMENTED_RENDER_PATH = [
  "render/index.mjs",
  "render/lesson.mjs",
  "render/shell.mjs",
  "render/theme.mjs",
  "render/behavior.mjs",
  "render/escape.mjs",
  "version.mjs",
  "verification.mjs",
];

const IMPORT_SPECIFIER = /(?:^|\n)\s*import\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g;
const EXPORT_FROM = /(?:^|\n)\s*export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(/;
const REQUIRE = /\brequire\s*\(/;

/** Every module reachable from `entry` by a static import or re-export. */
function importClosure(entry) {
  const visited = new Map();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (visited.has(file)) continue;

    const source = readFileSync(file, "utf8");
    const specifiers = [
      ...[...source.matchAll(IMPORT_SPECIFIER)].map((m) => m[1]),
      ...[...source.matchAll(EXPORT_FROM)].map((m) => m[1]),
    ];
    visited.set(file, { source, specifiers });

    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier));
    }
  }

  return visited;
}

describe("the render path's import graph", () => {
  const closure = importClosure(RENDER_ENTRY);
  const relative = (file) => file.slice(ENGINE_ROOT.length + 1);
  const names = [...closure.keys()].map(relative).sort();

  it("reaches every module the determinism note names", () => {
    for (const documented of DOCUMENTED_RENDER_PATH) {
      assert.ok(names.includes(documented),
        `${documented} is documented as part of the render path but is not ` +
        `reachable from render/index.mjs. Reached: ${names.join(", ")}`);
    }
  });

  it("imports zero node: builtins, transitively", () => {
    const offenders = [];
    for (const [file, { specifiers }] of closure) {
      for (const specifier of specifiers) {
        if (specifier.startsWith("node:")) offenders.push(`${relative(file)} -> ${specifier}`);
      }
    }

    assert.deepEqual(offenders, [],
      "a node: builtin in the render path is a route to a clock, a hostname, " +
      "an environment variable or a directory listing. The invariant holds " +
      "because there is nothing ambient in scope to reach for; these imports " +
      "put something there.");
  });

  it("imports nothing but its own siblings", () => {
    const offenders = [];
    for (const [file, { specifiers }] of closure) {
      for (const specifier of specifiers) {
        if (!specifier.startsWith(".")) offenders.push(`${relative(file)} -> ${specifier}`);
      }
    }

    assert.deepEqual(offenders, [],
      "the render path has zero runtime dependencies and no builtins; every " +
      "import it makes is a relative path to another engine module");
  });

  it("reaches nothing through a dynamic import or require", () => {
    // A static walk is only a proof if there is no dynamic edge for it to
    // miss. `import()` or `require()` in the closure would make the graph
    // above a description of some of the render path rather than all of it.
    const offenders = [];
    for (const [file, { source }] of closure) {
      if (DYNAMIC_IMPORT.test(source)) offenders.push(`${relative(file)}: import(`);
      if (REQUIRE.test(source)) offenders.push(`${relative(file)}: require(`);
    }

    assert.deepEqual(offenders, [],
      "a dynamic edge would let a module the static graph cannot see into " +
      "the render path");
  });
});

/**
 * An artifact has three kinds of text in it, and only one of them can carry a
 * leak.
 *
 *   the stylesheet      a renderer constant
 *   the behaviour script a renderer constant
 *   everything else     the document: producer content and renderer chrome
 *
 * The two constants are where a search for a machine's identity goes wrong. A
 * stylesheet says `:root` and `user-select`; a behaviour script names a
 * variable `root`. None of that is this machine's username — it is CSS and
 * JavaScript vocabulary that would read the same on any machine in the world —
 * but a substring search over the raw bytes cannot tell the difference, and
 * would report a leak on any host whose user is called `root` or `user`.
 *
 * So the search runs over the document with the two constants removed. The
 * suite below establishes that they *are* constants before relying on it, and
 * the golden tests hold them byte-identical to committed, reviewed text, so
 * ambient data cannot take shelter in the part that is not searched.
 *
 * This keeps the invariant intact rather than excusing a word from it: a
 * username that actually reached an artifact would land in its content — a
 * heading, a provenance row, an attribute — which is exactly what is searched.
 */
const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style>/g;
const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script>/g;

function documentOf(html) {
  return html.replace(STYLE_BLOCK, "").replace(SCRIPT_BLOCK, "");
}

function constantsOf(html) {
  return {
    style: html.match(STYLE_BLOCK) ?? [],
    script: html.match(SCRIPT_BLOCK) ?? [],
  };
}

describe("the renderer's stylesheet and behaviour script are constants", () => {
  // Two specifications with nothing in common — different titles, modules,
  // section types and source. If the presentation they arrive in is
  // byte-identical, it was not built from either of them, and nothing
  // per-artifact reaches it. That is what licenses the search below to skip it.
  const fixture = constantsOf(deliverInSubprocess({ spec: SPECS.fixture }).html);
  const example = constantsOf(deliverInSubprocess({ spec: SPECS.example }).html);

  it("there is exactly one of each, carried inline", () => {
    assert.equal(fixture.style.length, 1, "an artifact carries one stylesheet");
    assert.equal(fixture.script.length, 1, "an artifact carries one behaviour script");
    assert.equal(example.style.length, 1);
    assert.equal(example.script.length, 1);
  });

  it("both are identical across two unrelated specifications", () => {
    assert.equal(fixture.style[0], example.style[0],
      "the stylesheet differs between specifications, so it is built from " +
      "something per-artifact and can no longer be treated as fixed text");
    assert.equal(fixture.script[0], example.script[0],
      "the behaviour script differs between specifications, so it is built " +
      "from something per-artifact and can no longer be treated as fixed text");
  });

  it("removing them leaves the document, not an empty string", () => {
    // A regex that matched too much would silently empty the haystack and make
    // every assertion below pass by having nothing left to search.
    const document = documentOf(deliverInSubprocess({ spec: SPECS.fixture }).html);

    assert.ok(document.length > 2000,
      `only ${document.length} characters survived; the block patterns are ` +
      `eating the document, so the leak search has nothing to search`);
    assert.ok(document.includes("A specification that cites nothing"),
      "the artifact's own title did not survive, so the document is not intact");
    assert.ok(!document.includes("<style"), "a stylesheet survived removal");
    assert.ok(!document.includes("<script"), "a behaviour script survived removal");
  });
});

describe("no ambient machine data in delivered HTML", () => {
  /**
   * A value counts as leaked only if it is in the artifact's document and
   * *not* in the specification. A specification is free to mention a date, a
   * path, or a word that happens to be this machine's username; what it must
   * never do is acquire one it did not ask for.
   */
  function assertAbsentUnlessSpecified(name, value, { html, spec }) {
    // One- to three-character values are not evidence of anything: they occur
    // in ordinary prose and in markup by chance, on every machine.
    if (!value || value.length < 4) return;
    if (spec.includes(value)) return;

    assert.ok(!documentOf(html).includes(value),
      `${name} (\`${value}\`) reached the artifact's document and is nowhere ` +
      `in the specification, so rendering read it from this machine`);
  }

  for (const name of Object.keys(SPECS)) {
    describe(name, () => {
      const delivery = deliverInSubprocess({ spec: SPECS[name] });
      const spec = readFileSync(SPECS[name], "utf8");

      it("delivers", () => {
        assert.equal(delivery.status, 0,
          `${JSON.stringify(delivery.receipt, null, 2)}\n${delivery.stderr}`);
      });

      it("carries no hostname, username, or home directory", () => {
        const context = { html: delivery.html, spec };
        const host = hostname();
        assertAbsentUnlessSpecified("the hostname", host, context);
        assertAbsentUnlessSpecified("the short hostname", host.split(".")[0], context);
        assertAbsentUnlessSpecified("the username", userInfo().username, context);
        assertAbsentUnlessSpecified("the home directory", process.env.HOME, context);
      });

      it("carries no absolute machine path", () => {
        const context = { html: delivery.html, spec };
        assertAbsentUnlessSpecified("the repository's absolute path", REPO_ROOT, context);
        assertAbsentUnlessSpecified("the temporary directory", tmpdir(), context);
        assertAbsentUnlessSpecified("the output path", dirname(delivery.outPath), context);

        // A `file://` URL or a POSIX/Windows root in the output is an absolute
        // path however it was spelled.
        assert.ok(!delivery.html.includes("file://"),
          "a file:// URL in the artifact is an absolute machine path");
        assert.doesNotMatch(delivery.html, /\b[A-Za-z]:\\[A-Za-z]/,
          "a drive-letter path in the artifact is an absolute machine path");
      });

      it("carries no timestamp the specification did not supply", () => {
        // The renderer reads no clock, so the only date in an artifact is
        // `source.generated_at`. A clock read would show up as a time of day.
        assert.doesNotMatch(delivery.html, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
          "an ISO-8601 datetime with a time component is a clock read: " +
          "specifications supply a date, not a moment");
        assert.doesNotMatch(delivery.html, /\b\d{2}:\d{2}:\d{2}\b/,
          "a wall-clock time in the artifact did not come from the specification");
        assert.doesNotMatch(delivery.html, /GMT[+-]\d{4}|\bUTC[+-]\d/,
          "a timezone offset in the artifact means something formatted a date");
      });

      it("carries no process, runtime, or environment detail", () => {
        const context = { html: delivery.html, spec };
        assertAbsentUnlessSpecified("the Node version", process.versions.node, context);
        assertAbsentUnlessSpecified("the platform", `${process.platform}-${process.arch}`, context);
        assert.ok(!delivery.html.includes(`pid ${process.pid}`),
          "a process id reached the artifact");
      });
    });
  }
});

/**
 * The import graph proves nothing ambient can be *reached*. This proves nothing
 * ambient is *called* — a different claim, and the one that matters once the
 * render path grew a layout engine.
 *
 * `Math.floor` is exact. `Math.sin` is not: ECMA-262 leaves the precision of
 * the transcendental functions to the implementation, so two engines may
 * legitimately disagree in the last bits and a layout built on one would not
 * reproduce on the other. The same goes for a clock, for randomness, for a
 * locale API, and for `normalize`, whose Unicode data moves with the engine.
 * None of them is reachable through an import here, because none of them needs
 * an import: they are all on the global object.
 */
describe("nothing ambient is called in the render path", () => {
  const closure = importClosure(RENDER_ENTRY);
  const relative = (file) => file.slice(ENGINE_ROOT.length + 1);

  it("covers every module the render path reaches", () => {
    // Guard the guard: a scan of a list that quietly stopped matching the real
    // closure would pass forever. The set below is derived from the closure
    // itself, so a module added tomorrow is scanned tomorrow.
    assert.ok(closure.size >= DOCUMENTED_RENDER_PATH.length,
      "the closure is smaller than the documented render path");
    assert.ok([...closure.keys()].some((f) => relative(f) === "render/graph/layout.mjs"),
      "the layout engine is not in the scanned closure");
  });

  it("calls no clock, randomness, locale API, normalization, or inexact Math", () => {
    const offenders = [];
    for (const [file, { source }] of closure) {
      for (const use of forbiddenUses(source)) {
        offenders.push(`${relative(file)}:${use.line} — \`${use.text}\` is ${use.reason}`);
      }
    }
    assert.deepEqual(offenders, [],
      "the render path reaches for something ambient. The invariant is that " +
      "rendering is a pure function of the specification and this code.");
  });

  it("bites when a forbidden call is introduced into the layout path", () => {
    // The assertion above is worth exactly as much as its ability to fail. The
    // real layout source is mutated in memory — the file on disk is untouched —
    // and the same scanner is asked again.
    const layout = readFileSync(join(ENGINE_ROOT, "render", "graph", "layout.mjs"), "utf8");
    assert.deepEqual(forbiddenUses(layout), [], "the unmodified layout path is clean");

    const spoilt = layout.replace(
      "export function layoutGraph(diagram) {",
      "export function layoutGraph(diagram) {\n  const wobble = Math.sin(diagram.nodes.length);");
    assert.notEqual(spoilt, layout, "the injection point moved; this test is no longer injecting");

    const found = forbiddenUses(spoilt);
    assert.ok(found.some((use) => use.text === "Math.sin"),
      `injecting Math.sin was not detected; found ${JSON.stringify(found)}`);
  });

  it("is not fooled by prose, fixtures, or literal text", () => {
    // Every one of these words appears in the render path already — in the
    // comment that forbids it. A guard that fired on them would be turned off
    // within a week.
    const innocent = [
      "// never call Math.sin, Math.random, Date.now, Intl or localeCompare here",
      "/* normalize() and toLocaleString() are forbidden */",
      'const note = "Math.random is forbidden";',
      "const css = `body { font: 12px } /* Date */`;",
      "const ok = Math.floor(a / 2) + Math.max(x, y) - Math.abs(z);",
    ].join("\n");
    assert.deepEqual(forbiddenUses(innocent), []);
  });

  it("reports a forbidden call inside a template expression", () => {
    // Literal text inside a template is not code, but `${...}` is. A guard that
    // blanked the whole template would have a hole exactly the shape of the
    // shell's interpolations.
    const hidden = "const html = `<p>${Date.now()}</p>`;";
    assert.ok(forbiddenUses(hidden).some((use) => use.text === "Date"));
  });
});
