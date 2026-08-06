/* Harmony Verify — testimonials.
 *
 * The section renders only when there is something real to put in it. An empty
 * list means the whole block is removed from the page rather than showing a
 * placeholder.
 *
 * That is deliberate. Invented customer quotes are not a stylistic choice, they
 * are a deception aimed at the visitor — and on a site whose entire position is
 * that Harmony states only what it can source, a fabricated endorsement would
 * undermine the product more effectively than having no testimonials at all.
 * So this ships empty, and goes live the moment a real quote is added.
 *
 * To publish one, add an entry below. Every field is required, and you should
 * hold written permission from the person named before it goes live:
 *
 *   {
 *     quote: "What they actually said.",
 *     name:  "Dr Jane Okafor",
 *     role:  "Chief Medical Officer",
 *     org:   "Northwind Clinical AI"
 *   }
 */
window.HarmonyTestimonials = [
  // No published testimonials yet. See the note above before adding one.
];

(function () {
  "use strict";

  var section = document.querySelector("[data-testimonials]");
  if (!section) return;

  var entries = (window.HarmonyTestimonials || []).filter(function (t) {
    return t && t.quote && t.name && t.role;
  });

  if (entries.length === 0) {
    section.remove();
    return;
  }

  var grid = section.querySelector("[data-quotes]");
  if (!grid) return;

  var text = function (tag, value, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  };

  entries.forEach(function (entry, index) {
    var card = document.createElement("figure");
    card.className = "quote-card";
    card.setAttribute("data-reveal", String(index % 3));

    card.appendChild(text("blockquote", entry.quote));

    var caption = document.createElement("figcaption");
    caption.appendChild(text("b", entry.name));
    caption.appendChild(
      document.createTextNode(entry.org ? entry.role + ", " + entry.org : entry.role),
    );
    card.appendChild(caption);

    grid.appendChild(card);
  });

  section.hidden = false;
})();
