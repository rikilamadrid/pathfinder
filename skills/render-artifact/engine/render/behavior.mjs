/**
 * The artifact's inline behaviour: theme choice, navigation position, and quiz
 * feedback.
 *
 * All three are enhancements. With scripting off the artifact is still a
 * complete, readable, keyboard-navigable document: the theme follows the
 * reader's system through `prefers-color-scheme`, navigation is a list of
 * ordinary anchors, and every quiz answer is already reachable inside a
 * `<details>`. Nothing here is load-bearing, which is what lets the artifact
 * open from `file://` with no network, no server, and no build step.
 *
 * Storage is wrapped: `localStorage` throws outright in some `file://` and
 * private-window configurations, and a theme preference is not worth a page
 * that fails to run.
 */

export const BEHAVIOR_JS = `
(function () {
  "use strict";

  var root = document.documentElement;
  var MODES = ["auto", "light", "dark"];
  var LABELS = { auto: "Theme: auto", light: "Theme: light", dark: "Theme: dark" };
  var KEY = "pathfinder.artifact.theme";

  function stored() {
    try {
      var value = window.localStorage.getItem(KEY);
      return MODES.indexOf(value) >= 0 ? value : null;
    } catch (error) {
      return null;
    }
  }

  function remember(mode) {
    try {
      window.localStorage.setItem(KEY, mode);
    } catch (error) {
      /* A reader who cannot store a preference still gets to use it. */
    }
  }

  function apply(mode, button) {
    root.setAttribute("data-pf-theme", mode);
    if (button) {
      button.textContent = LABELS[mode];
      button.setAttribute("aria-label", LABELS[mode] + ". Activate to change.");
    }
  }

  var toggle = document.getElementById("pf-theme-toggle");
  var initial = stored() || "auto";
  apply(initial, toggle);

  if (toggle) {
    toggle.hidden = false;
    toggle.addEventListener("click", function () {
      var next = MODES[(MODES.indexOf(root.getAttribute("data-pf-theme")) + 1) % MODES.length];
      apply(next, toggle);
      remember(next);
    });
  }

  /* Mark the module the reader is in. Falls back to doing nothing where
     IntersectionObserver is unavailable; the nav still navigates. */
  var links = Array.prototype.slice.call(document.querySelectorAll("[data-pf-nav]"));
  if (links.length > 0 && "IntersectionObserver" in window) {
    var byId = {};
    links.forEach(function (link) { byId[link.getAttribute("data-pf-nav")] = link; });

    var visible = {};
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        visible[entry.target.id] = entry.isIntersecting;
      });
      var current = null;
      for (var i = 0; i < links.length; i += 1) {
        var id = links[i].getAttribute("data-pf-nav");
        if (visible[id]) { current = id; break; }
      }
      links.forEach(function (link) {
        var isCurrent = link.getAttribute("data-pf-nav") === current;
        if (isCurrent) {
          link.setAttribute("aria-current", "true");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    }, { rootMargin: "-30% 0px -60% 0px" });

    Object.keys(byId).forEach(function (id) {
      var target = document.getElementById(id);
      if (target) observer.observe(target);
    });
  }

  /* Quiz feedback. The correct answer is in the document either way; choosing
     an option just says so sooner, and opens the explanation that was always
     one click away. */
  document.addEventListener("change", function (event) {
    var input = event.target;
    if (!input || input.type !== "radio" || !input.hasAttribute("data-pf-answer")) return;

    var question = input.closest("[data-pf-question]");
    if (!question) return;

    var chosenIsCorrect = input.getAttribute("data-pf-answer") === "correct";
    Array.prototype.forEach.call(question.querySelectorAll(".pf-option"), function (option) {
      var field = option.querySelector("input[type=radio]");
      var verdict = option.querySelector(".pf-verdict");
      var correct = field.getAttribute("data-pf-answer") === "correct";
      if (field.checked && !correct) {
        option.setAttribute("data-pf-verdict", "incorrect");
        if (verdict) verdict.textContent = "Not this one";
      } else if (correct && (field.checked || !chosenIsCorrect)) {
        option.setAttribute("data-pf-verdict", "correct");
        if (verdict) verdict.textContent = "Correct";
      } else {
        option.removeAttribute("data-pf-verdict");
        if (verdict) verdict.textContent = "";
      }
    });

    var reveal = question.querySelector(".pf-reveal");
    if (reveal) reveal.open = true;
  });
})();
`.trim();
