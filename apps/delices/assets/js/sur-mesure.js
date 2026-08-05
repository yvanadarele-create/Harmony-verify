/**
 * "Créer mon gâteau" — the custom brief.
 *
 * The choice lists (occasion, forme, parfum, garniture, décoration) come from the
 * admin, so Grace changes what she offers without anyone touching this file. The
 * form deliberately ends on "Demander un devis": no price is calculated here.
 */
(function () {
  "use strict";

  const D = window.Delices;
  const form = document.querySelector("[data-brief-form]");
  if (!form) return;

  const state = { uploadId: null };

  /** Renders a group of admin-managed choices, plus a free-text escape hatch. */
  function renderChoices(kind, hostSelector, name, allowFree) {
    return function (grouped) {
      const host = document.querySelector(hostSelector);
      const options = grouped[kind] || [];
      host.textContent = "";
      if (options.length === 0) {
        host.appendChild(
          D.el("input", { type: "text", name: name, placeholder: "Votre souhait" }),
        );
        return;
      }
      options.forEach(function (option) {
        host.appendChild(
          D.el("label", { class: "choice" }, [
            D.el("input", { type: "radio", name: name, value: option.label }),
            document.createTextNode(option.label),
          ]),
        );
      });
      if (allowFree) {
        const other = D.el("input", {
          type: "text",
          name: name + "Other",
          placeholder: "Autre — précisez",
          class: "field",
          "aria-label": "Autre choix pour " + name,
        });
        host.appendChild(other);
      }
    };
  }

  function renderMulti(kind, hostSelector, name) {
    return function (grouped) {
      const host = document.querySelector(hostSelector);
      const options = grouped[kind] || [];
      host.textContent = "";
      if (options.length === 0) {
        host.appendChild(D.el("input", { type: "text", name: name, placeholder: "Vos souhaits" }));
        return;
      }
      options.forEach(function (option) {
        host.appendChild(
          D.el("label", { class: "choice" }, [
            D.el("input", { type: "checkbox", name: name, value: option.label }),
            document.createTextNode(option.label),
          ]),
        );
      });
    };
  }

  function wireUpload() {
    const input = document.querySelector("[data-inspiration]");
    const status = document.querySelector("[data-inspiration-status]");
    const preview = document.querySelector("[data-inspiration-preview]");
    if (!input) return;

    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 6 * 1024 * 1024) {
        D.setStatus(status, "L'image dépasse 6 Mo.", "error");
        input.value = "";
        return;
      }
      const data = new FormData();
      data.append("file", file);
      D.setStatus(status, "Envoi de l'image…", "success");
      D.api("/api/uploads", { method: "POST", body: data })
        .then(function (response) {
          state.uploadId = response.id;
          D.setStatus(status, "Image bien reçue.", "success");
          preview.textContent = "";
          preview.appendChild(
            D.el("img", { src: response.url, alt: "Votre image d'inspiration", loading: "lazy" }),
          );
          preview.classList.remove("is-hidden");
        })
        .catch(function (error) {
          state.uploadId = null;
          D.setStatus(status, error.message, "error");
        });
    });
  }

  function toggleDelivery() {
    const chosen = form.querySelector('[name="fulfillment"]:checked');
    const isDelivery = chosen && chosen.value === "delivery";
    document.querySelector("[data-delivery-fields]").classList.toggle("is-hidden", !isDelivery);
    const address = form.querySelector('[name="address"]');
    if (address) address.required = Boolean(isDelivery);
  }

  /** A radio choice plus its "autre" text field collapse into one value. */
  function pick(values, name) {
    const free = values[name + "Other"];
    if (free) return free;
    const value = values[name];
    return Array.isArray(value) ? value.join(", ") : value || null;
  }

  function submit(event) {
    event.preventDefault();
    const status = document.querySelector("[data-status]");
    const values = D.formValues(form);
    const decoration = values.decoration;

    const payload = {
      customer: {
        name: values.name,
        phone: values.phone,
        whatsapp: values.whatsapp || null,
        email: values.email || null,
      },
      occasion: pick(values, "occasion") || "",
      requestedDate: values.requestedDate,
      servings: values.servings ? Number(values.servings) : null,
      shape: pick(values, "shape"),
      flavour: pick(values, "flavour"),
      filling: pick(values, "filling"),
      colours: values.colours || null,
      decoration: Array.isArray(decoration) ? decoration.join(", ") : decoration || null,
      messageOnCake: values.messageOnCake || null,
      inspirationMediaId: state.uploadId,
      requirements: values.requirements || null,
      fulfillment: values.fulfillment,
      address: values.address || null,
      deliveryNotes: values.deliveryNotes || null,
      customerNotes: values.customerNotes || null,
    };

    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    D.setStatus(status, "Envoi de votre demande…", "success");

    D.api("/api/custom-requests", { method: "POST", body: payload })
      .then(function (response) {
        window.location.href = "/merci?ref=" + encodeURIComponent(response.reference) + "&type=devis";
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
    D.settings().then(function (config) {
      const date = form.querySelector('[name="requestedDate"]');
      date.min = D.todayIso();
      date.value = D.todayIso(Math.max(config.leadTimeDays || 3, 7));
      const hint = document.querySelector("[data-lead-time]");
      if (hint && config.leadTimeDays) {
        hint.textContent =
          "Pour une création sur mesure, prévoyez idéalement plusieurs jours — au minimum " +
          config.leadTimeDays +
          " jours.";
      }
    });

    D.api("/api/options")
      .then(function (grouped) {
        renderChoices("occasion", "[data-occasions]", "occasion", true)(grouped);
        renderChoices("shape", "[data-shapes]", "shape", true)(grouped);
        renderChoices("flavour", "[data-flavours]", "flavour", false)(grouped);
        renderChoices("filling", "[data-fillings]", "filling", false)(grouped);
        renderMulti("decoration", "[data-decorations]", "decoration")(grouped);
      })
      .catch(function () {
        D.setStatus(
          document.querySelector("[data-status]"),
          "Les listes de choix n'ont pas pu être chargées — décrivez vos souhaits dans le champ « Précisions ».",
          "error",
        );
      });

    const reference = new URLSearchParams(window.location.search).get("produit");
    if (reference) {
      const notes = form.querySelector('[name="requirements"]');
      notes.value = "Inspiration : la création « " + reference + " » de votre site.\n";
    }

    wireUpload();
    form.querySelectorAll('[name="fulfillment"]').forEach(function (input) {
      input.addEventListener("change", toggleDelivery);
    });
    toggleDelivery();
    form.addEventListener("submit", submit);
  });
})();
