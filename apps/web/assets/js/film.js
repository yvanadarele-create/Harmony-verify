/* Harmony Verify — the brand film on the home page.
 *
 * The clip builds from a bare processor to a fully assembled ring, so it has no
 * clean loop point: running it on repeat would snap back to an empty field every
 * twelve seconds, in the corner of the eye, forever. It plays once when it comes
 * into view and holds its final frame, which is the frame worth holding.
 *
 * Three things this deliberately does not do:
 *
 *   - Download 1.3 MB that nobody asked for. preload is "none" in the markup and
 *     is raised to "auto" only when the section is one screen away, so a visitor
 *     who never scrolls past the hero never pays for the video.
 *   - Move when the visitor has asked for stillness. prefers-reduced-motion means
 *     the poster stays and the play button waits; motion becomes a choice.
 *   - Assume autoplay worked. Browsers refuse muted autoplay in low-power mode
 *     and under some settings, and a silently dead video looks like a broken one,
 *     so a rejected play() puts the button back rather than hiding the failure.
 */
(function () {
  "use strict";

  var stage = document.querySelector("[data-film]");
  if (!stage) return;

  var video = stage.querySelector("[data-film-video]");
  var button = stage.querySelector("[data-film-btn]");
  var label = stage.querySelector("[data-film-label]");
  if (!video || !button) return;

  var stillPlease = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  var played = false;

  function setState(state) {
    // playing | paused | ended — CSS decides what the button looks like in each.
    stage.dataset.state = state;
    if (!label) return;
    var t = window.HarmonyText || function (_k, english) { return english; };
    label.textContent =
      state === "ended" ? t("film.replay", "Replay")
        : state === "playing" ? t("film.pause", "Pause")
          : t("film.play", "Play");
  }

  function start() {
    var attempt = video.play();
    if (!attempt || typeof attempt.catch !== "function") return;
    attempt.catch(function () {
      // Autoplay refused. Leave the poster and the button exactly as they were.
      setState("paused");
    });
  }

  button.addEventListener("click", function () {
    if (video.ended) {
      video.currentTime = 0;
      start();
    } else if (video.paused) {
      start();
    } else {
      video.pause();
    }
  });

  video.addEventListener("play", function () {
    played = true;
    setState("playing");
  });
  video.addEventListener("pause", function () {
    if (!video.ended) setState("paused");
  });
  video.addEventListener("ended", function () {
    setState("ended");
  });

  setState("paused");

  /* Two observers, because the useful distances differ. Fetch a little before
     the section arrives — 400px, not a whole viewport: this is the second
     section on the page, so a one-screen lookahead would fire on load and every
     visitor who reads the hero and leaves would still have paid for the video.
     Play at a third of the frame visible. */
  if (!("IntersectionObserver" in window)) {
    video.preload = "metadata";
    return;
  }

  new IntersectionObserver(
    function (entries, self) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        video.preload = "auto";
        video.load();
        self.disconnect();
      });
    },
    { rootMargin: "400px 0px" }
  ).observe(stage);

  if (stillPlease && stillPlease.matches) return;

  new IntersectionObserver(
    function (entries, self) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || played) return;
        start();
        self.disconnect();
      });
    },
    { threshold: 0.35 }
  ).observe(stage);
})();
