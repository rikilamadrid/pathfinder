/**
 * Layer 3 — evidence. Every citation resolves at the declared commit.
 *
 * Against the commit, never the working tree. A lesson that cited the tree
 * would be checked against whatever the author happened to have open, and would
 * go stale silently the moment anyone edited a file. Against a commit it either
 * resolves or it does not, forever.
 *
 * Local Git only. There is no fetch, no clone, and no host lookup: a missing
 * commit is reported, not retrieved. Reaching the network to make a validation
 * pass would turn "the evidence was checked" into "the evidence was checked
 * somewhere, against something".
 *
 * Three failures, kept apart on purpose, because they mean three different
 * things to the person reading them:
 *
 *   source_commit_unavailable  the declared commit cannot be resolved here
 *   evidence_path_absent       the commit resolves; the file is not in it
 *   evidence_range_invalid     the file is there; the cited lines are not
 *
 * None of them is a warning and none of them downgrades to a skip. An engine
 * that shrugged at an unresolvable commit would deliver an artifact claiming
 * its evidence was verified when nothing had been.
 */

import { spawnSync } from "node:child_process";

import { diagnostic } from "./diagnostics.mjs";

/**
 * @param {object} spec a specification that passed structure and composition
 * @param {string} repoDir  the directory whose Git history evidence resolves in
 * @returns {import("./diagnostics.mjs").Diagnostic[]}
 */
export function validateEvidence(spec, repoDir) {
  const out = [];
  const citations = collectCitations(spec, out);

  const git = probeGit(repoDir);
  if (!git.available) {
    out.push(diagnostic("evidence", "source_commit_unavailable", "source.commit",
      `${git.reason} Evidence resolves against \`${spec.source.commit}\` in ` +
      `\`${spec.source.repo}\` using local Git only; nothing is fetched.`,
      spec.source.repo));
    return out;
  }

  /** Resolved object names, memoised per abbreviated commit. */
  const resolved = new Map();
  const resolve = (commit, path, subject) => {
    if (resolved.has(commit)) return resolved.get(commit);
    const full = revParse(repoDir, commit);
    if (full === null) {
      out.push(diagnostic("evidence", "source_commit_unavailable", path,
        `commit \`${commit}\` is not present in the repository at ` +
        `\`${repoDir}\`. The specimen declares \`${spec.source.repo}\`; this ` +
        `checkout is a different repository, or the commit has not been ` +
        `fetched. Evidence is not verified, so validation fails rather than ` +
        `claiming it was.`, subject));
    }
    resolved.set(commit, full);
    return full;
  };

  /** Blob line counts, memoised per `commit:path`. */
  const lineCounts = new Map();

  for (const citation of citations) {
    const commit = citation.commit ?? spec.source.commit;
    const full = resolve(commit, citation.commit ? citation.path : "source.commit",
      citation.subject);
    if (full === null) continue;

    const key = `${full}:${citation.path}`;
    if (!lineCounts.has(key)) lineCounts.set(key, readBlobLineCount(repoDir, full, citation.path));
    const count = lineCounts.get(key);

    if (count === null) {
      out.push(diagnostic("evidence", "evidence_path_absent", citation.path,
        `${citation.subject} cites \`${citation.path}\`, which does not exist ` +
        `at commit \`${commit}\` — checked against that commit, not the ` +
        `working tree.`, citation.subject));
      continue;
    }

    if (citation.lines) {
      const [start, end] = citation.lines;
      if (end < start) {
        out.push(diagnostic("evidence", "evidence_range_invalid", citation.path,
          `${citation.subject} cites lines ${start}-${end} of ` +
          `\`${citation.path}\`, which ends before it begins`, citation.subject));
      } else if (end > count) {
        out.push(diagnostic("evidence", "evidence_range_invalid", citation.path,
          `${citation.subject} cites lines ${start}-${end} of ` +
          `\`${citation.path}\`, which has ${count} line(s) at commit ` +
          `\`${commit}\``, citation.subject));
      }
    }
  }

  return out;
}

/**
 * Walk the specification for citations, in document order, and fail every
 * concept that carries none.
 *
 * The emptiness rule lives here rather than in the schema so it is reported as
 * the evidence claim it is. A `minItems` in the schema would fail the same
 * specification one layer earlier and say "must have at least 1 item", which
 * tells a producer about arrays when the thing they got wrong was a claim.
 */
