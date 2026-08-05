/**
 * The smaller pages: rendez-vous, suivi de commande, témoignages, and the
 * confirmation screen. Each block does nothing unless its markup is on the page.
 */
(function () {
  "use strict";

  const D = window.Delices;

  /* ------------------------------------------------------- prendre rendez-vous */

  const appointmentForm = document.querySelector("[data-appointment-form]");
  if (appointmentForm) {
    appointmentForm.addEventListener("submit", function (event) {
      event.preventDefault();
      const status = document.querySelector("[data-status]");
      const values = D.formValues(appointmentForm);
      const button = appointmentForm.querySelector('[type="submit"]');
      button.disabled = true;
      D.setStatus(status, "Envoi en cours…", "success");

      D.api("/api/appointments", {
        method: "POST",
        body: {
          name: values.name,
          phone: values.phone,
          whatsapp: values.whatsapp || null,
          email: values.email || null,
          preferredDate: values.preferredDate || null,
          preferredTime: values.preferredTime || null,
          reason: values.reason,
          message: values.message || null,
        },
      })
        .then(function (response) {
          appointmentForm.reset();
          appointmentForm.classList.add("is-hidden");
          D.setStatus(status, response.message, "success");
        })
        .catch(function (error) {
          button.disabled = false;
          if (error.payload && error.payload.errors) {
            D.showErrors(appointmentForm, error.payload.errors);
            D.setStatus(status, "Merci de corriger les champs signalés.", "error");
          } else {
            D.setStatus(status, error.message, "error");
          }
        });
    });

    const date = appointmentForm.querySelector('[name="preferredDate"]');
    if (date) date.min = D.todayIso();
  }

  /* ------------------------------------------------------------ suivi de commande */

  const trackForm = document.querySelector("[data-track-form]");
  if (trackForm) {
    trackForm.addEventListener("submit", function (event) {
      event.preventDefault();
      const status = document.querySelector("[data-status]");
      const result = document.querySelector("[data-track-result]");
      const values = D.formValues(trackForm);
      result.textContent = "";
      D.setStatus(status, "Recherche…", "success");

      Promise.all([
        D.settings(),
        D.api("/api/track", {
          method: "POST",
          body: { reference: values.reference, phone: values.phone },
        }),
      ])
        .then(function (results) {
          const config = results[0];
          const order = results[1];
          D.setStatus(status, "", "success");
          status.classList.add("is-hidden");

          const lines = (order.items || []).map(function (item) {
            return D.el("li", {
              text:
                item.quantity +
                " × " +
                item.name +
                (item.options.length ? " (" + item.options.join(", ") + ")" : ""),
            });
          });

          result.appendChild(
            D.el("div", { class: "summary" }, [
              D.el("span", { class: "badge", text: order.statusLabel }),
              D.el("h2", { text: "Commande " + order.reference }),
              D.el("p", { class: "muted", text: "Pour le " + D.formatDate(order.requestedDate, config.locale) }),
              D.el("p", {
                text:
                  order.fulfillment === "delivery" ? "Mode : livraison" : "Mode : retrait sur place",
              }),
              lines.length ? D.el("ul", {}, lines) : null,
              D.el("p", { class: "card__price" }, [
                order.total === null
                  ? "Montant à confirmer"
                  : (order.quoted ? "Montant confirmé : " : "Total indicatif : ") +
                    D.formatMoney(order.total, config),
              ]),
            ]),
          );
        })
        .catch(function (error) {
          D.setStatus(status, error.message, "error");
        });
    });
  }

  /* ---------------------------------------------------------------- témoignages */

  const testimonialHost = document.querySelector("[data-testimonials]");
  if (testimonialHost) {
    D.api("/api/testimonials")
      .then(function (list) {
        const section = testimonialHost.closest("[data-testimonials-section]");
        if (!list.length) {
          if (section) section.classList.add("is-hidden");
          return;
        }
        list.slice(0, 6).forEach(function (item) {
          testimonialHost.appendChild(
            D.el("figure", { class: "quote" }, [
              item.photoUrl
                ? D.el("img", {
                    src: item.photoUrl,
                    alt: "",
                    loading: "lazy",
                    style: "width:72px;height:72px;border-radius:999px;object-fit:cover",
                  })
                : null,
              D.el("blockquote", { text: "« " + item.body + " »" }),
              D.el("figcaption", {
                text: item.customerName + (item.productName ? " — " + item.productName : ""),
              }),
            ]),
          );
        });
      })
      .catch(function () {
        const section = testimonialHost.closest("[data-testimonials-section]");
        if (section) section.classList.add("is-hidden");
      });
  }

  /* ------------------------------------------------------------------- galerie */

  const galleryHost = document.querySelector("[data-gallery-grid]");
  if (galleryHost) {
    D.api("/api/gallery")
      .then(function (images) {
        const section = galleryHost.closest("[data-gallery-section]");
        if (!images.length) {
          if (section) section.classList.add("is-hidden");
          return;
        }
        images.forEach(function (image) {
          galleryHost.appendChild(
            D.el("img", { src: image.url, alt: image.alt || "", loading: "lazy", decoding: "async" }),
          );
        });
      })
      .catch(function () {
        const section = galleryHost.closest("[data-gallery-section]");
        if (section) section.classList.add("is-hidden");
      });
  }

  /* ------------------------------------------------------------------- merci */

  const referenceSlot = document.querySelector("[data-reference]");
  if (referenceSlot) {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("ref");
    if (reference && /^[A-Z0-9-]{6,20}$/.test(reference)) {
      referenceSlot.textContent = reference;
    } else {
      const wrap = referenceSlot.closest("[data-reference-wrap]");
      if (wrap) wrap.classList.add("is-hidden");
    }
    if (params.get("type") === "devis") {
      const quoteNote = document.querySelector("[data-quote-note]");
      if (quoteNote) quoteNote.classList.remove("is-hidden");
    }
  }
})();
