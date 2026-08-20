/* Harmony Verify — site behaviour */
(function () {
  "use strict";

  document.documentElement.classList.remove("no-js");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- Sticky nav state ------------------------------------------------- */

  var nav = document.querySelector(".nav");
  if (nav) {
    var setScrolled = function () {
      nav.dataset.scrolled = window.scrollY > 12 ? "true" : "false";
    };
    setScrolled();
    window.addEventListener("scroll", setScrolled, { passive: true });
  }

  /* --- Mobile menu ------------------------------------------------------ */

  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");

  if (toggle && links) {
    var setMenu = function (open) {
      toggle.setAttribute("aria-expanded", String(open));
      links.dataset.open = String(open);
    };

    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });

    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setMenu(false);
        toggle.focus();
      }
    });

    // Menu is mobile-only; drop it if the viewport grows past the breakpoint.
    window.matchMedia("(min-width: 821px)").addEventListener("change", function (e) {
      if (e.matches) setMenu(false);
    });
  }

  /* --- Scroll reveals --------------------------------------------------- */

  var revealables = document.querySelectorAll("[data-reveal]");

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealables.forEach(function (el) {
      el.classList.add("is-in");
    });
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          var i = Number(el.dataset.reveal) || 0;
          el.style.setProperty("--delay", i * 0.09 + "s");
          el.classList.add("is-in");
          observer.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 }
    );
    revealables.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* --- Verification record walkthrough ---------------------------------- */

  var recordSteps = document.querySelector("[data-steps]");

  if (recordSteps && !reduceMotion) {
    var items = Array.prototype.slice.call(recordSteps.querySelectorAll("li"));
    var note = document.querySelector("[data-note]");
    var chip = document.querySelector("[data-chip]");
    var t = window.HarmonyText || function (_key, english) { return english; };
    var chipStates = [
      { cls: "chip chip--review", text: t("chip.awaiting", "Awaiting review") },
      { cls: "chip chip--review", text: t("chip.review", "In review") },
      { cls: "chip chip--flagged", text: t("chip.corrected", "Correction issued") },
      { cls: "chip chip--verified", text: t("chip.verified", "Verified") }
    ];
    var index = 0;
    var timer = null;

    var render = function () {
      items.forEach(function (li, i) {
        li.dataset.state = i < index ? "done" : i === index ? "active" : "idle";
      });
      var state = chipStates[Math.min(index, chipStates.length - 1)];
      if (chip) {
        chip.className = state.cls;
        chip.textContent = state.text;
      }
      if (note) {
        // The correction only becomes visible once the reviewer has acted.
        note.dataset.corrected = index >= 2 ? "true" : "false";
      }
    };

    var advance = function () {
      index = (index + 1) % (items.length + 1);
      render();
    };

    render();

    var start = function () {
      if (!timer) timer = window.setInterval(advance, 2300);
    };
    var stop = function () {
      window.clearInterval(timer);
      timer = null;
    };

    // Only animate while the panel is actually on screen.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        function (entries) {
          entries[0].isIntersecting ? start() : stop();
        },
        { threshold: 0.25 }
      ).observe(recordSteps);
    } else {
      start();
    }

    document.addEventListener("visibilitychange", function () {
      document.hidden ? stop() : start();
    });
  }

  /* --- Contact form ----------------------------------------------------- */

  var form = document.querySelector("[data-form]");

  if (form) {
    var status = form.querySelector("[data-form-status]");
    var submit = form.querySelector('button[type="submit"]');
    var endpoint = form.dataset.endpoint || "";

    var say = function (tone, message) {
      if (!status) return;
      status.hidden = false;
      status.dataset.tone = tone;
      status.textContent = message;
    };

    var showFieldError = function (field, message) {
      field.setAttribute("aria-invalid", "true");
      var slot = form.querySelector('[data-error-for="' + field.name + '"]');
      if (slot) slot.textContent = message;
    };

    var clearFieldError = function (field) {
      field.removeAttribute("aria-invalid");
      var slot = form.querySelector('[data-error-for="' + field.name + '"]');
      if (slot) slot.textContent = "";
    };

    form.querySelectorAll("input, select, textarea").forEach(function (field) {
      field.addEventListener("input", function () {
        if (field.getAttribute("aria-invalid") === "true" && field.checkValidity()) {
          clearFieldError(field);
        }
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var fields = Array.prototype.slice.call(
        form.querySelectorAll("input, select, textarea")
      );
      var firstInvalid = null;

      fields.forEach(function (field) {
        if (field.checkValidity()) {
          clearFieldError(field);
        } else {
          showFieldError(
            field,
            field.validity.valueMissing ? "Required" : "Check this value"
          );
          if (!firstInvalid) firstInvalid = field;
        }
      });

      if (firstInvalid) {
        say("err", (window.HarmonyText || function (_k, e) { return e; })("form.check", "Please complete the highlighted fields."));
        firstInvalid.focus();
        return;
      }

      var data = new FormData(form);

      // No backend is wired up yet, so hand the enquiry to the user's mail client.
      if (!endpoint) {
        var lines = [];
        data.forEach(function (value, key) {
          if (value) lines.push(key + ": " + value);
        });
        var mailto =
          "mailto:" +
          (form.dataset.mailto || "hello@harmonyverify.org") +
          "?subject=" +
          encodeURIComponent(form.dataset.subject || "Harmony Verify — access request") +
          "&body=" +
          encodeURIComponent(lines.join("\n"));
        window.location.href = mailto;
        say("ok", (window.HarmonyText || function (_k, e) { return e; })("form.sending", "Opening your email client to send this request."));
        return;
      }

      if (submit) {
        submit.disabled = true;
        submit.dataset.label = submit.textContent;
        submit.textContent = "Sending…";
      }

      fetch(endpoint, {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" }
      })
        .then(function (res) {
          if (!res.ok) throw new Error("Request failed");
          form.reset();
          say("ok", (window.HarmonyText || function (_k, e) { return e; })("form.sent", "Thank you — we have your request and will reply within two business days."));
        })
        .catch(function () {
          say(
            "err",
            "Something went wrong. Please email " +
              (form.dataset.mailto || "hello@harmonyverify.org") +
              " directly."
          );
        })
        .finally(function () {
          if (submit) {
            submit.disabled = false;
            submit.textContent = submit.dataset.label || "Submit";
          }
        });
    });
  }

  /* --- Footer year ------------------------------------------------------ */

  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
