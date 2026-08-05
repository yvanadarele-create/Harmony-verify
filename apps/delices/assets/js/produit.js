/**
 * Product page.
 *
 * The ceremony matches the product: a pizza is size, quantity, add to basket. A cake
 * that carries no price sends you to the brief instead of pretending to be a basket
 * item. Prices shown here are indicative — the server re-prices every line on submit.
 */
(function () {
  "use strict";

  const D = window.Delices;
  const root = document.querySelector("[data-product-page]");
  if (!root) return;

  const state = { product: null, config: null, chosen: {}, quantity: 1 };

  function groups(product) {
    const map = new Map();
    product.options.forEach(function (option) {
      if (!map.has(option.group)) {
        map.set(option.group, { label: option.group, multiple: option.multiple, required: option.required, options: [] });
      }
      const group = map.get(option.group);
      group.options.push(option);
      group.multiple = group.multiple || option.multiple;
      group.required = group.required || option.required;
    });
    return Array.from(map.values());
  }

  function unitPrice() {
    if (state.product.basePrice === null || state.product.basePrice === undefined) return null;
    return Object.keys(state.chosen).reduce(function (total, group) {
      return (
        total +
        state.chosen[group].reduce(function (sum, option) {
          return sum + option.priceDelta;
        }, 0)
      );
    }, state.product.basePrice);
  }

  function paintPrice() {
    const node = document.querySelector("[data-price]");
    const price = unitPrice();
    if (price === null) {
      node.textContent = "Sur devis";
      return;
    }
    const amount = D.formatMoney(price * state.quantity, state.config);
    node.textContent = state.product.priceFrom && state.quantity === 1 ? "À partir de " + amount : amount;
  }

  function choose(group, option, multiple, checked) {
    const current = state.chosen[group] || [];
    if (multiple) {
      state.chosen[group] = checked
        ? current.concat([option])
        : current.filter(function (candidate) {
            return candidate.id !== option.id;
          });
    } else {
      state.chosen[group] = [option];
    }
    paintPrice();
  }

  function renderOptions(product) {
    const host = document.querySelector("[data-options]");
    host.textContent = "";
    const list = groups(product);
    if (list.length === 0) return;

    list.forEach(function (group) {
      const name = "group-" + group.label.replace(/\s+/g, "-").toLowerCase();
      const fieldset = D.el("fieldset", { class: "field" }, [
        D.el("legend", { class: "field__label" }, [
          document.createTextNode(group.label),
          group.required ? D.el("span", { class: "field__hint", text: " (obligatoire)" }) : null,
        ]),
      ]);
      const choices = D.el("div", { class: "choice-grid" });
      group.options.forEach(function (option, index) {
        const input = D.el("input", {
          type: group.multiple ? "checkbox" : "radio",
          name: name,
          value: option.id,
        });
        if (!group.multiple && group.required && index === 0) {
          input.checked = true;
          state.chosen[group.label] = [option];
        }
        input.addEventListener("change", function () {
          choose(group.label, option, group.multiple, input.checked);
        });
        const suffix =
          option.priceDelta > 0 ? " (+" + D.formatMoney(option.priceDelta, state.config) + ")" : "";
        choices.appendChild(
          D.el("label", { class: "choice" }, [
            input,
            document.createTextNode(option.label + suffix),
          ]),
        );
      });
      fieldset.appendChild(choices);
      host.appendChild(fieldset);
    });
  }

  function paintGallery(product) {
    const host = document.querySelector("[data-gallery]");
    host.textContent = "";
    if (!product.images.length) {
      host.classList.add("card__media");
      return;
    }
    product.images.forEach(function (image, index) {
      host.appendChild(
        D.el("img", {
          src: image.url,
          alt: image.alt || product.name,
          loading: index === 0 ? "eager" : "lazy",
          decoding: "async",
        }),
      );
    });
  }

  function paint(product, config) {
    state.product = product;
    state.config = config;

    document.title = product.name + " — Les Délices de Grace Lumière";
    document.querySelector("[data-name]").textContent = product.name;
    document.querySelector("[data-category]").textContent = product.category;
    const description = document.querySelector("[data-description]");
    description.textContent = product.description || "";
    description.classList.toggle("is-hidden", !product.description);

    const ingredients = document.querySelector("[data-ingredients]");
    if (product.ingredients) {
      ingredients.querySelector("[data-ingredients-text]").textContent = product.ingredients;
    } else {
      ingredients.classList.add("is-hidden");
    }

    const servings = document.querySelector("[data-servings]");
    if (product.servings) servings.textContent = "Environ " + product.servings + " parts";
    else servings.classList.add("is-hidden");

    paintGallery(product);
    renderOptions(product);
    paintPrice();

    const quoteOnly = product.basePrice === null || product.basePrice === undefined;
    const addButton = document.querySelector("[data-add]");
    const briefLink = document.querySelector("[data-brief]");
    const quantityBox = document.querySelector("[data-quantity-box]");

    if (quoteOnly || !product.available) {
      addButton.classList.add("is-hidden");
      quantityBox.classList.add("is-hidden");
    }
    if (!product.available) {
      document.querySelector("[data-unavailable]").classList.remove("is-hidden");
    }
    if (product.customisable || quoteOnly) {
      briefLink.classList.remove("is-hidden");
    }
    root.classList.remove("is-hidden");
  }

  function wireQuantity() {
    const output = document.querySelector("[data-quantity]");
    document.querySelector("[data-quantity-minus]").addEventListener("click", function () {
      state.quantity = Math.max(1, state.quantity - 1);
      output.value = state.quantity;
      paintPrice();
    });
    document.querySelector("[data-quantity-plus]").addEventListener("click", function () {
      state.quantity = Math.min(99, state.quantity + 1);
      output.value = state.quantity;
      paintPrice();
    });
  }

  function missingRequired() {
    return groups(state.product)
      .filter(function (group) {
        return group.required && !(state.chosen[group.label] || []).length;
      })
      .map(function (group) {
        return group.label;
      });
  }

  function wireAdd() {
    document.querySelector("[data-add]").addEventListener("click", function () {
      const missing = missingRequired();
      const status = document.querySelector("[data-status]");
      if (missing.length > 0) {
        D.setStatus(status, "Merci de choisir : " + missing.join(", ") + ".", "error");
        return;
      }
      const optionIds = [];
      const optionLabels = [];
      Object.keys(state.chosen).forEach(function (group) {
        state.chosen[group].forEach(function (option) {
          optionIds.push(option.id);
          optionLabels.push(option.label);
        });
      });
      D.cart.add({
        productId: state.product.id,
        slug: state.product.slug,
        name: state.product.name,
        quantity: state.quantity,
        optionIds: optionIds,
        optionLabels: optionLabels,
        unitPrice: unitPrice(),
      });
      D.setStatus(status, state.product.name + " a été ajouté à votre commande.", "success");
      const link = document.querySelector("[data-go-basket]");
      if (link) link.classList.remove("is-hidden");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    const slug = new URLSearchParams(window.location.search).get("p");
    if (!slug) {
      window.location.replace("/nos-creations");
      return;
    }
    document.querySelector("[data-brief]").href = "/sur-mesure?produit=" + encodeURIComponent(slug);

    Promise.all([D.settings(), D.api("/api/products/" + encodeURIComponent(slug))])
      .then(function (results) {
        paint(results[1], results[0]);
        wireQuantity();
        wireAdd();
      })
      .catch(function () {
        document.querySelector("[data-missing]").classList.remove("is-hidden");
      });
  });
})();
