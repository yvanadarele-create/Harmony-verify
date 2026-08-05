/**
 * Catalogue rendering: the creation grids on the home page, "Nos créations" and each
 * category page. One renderer, driven by data attributes on the container.
 */
(function () {
  "use strict";

  const D = window.Delices;

  function priceLabel(product, config) {
    if (product.basePrice === null || product.basePrice === undefined) return "Sur devis";
    const amount = D.formatMoney(product.basePrice, config);
    return product.priceFrom ? "À partir de " + amount : amount;
  }

  function card(product, config) {
    const media = D.el("div", { class: "card__media" });
    const image = product.images && product.images[0];
    if (image) {
      media.appendChild(
        D.el("img", {
          src: image.url,
          alt: image.alt || product.name,
          loading: "lazy",
          decoding: "async",
        }),
      );
    } else {
      media.appendChild(ornament());
    }

    const body = D.el("div", { class: "card__body" }, [
      D.el("h3", { text: product.name }),
      product.description
        ? D.el("p", { class: "muted", text: truncate(product.description, 130) })
        : null,
      D.el("p", { class: "card__price", text: priceLabel(product, config) }),
      product.servings
        ? D.el("p", { class: "field__hint", text: product.servings + " parts environ" })
        : null,
      D.el("div", { class: "card__foot" }, [
        D.el("a", {
          class: "btn btn--primary btn--sm",
          href: "/produit?p=" + encodeURIComponent(product.slug),
          text: product.basePrice === null ? "Demander un devis" : "Voir et commander",
        }),
      ]),
    ]);

    const article = D.el("article", { class: "card" }, [media, body]);
    if (!product.available) {
      body.insertBefore(D.el("span", { class: "badge badge--quiet", text: "Momentanément indisponible" }), body.firstChild);
    } else if (product.featured) {
      body.insertBefore(D.el("span", { class: "badge", text: "Coup de cœur" }), body.firstChild);
    }
    return article;
  }

  function truncate(value, max) {
    return value.length > max ? value.slice(0, max - 1).trimEnd() + "…" : value;
  }

  /** A petal motif stands in wherever a photograph has not been added yet. */
  function ornament() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("width", "88");
    svg.setAttribute("height", "88");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.innerHTML =
      '<g fill="none" stroke="#ffffff" stroke-width="2.5" opacity="0.85">' +
      '<path d="M60 92c-16-6-26-18-26-30 0-9 6-16 13-16 6 0 11 4 13 10 2-6 7-10 13-10 7 0 13 7 13 16 0 12-10 24-26 30z"/>' +
      '<path d="M60 66V38"/><path d="M60 44c-8-4-12-11-12-18"/><path d="M60 44c8-4 12-11 12-18"/>' +
      "</g>";
    return svg;
  }

  function render(container, products, config) {
    container.textContent = "";
    if (products.length === 0) {
      container.appendChild(
        D.el("div", { class: "empty" }, [
          D.el("p", {
            text: "Les créations de cette catégorie arrivent très bientôt.",
          }),
          D.el("a", { class: "btn btn--ghost", href: "/contact", text: "Nous écrire" }),
        ]),
      );
      return;
    }
    products.forEach(function (product) {
      container.appendChild(card(product, config));
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    const containers = document.querySelectorAll("[data-catalogue]");
    if (containers.length === 0) return;

    D.settings().then(function (config) {
      containers.forEach(function (container) {
        const params = new URLSearchParams();
        const category = container.getAttribute("data-category");
        if (category) params.set("category", category);
        if (container.hasAttribute("data-featured")) params.set("featured", "1");
        const limit = Number(container.getAttribute("data-limit") || 0);

        D.api("/api/products?" + params.toString())
          .then(function (products) {
            render(container, limit ? products.slice(0, limit) : products, config);
          })
          .catch(function () {
            container.textContent = "";
            container.appendChild(
              D.el("div", { class: "empty" }, [
                D.el("p", { text: "Impossible de charger les créations pour le moment." }),
              ]),
            );
          });
      });
    });
  });
})();
