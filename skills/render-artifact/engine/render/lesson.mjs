/**
 * The `lesson` renderer.
 *
 * One path serves both consumers. `learn-feature` supplies one module and
 * `learn-codebase` supplies many, and nothing below asks which: the module list
 * is rendered by iteration, the navigation is built from the same list, and
 * there is no mode flag, no consumer branch, and no count-dependent layout.
 * When 50.4 brings the multi-module case it proves this rather than adding to
 * it.
 *
 * Every label here is renderer-supplied interface language. The producer names
 * modules, concepts, steps, and questions; the renderer names the furniture
 * around them and never touches what they assert.
 */

import { esc, domId } from "./escape.mjs";
import { renderShell, renderNav } from "./shell.mjs";

/** Renderer-owned interface language. The producer supplies none of this. */
const UI = Object.freeze({
  eyebrow: "Pathfinder lesson",
  navLabel: "Modules",
  objectives: "What you should be able to do",
  evidence: "Evidence",
  requires: "Builds on",
  leadsTo: "Leads to",
  concept: "Concept",
  walkthrough: "Walkthrough",
  practice: "Practice",
  quiz: "Check your understanding",
  showAnswer: "Show the answer",
  hints: "Hints",
  correct: "Correct",
});

// Note what is *not* in UI: any sentence about the artifact having been
// checked. That claim describes the engine's own work rather than the lesson's
// subject, so it belongs to the shell and is gated on an attestation there. A
// kind renderer has nothing to say about whether it was validated.

/**
 * @param {object} spec a `lesson` specification
 * @param {object} [verification] an attestation, passed through to the shell.
 *        Absent for an ordinary render, which then makes no claim about having
 *        been checked.
 * @returns {string} a complete HTML document
 */
export function renderLesson(spec, verification) {
  const modules = spec.lesson.modules;
  const titleById = new Map(modules.map((module) => [module.id, module.title]));

  const nav = renderNav(
    modules.map((module) => ({ id: domId("m", module.id), label: module.title })),
    UI.navLabel,
  );

  const body = [
    renderLead(spec),
    ...modules.map((module, index) => renderModule(module, index, titleById)),
  ].join("\n");

  return renderShell({
    lang: spec.artifact.locale ?? "en",
    title: spec.artifact.title,
    eyebrow: UI.eyebrow,
    description: spec.artifact.summary ?? spec.artifact.subtitle,
    nav,
    body,
    source: spec.source,
    verification,
  });
}

function renderLead(spec) {
  const { artifact, lesson } = spec;
  const out = ['<div class="pf-lead">', `<h1>${esc(artifact.title)}</h1>`];

  if (artifact.subtitle) {
    out.push(`<p class="pf-lead-sub">${esc(artifact.subtitle)}</p>`);
  }
  if (artifact.summary) {
    out.push(`<div class="pf-lead-summary"><p>${esc(artifact.summary)}</p></div>`);
  }
  if (lesson.objectives) {
    out.push(
      '<div class="pf-objectives">',
      `<div class="pf-kicker">${esc(UI.objectives)}</div>`,
      "<ul>",
      ...lesson.objectives.map((objective) => `<li>${esc(objective)}</li>`),
      "</ul>",
      "</div>",
    );
  }
  out.push("</div>");
  return out.join("\n");
}

function renderModule(module, index, titleById) {
  const id = domId("m", module.id);
  const out = [
    `<section class="pf-module" id="${esc(id)}" aria-labelledby="${esc(domId(id, "h"))}">`,
    '<div class="pf-module-head">',
    `<div class="pf-module-index">Module ${index + 1}</div>`,
    `<h2 class="pf-module-title" id="${esc(domId(id, "h"))}">${esc(module.title)}</h2>`,
  ];

  if (module.summary) {
    out.push(`<p class="pf-module-summary">${esc(module.summary)}</p>`);
  }
  if ((module.requires ?? []).length > 0) {
    const links = module.requires.map((required) =>
      `<a href="#${esc(domId("m", required))}">${esc(titleById.get(required))}</a>`);
    out.push(`<p class="pf-requires">${esc(UI.requires)}: ${links.join(", ")}</p>`);
  }
  out.push("</div>");

  for (const section of module.sections) out.push(renderSection(section));
  out.push("</section>");
  return out.join("\n");
}

function renderSection(section) {
  switch (section.type) {
    case "prose": return renderProse(section);
    case "concept": return renderConcept(section);
    case "code": return renderCode(section);
    case "flow": return renderFlow(section);
    case "quiz": return renderQuiz(section);
    case "exercise": return renderExercise(section);
    // Unreachable: the structural layer rejects any other type before a
    // specification reaches the renderer. Thrown rather than rendered as a
    // fallback, because the one thing a renderer must never do with an
    // unsupported shape is improvise something.
    default: throw new Error(`no renderer for section type ${JSON.stringify(section.type)}`);
  }
}

/** The section wrapper every type shares: id, optional heading, one card. */
function wrap(section, kicker, inner, extraClass = "") {
  const id = domId("s", section.id);
  const out = [`<section class="pf-section" id="${esc(id)}">`];
  if (section.title) {
    out.push(`<h3 class="pf-section-title" id="${esc(domId(id, "h"))}">${esc(section.title)}</h3>`);
  }
  out.push(`<div class="pf-card${extraClass}">`);
  if (kicker) out.push(`<span class="pf-kicker">${esc(kicker)}</span>`);
  out.push(inner, "</div>", "</section>");
  return out.join("\n");
}

