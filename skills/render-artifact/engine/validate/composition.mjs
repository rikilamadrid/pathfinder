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
  return spec.kind === "diagram"
    ? validateDiagramComposition(spec)
    : validateLessonComposition(spec);
}

/**
 * @param {object} spec a `lesson` specification that passed the structural layer
 * @returns {import("./diagnostics.mjs").Diagnostic[]}
 */
function validateLessonComposition(spec) {
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

/**
 * The `graph` topology's coherence rules.
 *
 * Everything here is a rule the schema cannot express, and nothing here is a
 * rule the schema already made unrepresentable. A node belongs to at most one
 * group because `group` is a single identifier, so there is no
 * multiple-membership check below: preventing the state beats detecting it.
 *
 * Deliberately legal, and each for a reason about real systems:
 *
 *   self-edges      a service calling itself, a state retrying itself
 *   cycles          retry loops, bidirectional calls
 *   isolated nodes  something real that is not wired up yet
 *
 * Group nesting is the one invalid state a flat array can still represent, and
 * a single rule covers all three of its shapes: depth greater than one, a
 * two-group cycle, and a group parented to itself. Each of them is a group
 * whose parent is not a root.
 */
function validateDiagramComposition(spec) {
  const out = [];
  const { nodes, edges } = spec.diagram;
  const groups = spec.diagram.groups ?? [];
  const paths = spec.diagram.paths ?? [];
  const views = spec.diagram.views ?? [];

  /** Every identifier the renderer turns into a DOM id, across the artifact. */
  const anchors = new Map();
  const nodeIds = new Map();
  const groupIds = new Map();
  const edgeIds = new Map();

  groups.forEach((group, g) => {
    claimAnchor(anchors, out, group.id, `diagram.groups[${g}].id`,
      `group "${group.label}"`);
    groupIds.set(group.id, g);
  });

  nodes.forEach((node, n) => {
    claimAnchor(anchors, out, node.id, `diagram.nodes[${n}].id`, `node "${node.label}"`);
    nodeIds.set(node.id, n);
  });

  edges.forEach((edge, e) => {
    claimAnchor(anchors, out, edge.id, `diagram.edges[${e}].id`, `edge \`${edge.id}\``);
    edgeIds.set(edge.id, e);
  });

  paths.forEach((path, p) => {
    claimAnchor(anchors, out, path.id, `diagram.paths[${p}].id`, `path "${path.label}"`);
  });

  views.forEach((view, v) => {
    claimAnchor(anchors, out, view.id, `diagram.views[${v}].id`, `view "${view.label}"`);
  });

  // Group membership and nesting.
  nodes.forEach((node, n) => {
    if (node.group !== undefined && !groupIds.has(node.group)) {
      out.push(diagnostic("composition", "unresolved_reference",
        `diagram.nodes[${n}].group`,
        `node "${node.label}" belongs to \`${node.group}\`, which is not a group ` +
        `of this diagram`, node.label));
    }
  });

  groups.forEach((group, g) => {
    if (group.parent === undefined) return;
    if (!groupIds.has(group.parent)) {
      out.push(diagnostic("composition", "unresolved_reference",
        `diagram.groups[${g}].parent`,
        `group "${group.label}" is inside \`${group.parent}\`, which is not a ` +
        `group of this diagram`, group.label));
      return;
    }
    const parent = groups[groupIds.get(group.parent)];
    if (parent.parent !== undefined) {
      out.push(diagnostic("composition", "group_parent_not_root",
        `diagram.groups[${g}].parent`,
        `group "${group.label}" is inside "${parent.label}", which is itself ` +
        `inside \`${parent.parent}\`. Nesting is one level: a parent must be a ` +
        `root. This is also what a group cycle and a self-parented group look ` +
        `like from here.`, group.label));
    }
  });

  // Edges.
  const seenRelations = new Map();
  edges.forEach((edge, e) => {
    for (const [end, id] of [["from", edge.from], ["to", edge.to]]) {
      if (!nodeIds.has(id)) {
        out.push(diagnostic("composition", "unresolved_reference",
          `diagram.edges[${e}].${end}`,
          `edge \`${edge.id}\` runs ${end} \`${id}\`, which is not a node of this ` +
          `diagram`, edge.id));
      }
    }

    // The same relationship asserted twice is a modelling slip, not a second
    // fact. Two *different* relations between one pair stay legal: an API that
    // both calls and publishes to a thing is two claims.
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.relation}`;
    const previous = seenRelations.get(key);
    if (previous !== undefined) {
      out.push(diagnostic("composition", "duplicate_edge", `diagram.edges[${e}]`,
        `\`${edge.relation}\` from \`${edge.from}\` to \`${edge.to}\` is already ` +
        `asserted by edge \`${previous}\`; the same relationship twice is one ` +
        `fact written twice`, edge.id));
    } else {
      seenRelations.set(key, edge.id);
    }
  });

  // Paths address edges, so the walk is checkable rather than inferred.
  paths.forEach((path, p) => {
    let previous = null;
    path.edges.forEach((id, i) => {
      if (!edgeIds.has(id)) {
        out.push(diagnostic("composition", "unresolved_reference",
          `diagram.paths[${p}].edges[${i}]`,
          `path "${path.label}" walks \`${id}\`, which is not an edge of this ` +
          `diagram`, path.label));
        previous = null;
        return;
      }
      const edge = edges[edgeIds.get(id)];
      if (previous !== null && previous.to !== edge.from) {
        out.push(diagnostic("composition", "path_discontinuous",
          `diagram.paths[${p}].edges[${i}]`,
          `path "${path.label}" goes \`${previous.id}\`, which ends at ` +
          `\`${previous.to}\`, then \`${edge.id}\`, which starts at \`${edge.from}\`. ` +
          `A path is a walk: each edge begins where the last one ended.`,
          path.label));
      }
      previous = edge;
    });
  });

  // Views.
  views.forEach((view, v) => {
    view.focus.forEach((id, i) => {
      if (!nodeIds.has(id)) {
        out.push(diagnostic("composition", "unresolved_reference",
          `diagram.views[${v}].focus[${i}]`,
          `view "${view.label}" focuses \`${id}\`, which is not a node of this ` +
          `diagram`, view.label));
      }
    });
  });

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