function collectCitations(spec, out) {
  const citations = [];

  const take = (evidence, subject, path) => {
    for (let i = 0; i < (evidence ?? []).length; i += 1) {
      citations.push({ ...evidence[i], subject, path: evidence[i].path, at: `${path}[${i}]` });
    }
  };

  if (spec.kind === "diagram") {
    collectDiagramCitations(spec, take);
    return citations;
  }

  spec.lesson.modules.forEach((module, m) => {
    module.sections.forEach((section, s) => {
      const at = `lesson.modules[${m}].sections[${s}]`;

      if (section.type === "concept" && (section.evidence ?? []).length === 0) {
        out.push(diagnostic("evidence", "concept_without_evidence", `${at}.evidence`,
          `concept "${section.title}" asserts something about the source and ` +
          `cites nothing. A concept without evidence is an error, not a ` +
          `warning: an uncited claim is the renderer asserting domain content, ` +
          `which it must never do.`, section.title));
      }

      const label = section.title ?? `${section.type} section`;
      take(section.evidence, `${section.type} "${label}"`, `${at}.evidence`);

      if (section.type === "flow") {
        section.steps.forEach((step, i) => {
          take(step.evidence, `flow step "${step.title}"`, `${at}.steps[${i}].evidence`);
        });
      }
      if (section.type === "quiz") {
        section.questions.forEach((question, i) => {
          take(question.evidence, `question "${question.prompt}"`,
            `${at}.questions[${i}].evidence`);
        });
      }
    });
  });

  return citations;
}

/**
 * A diagram's citations, in document order.
 *
 * Every place evidence may appear is walked, and nothing here requires it. The
 * rules about *which* facts must be cited belong to the provenance contract,
 * which distinguishes a diagram derived from a repository from one describing
 * a system that does not exist yet. Until that distinction exists, this layer
 * makes the one claim it can stand behind: every citation that is present
 * resolves at the declared commit.
 */
function collectDiagramCitations(spec, take) {
  const { nodes, edges } = spec.diagram;

  (spec.diagram.groups ?? []).forEach((group, g) => {
    take(group.evidence, `group "${group.label}"`, `diagram.groups[${g}].evidence`);
  });
  nodes.forEach((node, n) => {
    take(node.evidence, `node "${node.label}"`, `diagram.nodes[${n}].evidence`);
  });
  edges.forEach((edge, e) => {
    take(edge.evidence, `edge \`${edge.id}\``, `diagram.edges[${e}].evidence`);
  });
  (spec.diagram.paths ?? []).forEach((path, p) => {
    take(path.evidence, `path "${path.label}"`, `diagram.paths[${p}].evidence`);
  });
  (spec.diagram.views ?? []).forEach((view, v) => {
    take(view.evidence, `view "${view.label}"`, `diagram.views[${v}].evidence`);
  });
}

/** Is there a Git we can ask, and is `repoDir` inside a repository? */
function probeGit(repoDir) {
  const version = git(repoDir, ["--version"]);
  if (version === null) {
    return { available: false, reason: "Git is not available on this machine." };
  }
  const top = git(repoDir, ["rev-parse", "--show-toplevel"]);
  if (top === null) {
    return {
      available: false,
      reason: `\`${repoDir}\` is not inside a Git repository, so no commit can be resolved.`,
    };
  }
  return { available: true, root: top.trim() };
}

/** The full object name for a commit-ish, or null if it does not resolve. */
function revParse(repoDir, commit) {
  const out = git(repoDir, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]);
  return out === null ? null : out.trim();
}

/**
 * Line count of a blob at a commit, or null when the path is absent or is not
 * a file. A trailing newline does not add a line, so the count matches what an
 * editor shows.
 */
function readBlobLineCount(repoDir, commit, path) {
  const type = git(repoDir, ["cat-file", "-t", `${commit}:${path}`]);
  if (type === null || type.trim() !== "blob") return null;

  const content = git(repoDir, ["cat-file", "blob", `${commit}:${path}`]);
  if (content === null) return null;
  if (content === "") return 0;
  return content.endsWith("\n")
    ? content.split("\n").length - 1
    : content.split("\n").length;
}

/**
 * Run Git and return stdout, or null on any failure.
 *
 * `spawnSync` with an argument array, never a shell string: a citation path is
 * producer-supplied text, and the one thing it must never become is part of a
 * command line.
 */
function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // No pager, no config-driven surprises in output we parse.
    env: { ...process.env, GIT_PAGER: "cat", GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}
