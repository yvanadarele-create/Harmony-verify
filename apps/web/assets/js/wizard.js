/* Harmony Verify — multi-step form.
 *
 * Used only where the steps genuinely help: the expert application asks
 * seventeen questions of a busy clinician, and showing all of them at once is
 * how you get abandonment at question four.
 *
 * Two rules that separate a usable wizard from an irritating one:
 *
 *   Nothing is lost. Every field stays in the DOM — panes are hidden, never
 *   destroyed — so going back does not clear what was typed, and the final
 *   submit carries every answer whatever order they were filled in.
 *
 *   You cannot advance past a field you have not filled. Validation runs per
 *   step rather than only at the end, because discovering on step three that
 *   step one was wrong means scrolling back through work you thought was done.
 */
(function () {
  "use strict";

  document.querySelectorAll("[data-wizard]").forEach(function (form) {
    var panes = Array.prototype.slice.call(form.querySelectorAll("[data-wiz-pane]"));
    if (panes.length === 0) return;

    var bars = Array.prototype.slice.call(form.querySelectorAll("[data-wiz-step]"));
    var back = form.querySelector("[data-wiz-back]");
    var next = form.querySelector("[data-wiz-next]");
    var submit = form.querySelector("[data-wiz-submit]");
    var current = form.querySelector("[data-wiz-current]");
    var name = form.querySelector("[data-wiz-name]");

    var index = 0;

    var fieldsIn = function (pane) {
      return Array.prototype.slice.call(pane.querySelectorAll("input, select, textarea"));
    };

    function showError(field, message) {
      field.setAttribute("aria-invalid", "true");
      var slot = form.querySelector('[data-error-for="' + field.name + '"]');
      if (slot) slot.textContent = message;
    }

    function clearError(field) {
      field.removeAttribute("aria-invalid");
      var slot = form.querySelector('[data-error-for="' + field.name + '"]');
      if (slot) slot.textContent = "";
    }

    /** True when every required field on this step is satisfied. */
    function validate(pane) {
      var firstInvalid = null;
      fieldsIn(pane).forEach(function (field) {
        if (field.checkValidity()) {
          clearError(field);
          return;
        }
        showError(field, field.validity.valueMissing ? "Required" : "Check this value");
        if (!firstInvalid) firstInvalid = field;
      });
      if (firstInvalid) firstInvalid.focus();
      return !firstInvalid;
    }

    function render() {
      panes.forEach(function (pane, i) {
        pane.hidden = i !== index;
      });
      bars.forEach(function (bar, i) {
        bar.dataset.state = i < index ? "done" : i === index ? "active" : "idle";
      });

      if (back) back.hidden = index === 0;
      var last = index === panes.length - 1;
      if (next) next.hidden = last;
      if (submit) submit.hidden = !last;

      if (current) current.textContent = String(index + 1);
      if (name) name.textContent = panes[index].dataset.wizTitle || "";

      // Move focus to the step heading so a screen reader announces the change
      // rather than leaving the user on a button that just disappeared.
      var legend = panes[index].querySelector("legend");
      if (legend) {
        legend.setAttribute("tabindex", "-1");
        legend.focus({ preventScroll: true });
      }
      form.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    if (next) {
      next.addEventListener("click", function () {
        if (!validate(panes[index])) return;
        index = Math.min(panes.length - 1, index + 1);
        render();
      });
    }

    if (back) {
      back.addEventListener("click", function () {
        index = Math.max(0, index - 1);
        render();
      });
    }

    // Enter should advance a step, not submit a half-finished application.
    form.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      if (e.target.tagName === "TEXTAREA") return;
      if (index < panes.length - 1) {
        e.preventDefault();
        if (next) next.click();
      }
    });

    form.querySelectorAll("input, select, textarea").forEach(function (field) {
      field.addEventListener("input", function () {
        if (field.getAttribute("aria-invalid") === "true" && field.checkValidity()) {
          clearError(field);
        }
      });
    });

    // A step the visitor never opened can still hold a required field, so the
    // final submit checks all of them, not just the one on screen.
    form.addEventListener(
      "submit",
      function (e) {
        for (var i = 0; i < panes.length; i++) {
          if (validate(panes[i])) continue;
          e.preventDefault();
          e.stopImmediatePropagation();
          index = i;
          render();
          return;
        }
      },
      true,
    );

    render();
  });
})();
