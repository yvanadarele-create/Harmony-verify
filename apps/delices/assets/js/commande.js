/**
 * The basket and the standard order form.
 *
 * The summary shows an indicative total; the confirmation the customer receives is
 * explicit that Grace confirms availability and the final price. Nothing here is a
 * checkout — no payment is taken and the order is a request until she says otherwise.
 */
(function () {
  "use strict";

  const D = window.Delices;
  const form = document.querySelector("[data-order-form]");
  if (!form) return;

  let config = { currency: "EUR", locale: "fr-FR", leadTimeDays: 3 };

  function paintBasket() {
    const host = document.querySelector("[data-basket]");
    const items = D.cart.read();
    host.textContent = "";

    if (items.length === 0) {
      host.appendChild(
        D.el("div", { class: "empty" }, [
          D.el("p", { text: "Votre commande est vide pour le moment." }),
          D.el("a", { class: "btn btn--ghost", href: "/nos-creations", text: "Découvrir nos créations" }),
        ]),
      );
      document.querySelector("[data-order-fields]").classList.add("is-hidden");
      return;
    }

    document.querySelector("[data-order-fields]").classList.remove("is-hidden");

    let total = 0;
    let hasQuoted = false;

    items.forEach(function (item, index) {
      const lineTotal = item.unitPrice === null ? null : item.unitPrice * item.quantity;
      if (lineTotal === null) hasQuoted = true;
      else total += lineTotal;

      const minus = D.el("button", { type: "button", "aria-label": "Retirer une unité de " + item.name }, ["−"]);
      const plus = D.el("button", { type: "button", "aria-label": "Ajouter une unité de " + item.name }, ["+"]);
      minus.addEventListener("click", function () {
        D.cart.setQuantity(index, item.quantity - 1);
      });
      plus.addEventListener("click", function () {
        D.cart.setQuantity(index, item.quantity + 1);
      });

      const remove = D.el("button", {
        type: "button",
        class: "btn btn--quiet btn--sm",
        text: "Retirer",
      });
      remove.addEventListener("click", function () {
        D.cart.remove(index);
      });

      host.appendChild(
        D.el("div", { class: "summary__line" }, [
          D.el("div", {}, [
            D.el("strong", { text: item.name }),
            item.optionLabels && item.optionLabels.length
              ? D.el("div", { class: "field__hint", text: item.optionLabels.join(" · ") })
              : null,
            D.el("div", { class: "card__foot" }, [
              D.el("span", { class: "qty" }, [minus, D.el("output", { text: String(item.quantity) }), plus]),
              remove,
            ]),
          ]),
          D.el("div", { class: "card__price" }, [
            lineTotal === null ? "Sur devis" : D.formatMoney(lineTotal, config),
          ]),
        ]),
      );
    });

    host.appendChild(
      D.el("div", { class: "summary__total" }, [
        D.el("span", { text: "Total indicatif" }),
        D.el("span", { text: D.formatMoney(total, config) + (hasQuoted ? " + devis" : "") }),
      ]),
    );
  }

  function toggleDelivery() {
    const delivery = form.querySelector('[name="fulfillment"]:checked');
    const block = document.querySelector("[data-delivery-fields]");
    const isDelivery = delivery && delivery.value === "delivery";
    block.classList.toggle("is-hidden", !isDelivery);
    const address = form.querySelector('[name="address"]');
    if (address) address.required = Boolean(isDelivery);
  }

  function submit(event) {
    event.preventDefault();
    const status = document.querySelector("[data-status]");
    const items = D.cart.read();
    if (items.length === 0) {
      D.setStatus(status, "Votre commande est vide.", "error");
      return;
    }

    const values = D.formValues(form);
    const payload = {
      customer: {
        name: values.name,
        phone: values.phone,
        whatsapp: values.whatsapp || null,
        email: values.email || null,
      },
      items: items.map(function (item) {
        return {
          productId: item.productId,
          quantity: item.quantity,
          selectedOptionIds: item.optionIds || [],
        };
      }),
      requestedDate: values.requestedDate,
      fulfillment: values.fulfillment,
      address: values.address || null,
      deliveryNotes: values.deliveryNotes || null,
      customerNotes: values.customerNotes || null,
    };

    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    D.setStatus(status, "Envoi en cours…", "success");

    D.api("/api/orders", { method: "POST", body: payload })
      .then(function (response) {
        D.cart.clear();
        window.location.href = "/merci?ref=" + encodeURIComponent(response.reference);
      })
      .catch(function (error) {
        button.disabled = false;
        if (error.payload && error.payload.errors) {
          D.showErrors(form, error.payload.errors);
          D.setStatus(status, "Merci de corriger les champs signalés.", "error");
        } else {
          D.setStatus(status, error.message, "error");
        }
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    D.settings().then(function (value) {
      config = value;
      const date = form.querySelector('[name="requestedDate"]');
      date.min = D.todayIso();
      date.value = D.todayIso(value.leadTimeDays || 3);
      const hint = document.querySelector("[data-lead-time]");
      if (hint && value.leadTimeDays) {
        hint.textContent =
          "Merci de prévoir au moins " + value.leadTimeDays + " jours pour la préparation.";
      }
      paintBasket();
    });

    document.addEventListener("cart:change", paintBasket);
    form.querySelectorAll('[name="fulfillment"]').forEach(function (input) {
      input.addEventListener("change", toggleDelivery);
    });
    toggleDelivery();
    form.addEventListener("submit", submit);
  });
})();