function paragraphs(body) {
  return body.map((text) => `<p>${esc(text)}</p>`).join("\n");
}

function renderProse(section) {
  return wrap(section, null, paragraphs(section.body));
}

function renderConcept(section) {
  return wrap(
    section,
    UI.concept,
    [paragraphs(section.body), renderEvidence(section.evidence)].filter(Boolean).join("\n"),
    " pf-card--concept",
  );
}

/**
 * A code excerpt, emitted verbatim and escaped. The `language` names the
 * language for the reader; it selects no highlighter, because highlighting is
 * either a dependency or a hand-rolled tokeniser, and both are ways for the
 * renderer to start asserting things about content it was given literally.
 */
function renderCode(section) {
  const first = section.first_line ?? 1;
  const inner = [
    `<span class="pf-code-lang">${esc(section.language)}</span>`,
    "<pre><code>",
    ...section.lines.map((line, index) =>
      `<span class="pf-code-line"><span class="pf-code-no">${first + index}</span>` +
      `${esc(line)}</span>`),
    "</code></pre>",
  ].join("\n");

  const out = [`<section class="pf-section" id="${esc(domId("s", section.id))}">`];
  if (section.title) out.push(`<h3 class="pf-section-title">${esc(section.title)}</h3>`);
  out.push('<figure class="pf-code">');
  if (section.caption) out.push(`<figcaption>${esc(section.caption)}</figcaption>`);
  out.push(`<div class="pf-code-frame">${inner}</div>`);
  const evidence = renderEvidence(section.evidence);
  if (evidence) out.push(`<div class="pf-card">${evidence}</div>`);
  out.push("</figure>", "</section>");
  return out.join("\n");
}

function renderFlow(section) {
  const titleById = new Map(section.steps.map((step) => [step.id, step.title]));
  const steps = section.steps.map((step) => {
    const out = ["<li>", `<div class="pf-step-title">${esc(step.title)}</div>`];
    if (step.detail) out.push(`<p class="pf-step-detail">${esc(step.detail)}</p>`);
    if ((step.next ?? []).length > 0) {
      const names = step.next.map((id) => esc(titleById.get(id) ?? id)).join(", ");
      out.push(`<p class="pf-step-next">${esc(UI.leadsTo)}: ${names}</p>`);
    }
    const evidence = renderEvidence(step.evidence);
    if (evidence) out.push(evidence);
    out.push("</li>");
    return out.join("\n");
  });
  return wrap(section, UI.walkthrough, `<ol class="pf-flow">\n${steps.join("\n")}\n</ol>`);
}

function renderQuiz(section) {
  const questions = section.questions.map((question) => {
    const name = domId("q", section.id, question.id);
    const options = question.options.map((option, index) => {
      const optionId = domId(name, String(index));
      const correct = index === question.answer;
      return [
        `<label class="pf-option" for="${esc(optionId)}">`,
        `<input type="radio" id="${esc(optionId)}" name="${esc(name)}" ` +
        `value="${index}" data-pf-answer="${correct ? "correct" : "other"}">`,
        `<span>${esc(option)}</span>`,
        '<span class="pf-verdict" aria-live="polite"></span>',
        "</label>",
      ].join("");
    });

    const reveal = [
      '<details class="pf-reveal">',
      `<summary>${esc(UI.showAnswer)}</summary>`,
      `<p><strong>${esc(UI.correct)}:</strong> ${esc(question.options[question.answer])}</p>`,
      question.explanation ? `<p>${esc(question.explanation)}</p>` : null,
      renderEvidence(question.evidence),
      "</details>",
    ].filter(Boolean).join("\n");

    return [
      `<fieldset class="pf-question" data-pf-question="${esc(name)}">`,
      `<legend>${esc(question.prompt)}</legend>`,
      `<div class="pf-options">${options.join("")}</div>`,
      reveal,
      "</fieldset>",
    ].join("\n");
  });

  return wrap(section, UI.quiz, `<div class="pf-quiz">\n${questions.join("\n")}\n</div>`);
}

function renderExercise(section) {
  const out = [paragraphs(section.body)];
  if (section.hints) {
    out.push([
      '<details class="pf-reveal">',
      `<summary>${esc(UI.hints)}</summary>`,
      "<ol>",
      ...section.hints.map((hint) => `<li>${esc(hint)}</li>`),
      "</ol>",
      "</details>",
    ].join("\n"));
  }
  const evidence = renderEvidence(section.evidence);
  if (evidence) out.push(evidence);
  return wrap(section, UI.practice, out.join("\n"));
}

/**
 * Citations, in one presentation used everywhere evidence appears.
 *
 * The shape is the same in a concept, a flow step, and a quiz answer, and it
 * will be the same in whatever kind comes next. A reader who learns to read one
 * of these has learnt to read all of them.
 */
function renderEvidence(evidence) {
  if (!evidence || evidence.length === 0) return "";
  return [
    '<div class="pf-evidence">',
    `<div class="pf-evidence-label">${esc(UI.evidence)}</div>`,
    "<ul>",
    ...evidence.map((citation) => {
      const parts = [`<span class="pf-cite-path">${esc(citation.path)}</span>`];
      if (citation.lines) {
        parts.push(`<span class="pf-cite-lines">lines ${citation.lines[0]}` +
          `–${citation.lines[1]}</span>`);
      }
      if (citation.commit) {
        parts.push(`<span class="pf-cite-commit">@ ${esc(citation.commit)}</span>`);
      }
      return `<li>${parts.join("")}</li>`;
    }),
    "</ul>",
    "</div>",
  ].join("\n");
}
