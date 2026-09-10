/**
 * Layer 2 — composition. The specification is internally coherent.
 *
 * Everything here is a rule a schema cannot express: uniqueness across the
 * document, references that resolve, graphs without orphans or cycles, and an
 * answer that indexes its own options. A structurally perfect specification can
 * still describe a lesson whose navigation lands nowhere, and that is what this
 * layer is for.
 *
 * Every check walks the specification in document order, so diagnostics come
 * back in the order a reader would meet the problems.
 */

import { diagnostic } from "./diagnostics.mjs";

/**
 * @param {object} spec a specification that passed the structural layer
 * @returns {import("./diagnostics.mjs").Diagnostic[]}
 */
export function validateComposition(spec) {
  const out = [];
  const modules = spec.lesson.modules;

  /** Anchors the renderer will emit. Collisions would make two links one link. */
  const anchors = new Map();

  modules.forEach((module, m) => {
    const modulePath = `lesson.modules[${m}]`;
    claimAnchor(anchors, out, module.id, `${modulePath}.id`, `module "${module.title}"`);

    if (module.sections.length === 0) {
      out.push(diagnostic("composition", "module_empty", `${modulePath}.sections`,
        "a module must carry at least one section", module.title));
    }

    module.sections.forEach((section, s) => {
      const sectionPath = `${modulePath}.sections[${s}]`;
      claimAnchor(anchors, out, section.id, `${sectionPath}.id`,
        `${section.type} section in module "${module.title}"`);

      if (section.type === "flow") checkFlow(section, sectionPath, out);
      if (section.type === "quiz") checkQuiz(section, sectionPath, out);
    });
  });

  checkModuleGraph(modules, out);
  return out;
}

/** Identifiers become DOM ids and link targets, so they are unique document-wide. */
function claimAnchor(anchors, out, id, path, subject) {
  const previous = anchors.get(id);
  if (previous) {
    out.push(diagnostic("composition", "duplicate_identifier", path,
      `\`${id}\` is already used by ${previous.subject} at ${previous.path}; ` +
      `identifiers become link targets and must be unique across the artifact`,
      subject));
    return;
  }
  anchors.set(id, { path, subject });
}

/**
 * A flow's first step is its entry. `next` is optional and defaults to the
 * following step, which is what a linear flow means without saying so.
 */
function checkFlow(section, path, out) {
  const steps = section.steps;
  const index = new Map();

  steps.forEach((step, i) => {
    if (index.has(step.id)) {
      out.push(diagnostic("composition", "duplicate_step_identifier",
        `${path}.steps[${i}].id`,
        `\`${step.id}\` is used twice in flow "${section.title}"`, section.title));
      return;
    }
    index.set(step.id, i);
  });

  const edges = steps.map((step, i) => {
    if (step.next === undefined) return i + 1 < steps.length ? [i + 1] : [];
    return step.next.map((target) => index.get(target)).filter((t) => t !== undefined);
  });

  steps.forEach((step, i) => {
    for (const target of step.next ?? []) {
      if (!index.has(target)) {
        out.push(diagnostic("composition", "unresolved_reference",
          `${path}.steps[${i}].next`,
          `step "${step.title}" leads to \`${target}\`, which is not a step of ` +
          `flow "${section.title}"`, step.title));
      } else if (index.get(target) === i) {
        out.push(diagnostic("composition", "graph_cycle", `${path}.steps[${i}].next`,
          `step "${step.title}" leads to itself`, step.title));
      }
    }
  });

  if (findCycle(edges)) {
    out.push(diagnostic("composition", "graph_cycle", `${path}.steps`,
      `flow "${section.title}" contains a cycle; a flow a reader can follow ` +
      `has an end`, section.title));
    return;
  }

  const reached = reachableFrom(edges, 0);
  steps.forEach((step, i) => {
    if (!reached.has(i)) {
      out.push(diagnostic("composition", "orphan_step", `${path}.steps[${i}]`,
        `step "${step.title}" is not reachable from the flow's first step`,
        step.title));
    }
  });
}

function checkQuiz(section, path, out) {
  const seen = new Set();
  section.questions.forEach((question, q) => {
    const questionPath = `${path}.questions[${q}]`;
    if (seen.has(question.id)) {
      out.push(diagnostic("composition", "duplicate_question_identifier",
        `${questionPath}.id`,
        `\`${question.id}\` is used twice in this quiz`, question.prompt));
    }
    seen.add(question.id);

    if (question.answer >= question.options.length) {
      out.push(diagnostic("composition", "answer_out_of_range",
        `${questionPath}.answer`,
        `answer is ${question.answer} but the question has ` +
        `${question.options.length} option(s), indexed 0 to ` +
        `${question.options.length - 1}`, question.prompt));
    }
  });
}

/**
 * The module graph. `requires` is optional, so a flat list of modules is a
 * legal graph with no edges — which is exactly the single-module case, and must
 * stay legal. Orphans are therefore defined against the roots: with no edges
 * every module is a root, so nothing is orphaned. Once edges exist, a module
 * unreachable from every root is a module the reader can never legitimately
 * arrive at.
 */
function checkModuleGraph(modules, out) {
  const index = new Map(modules.map((module, i) => [module.id, i]));
  const edges = modules.map(() => []);

  modules.forEach((module, m) => {
    for (const required of module.requires ?? []) {
      if (!index.has(required)) {
        out.push(diagnostic("composition", "unresolved_reference",
          `lesson.modules[${m}].requires`,
          `module "${module.title}" requires \`${required}\`, which is not a ` +
          `module of this lesson`, module.title));
        continue;
      }
      if (index.get(required) === m) {
        out.push(diagnostic("composition", "graph_cycle",
          `lesson.modules[${m}].requires`,
          `module "${module.title}" requires itself`, module.title));
        continue;
      }
      edges[index.get(required)].push(m);
    }
  });

  if (findCycle(edges)) {
    out.push(diagnostic("composition", "graph_cycle", "lesson.modules",
      "the module graph contains a cycle; prerequisites that lead back to " +
      "themselves cannot be satisfied in any order"));
    return;
  }

  const roots = modules
    .map((module, m) => ({ module, m }))
    .filter(({ module }) => (module.requires ?? []).length === 0)
    .map(({ m }) => m);

  const reached = new Set();
  for (const root of roots) for (const node of reachableFrom(edges, root)) reached.add(node);

  modules.forEach((module, m) => {
    if (!reached.has(m)) {
      out.push(diagnostic("composition", "orphan_module", `lesson.modules[${m}]`,
        `module "${module.title}" is not reachable from any module without ` +
        `prerequisites`, module.title));
    }
  });
}

/** Depth-first reachability. Node order is the adjacency order, never a Set's. */
function reachableFrom(edges, start) {
  const seen = new Set();
  const stack = [start];
  while (stack.length > 0) {
    const node = stack.pop();
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of edges[node]) stack.push(next);
  }
  return seen;
}

/** Iterative depth-first cycle detection over an adjacency list. */
function findCycle(edges) {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = edges.map(() => WHITE);

  for (let start = 0; start < edges.length; start += 1) {
    if (colour[start] !== WHITE) continue;
    const stack = [{ node: start, cursor: 0 }];
    colour[start] = GREY;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.cursor >= edges[frame.node].length) {
        colour[frame.node] = BLACK;
        stack.pop();
        continue;
      }
      const next = edges[frame.node][frame.cursor];
      frame.cursor += 1;
      if (colour[next] === GREY) return true;
      if (colour[next] === WHITE) {
        colour[next] = GREY;
        stack.push({ node: next, cursor: 0 });
      }
    }
  }
  return false;
}
