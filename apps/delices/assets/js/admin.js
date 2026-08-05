/**
 * The admin console.
 *
 * A single page with hash routing, no framework and no build step — the same
 * constraint as the rest of the repository. Three ideas keep it small:
 *
 *   - `table()` and `openForm()` do the work for every list and every editor, so a
 *     new section is a column list and a field list rather than new machinery.
 *   - Every mutation goes through `api()`, which attaches the `X-Delices-Admin`
 *     header the server requires.
 *   - Nothing is ever written with innerHTML; text goes in as text.
 */
(function () {
  "use strict";

  const state = {
    user: null,
    settings: { currency: "EUR", locale: "fr-FR" },
    categories: [],
  };

  /* ---------------------------------------------------------------- helpers */

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        const value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key.startsWith("on") && typeof value === "function") {
          node.addEventListener(key.slice(2), value);
        } else node.setAttribute(key, value === true ? "" : String(value));
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function api(path, options) {
    const opts = Object.assign({ headers: {} }, options || {});
    opts.credentials = "same-origin";
    opts.headers = Object.assign({ Accept: "application/json" }, opts.headers);
    if ((opts.method || "GET") !== "GET") opts.headers["X-Delices-Admin"] = "1";
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, opts).then(function (response) {
      if (response.status === 401) {
        state.user = null;
        showLogin();
        throw new Error("Session expirée.");
      }
      const isJson = (response.headers.get("content-type") || "").includes("application/json");
      return (isJson ? response.json() : response.text()).then(function (payload) {
        if (!response.ok) {
          const error = new Error((payload && payload.error) || "Erreur.");
          error.payload = payload;
          throw error;
        }
        return payload;
      });
    });
  }

  function minorDigits() {
    try {
      return new Intl.NumberFormat(state.settings.locale, {
        style: "currency",
        currency: state.settings.currency,
      }).resolvedOptions().maximumFractionDigits;
    } catch (error) {
      return 2;
    }
  }

  function money(minor) {
    if (minor === null || minor === undefined) return "—";
    try {
      return new Intl.NumberFormat(state.settings.locale, {
        style: "currency",
        currency: state.settings.currency,
      }).format(minor / Math.pow(10, minorDigits()));
    } catch (error) {
      return String(minor);
    }
  }

  /** Admin forms take human amounts ("12,50"); the API stores minor units. */
  function toMinor(value) {
    if (value === "" || value === null || value === undefined) return null;
    const cleaned = String(value).replace(/\s/g, "").replace(",", ".");
    const amount = Number(cleaned);
    if (!Number.isFinite(amount)) return null;
    return Math.round(amount * Math.pow(10, minorDigits()));
  }

  function fromMinor(minor) {
    if (minor === null || minor === undefined) return "";
    return String(minor / Math.pow(10, minorDigits()));
  }

  function date(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString(
        state.settings.locale,
        { day: "2-digit", month: "short", year: "numeric" },
      );
    } catch (error) {
      return iso;
    }
  }

  const STATUS_LABELS = {
    NEW: "Nouvelle demande",
    REVIEWING: "En cours d'étude",
    QUOTE_SENT: "Devis envoyé",
    CONFIRMED: "Confirmée",
    DEPOSIT_PAID: "Acompte reçu",
    IN_PRODUCTION: "En préparation",
    READY: "Prête",
    OUT_FOR_DELIVERY: "En livraison",
    COMPLETED: "Terminée",
    CANCELLED: "Annulée",
  };

  const NEXT_STATUSES = {
    NEW: ["REVIEWING", "QUOTE_SENT", "CONFIRMED", "CANCELLED"],
    REVIEWING: ["QUOTE_SENT", "CONFIRMED", "CANCELLED"],
    QUOTE_SENT: ["REVIEWING", "CONFIRMED", "CANCELLED"],
    CONFIRMED: ["DEPOSIT_PAID", "IN_PRODUCTION", "CANCELLED"],
    DEPOSIT_PAID: ["IN_PRODUCTION", "CANCELLED"],
    IN_PRODUCTION: ["READY", "CANCELLED"],
    READY: ["OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"],
    OUT_FOR_DELIVERY: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };

  const PAYMENT_LABELS = {
    PENDING: "En attente",
    DEPOSIT_PAID: "Acompte payé",
    PARTIALLY_PAID: "Partiellement payé",
    PAID: "Payé",
    REFUNDED: "Remboursé",
  };

  function statusChip(status) {
    return el("span", { class: "status-chip status-" + status, text: STATUS_LABELS[status] || status });
  }

  function table(columns, rows, renderRow) {
    const head = el(
      "thead",
      {},
      [el("tr", {}, columns.map(function (column) {
        return el("th", { text: column });
      }))],
    );
    const bodyRows = rows.map(renderRow);
    if (bodyRows.length === 0) {
      return el("div", { class: "empty" }, [el("p", { text: "Rien à afficher pour le moment." })]);
    }
    return el("div", { class: "table-scroll" }, [
      el("table", { class: "data" }, [head, el("tbody", {}, bodyRows)]),
    ]);
  }

  function actionButton(label, handler, variant) {
    return el("button", {
      class: "btn btn--" + (variant || "quiet") + " btn--sm",
      type: "button",
      text: label,
      onclick: handler,
    });
  }

  /* ---------------------------------------------------------------- modal */

  const modal = document.querySelector("[data-modal]");
  const modalForm = document.querySelector("[data-modal-form]");
  let modalSubmit = null;

  document.querySelectorAll("[data-modal-close]").forEach(function (button) {
    button.addEventListener("click", function () {
      modal.close();
    });
  });

  modalForm.addEventListener("submit", function (event) {
    if (!modalSubmit) return;
    event.preventDefault();
    const data = new FormData(modalForm);
    const values = {};
    data.forEach(function (value, key) {
      if (typeof value === "string") values[key] = value.trim();
    });
    modalForm.querySelectorAll('input[type="checkbox"]').forEach(function (input) {
      values[input.name] = input.checked;
    });
    const button = modalForm.querySelector("[data-modal-submit]");
    button.disabled = true;
    Promise.resolve(modalSubmit(values))
      .then(function () {
        button.disabled = false;
        modal.close();
      })
      .catch(function (error) {
        button.disabled = false;
        const slot = modalForm.querySelector("[data-modal-error]");
        if (slot) slot.textContent = error.message;
      });
  });

  /**
   * Builds an editor from a field description.
   * field: { name, label, type, options, hint, required, value }
   */
  function openForm(title, fields, values, onSubmit) {
    document.querySelector("[data-modal-title]").textContent = title;
    const body = document.querySelector("[data-modal-body]");
    body.textContent = "";
    modalSubmit = onSubmit;

    fields.forEach(function (field) {
      const id = "f_" + field.name;
      const current = values && values[field.name] !== undefined ? values[field.name] : "";
      let input;

      if (field.type === "select") {
        input = el("select", { id: id, name: field.name });
        (field.options || []).forEach(function (option) {
          const node = el("option", { value: option.value, text: option.label });
          if (String(option.value) === String(current)) node.selected = true;
          input.appendChild(node);
        });
      } else if (field.type === "textarea") {
        input = el("textarea", { id: id, name: field.name });
        input.value = current === null ? "" : String(current);
      } else if (field.type === "checkbox") {
        input = el("input", { type: "checkbox", id: id, name: field.name });
        input.checked = Boolean(current);
      } else {
        input = el("input", {
          type: field.type || "text",
          id: id,
          name: field.name,
          step: field.type === "number" ? field.step || "any" : null,
        });
        input.value = current === null ? "" : String(current);
      }
      if (field.required) input.required = true;

      body.appendChild(
        el("div", { class: "field" }, [
          field.type === "checkbox"
            ? el("label", { class: "choice", for: id }, [input, document.createTextNode(field.label)])
            : el("label", { for: id, text: field.label }),
          field.type === "checkbox" ? null : input,
          field.hint ? el("p", { class: "field__hint", text: field.hint }) : null,
        ]),
      );
    });

    body.appendChild(el("p", { class: "field__error", "data-modal-error": true }));
    modal.showModal();
  }

  /* ---------------------------------------------------------------- shell */

  function showLogin() {
    document.getElementById("login").classList.remove("is-hidden");
    document.getElementById("console").classList.add("is-hidden");
  }

  function showConsole() {
    document.getElementById("login").classList.add("is-hidden");
    document.getElementById("console").classList.remove("is-hidden");
    const label = document.querySelector("[data-user]");
    if (state.user) label.textContent = state.user.name + " · " + state.user.email;
  }

  function view() {
    return document.getElementById("view");
  }

  function render(nodes) {
    const host = view();
    host.textContent = "";
    nodes.forEach(function (node) {
      if (node) host.appendChild(node);
    });
    host.focus();
  }

  function head(title, actions) {
    return el("div", { class: "admin-head" }, [
      el("h1", { text: title }),
      el("div", { class: "toolbar" }, actions || []),
    ]);
  }

  function panel(title, children, actions) {
    return el("section", { class: "panel" }, [
      el("div", { class: "panel__head" }, [
        el("h2", { text: title }),
        el("div", { class: "toolbar" }, actions || []),
      ]),
    ].concat(children));
  }

  function toast(message, kind) {
    const node = el("div", { class: "alert alert--" + (kind || "success"), text: message });
    const host = view();
    host.insertBefore(node, host.firstChild);
    window.setTimeout(function () {
      node.remove();
    }, 4000);
  }

  function badge(name, count) {
    const node = document.querySelector('[data-badge="' + name + '"]');
    if (!node) return;
    node.textContent = String(count);
    node.classList.toggle("is-hidden", !count);
  }

  /* ---------------------------------------------------------------- views */

  function dashboard() {
    api("/api/admin/dashboard").then(function (data) {
      state.settings.currency = data.currency || "EUR";
      state.settings.locale = data.locale || "fr-FR";
      const s = data.stats;
      badge("orders", s.pendingRequests);
      badge("stock", s.lowStock);
      badge("appointments", s.newAppointments);
      badge("notifications", s.unreadNotifications);

      const stats = [
        ["Commandes aujourd'hui", s.ordersToday],
        ["Demandes à traiter", s.pendingRequests],
        ["Devis en attente", s.awaitingQuote],
        ["Confirmées", s.confirmed],
        ["En préparation", s.inProduction],
        ["Prêtes", s.ready],
        ["Livraisons du jour", s.deliveriesToday],
        ["Terminées ce mois", s.completedThisMonth],
        ["Chiffre d'affaires du mois", money(s.revenueThisMonth)],
        ["Articles en stock bas", s.lowStock],
      ];

      render([
        head("Tableau de bord", [
          actionButton("Actualiser", function () {
            dashboard();
          }),
        ]),
        el(
          "div",
          { class: "stat-grid" },
          stats.map(function (entry) {
            return el("div", { class: "stat" + (entry[0] === "Articles en stock bas" && s.lowStock ? " stat--alert" : "") }, [
              el("div", { class: "stat__value", text: String(entry[1]) }),
              el("div", { class: "stat__label", text: entry[0] }),
            ]);
          }),
        ),
        panel("À traiter", [ordersTable(data.attention)]),
        panel("Aujourd'hui", [ordersTable(data.todayOrders)]),
        panel("À venir", [ordersTable(data.upcoming)]),
        data.lowStock.length
          ? panel(
              "Stock bas",
              [
                table(["Article", "Quantité", "Minimum", "Fournisseur"], data.lowStock, function (item) {
                  return el("tr", {}, [
                    el("td", { text: item.name }),
                    el("td", { text: item.quantity + " " + item.unit }),
                    el("td", { text: String(item.minimumStock) }),
                    el("td", { text: item.supplierName || "—" }),
                  ]);
                }),
              ],
            )
          : null,
      ]);
    });
  }

  function ordersTable(orders) {
    return table(
      ["Référence", "Client", "Date", "Type", "Statut", "Montant", ""],
      orders,
      function (order) {
        return el("tr", {}, [
          el("td", {}, [el("a", { href: "#/commandes/" + order.id, text: order.reference })]),
          el("td", {}, [
            el("div", { text: (order.customer && order.customer.name) || "—" }),
            el("div", { class: "field__hint", text: (order.customer && order.customer.phone) || "" }),
          ]),
          el("td", { text: date(order.requestedDate) }),
          el("td", { text: order.kind === "custom" ? "Sur mesure" : "Standard" }),
          el("td", {}, [statusChip(order.status)]),
          el("td", { text: money(order.quotedTotal !== null ? order.quotedTotal : order.itemsTotal || null) }),
          el("td", { class: "actions" }, [
            el("a", { class: "btn btn--ghost btn--sm", href: "#/commandes/" + order.id, text: "Ouvrir" }),
          ]),
        ]);
      },
    );
  }

  function ordersView(params) {
    const status = params.get("status") || "";
    const kind = params.get("kind") || "";
    const search = params.get("search") || "";
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (kind) query.set("kind", kind);
    if (search) query.set("search", search);

    api("/api/admin/orders?" + query.toString()).then(function (orders) {
      const statusSelect = el("select", { "aria-label": "Filtrer par statut" }, [
        el("option", { value: "", text: "Tous les statuts" }),
      ]);
      Object.keys(STATUS_LABELS).forEach(function (key) {
        const option = el("option", { value: key, text: STATUS_LABELS[key] });
        if (key === status) option.selected = true;
        statusSelect.appendChild(option);
      });

      const kindSelect = el("select", { "aria-label": "Filtrer par type" }, [
        el("option", { value: "", text: "Tous les types" }),
        el("option", { value: "standard", text: "Standard" }),
        el("option", { value: "custom", text: "Sur mesure" }),
      ]);
      kindSelect.value = kind;

      const searchInput = el("input", {
        type: "search",
        placeholder: "Référence, nom, téléphone",
        "aria-label": "Rechercher",
      });
      searchInput.value = search;

      function apply() {
        const next = new URLSearchParams();
        if (statusSelect.value) next.set("status", statusSelect.value);
        if (kindSelect.value) next.set("kind", kindSelect.value);
        if (searchInput.value.trim()) next.set("search", searchInput.value.trim());
        window.location.hash = "#/commandes?" + next.toString();
      }
      statusSelect.addEventListener("change", apply);
      kindSelect.addEventListener("change", apply);
      searchInput.addEventListener("change", apply);

      render([
        head("Commandes"),
        el("div", { class: "filters" }, [statusSelect, kindSelect, searchInput]),
        el("section", { class: "panel" }, [ordersTable(orders)]),
      ]);
    });
  }

  function orderDetail(id) {
    api("/api/admin/orders/" + id).then(function (order) {
      const customer = order.customer || {};
      const request = order.customRequest;

      const statusButtons = (NEXT_STATUSES[order.status] || []).map(function (next, index) {
        return actionButton(
          STATUS_LABELS[next],
          function () {
            api("/api/admin/orders/" + order.id + "/status", {
              method: "POST",
              body: { status: next },
            })
              .then(function () {
                orderDetail(order.id);
              })
              .catch(function (error) {
                toast(error.message, "error");
              });
          },
          next === "CANCELLED" ? "quiet" : index === 0 ? "primary" : "ghost",
        );
      });

      const items = (order.items || []).map(function (item) {
        return el("tr", {}, [
          el("td", {}, [
            el("div", { text: item.productName }),
            item.selectedOptions.length
              ? el("div", {
                  class: "field__hint",
                  text: item.selectedOptions
                    .map(function (option) {
                      return option.groupLabel + " : " + option.label;
                    })
                    .join(" · "),
                })
              : null,
            item.notes ? el("div", { class: "field__hint", text: item.notes }) : null,
          ]),
          el("td", { text: String(item.quantity) }),
          el("td", { text: money(item.unitPrice) }),
          el("td", { text: item.unitPrice === null ? "—" : money(item.unitPrice * item.quantity) }),
          el("td", { class: "actions" }, [
            actionButton("Retirer", function () {
              if (!window.confirm("Retirer cette ligne ?")) return;
              api("/api/admin/orders/" + order.id + "/items/" + item.id, { method: "DELETE" }).then(
                function () {
                  orderDetail(order.id);
                },
              );
            }),
          ]),
        ]);
      });

      function editQuote() {
        openForm(
          "Devis et paiement",
          [
            { name: "quotedTotal", label: "Montant confirmé", type: "text", hint: "Laisser vide tant que le devis n'est pas fixé." },
            { name: "depositPaid", label: "Acompte reçu", type: "text" },
            {
              name: "paymentStatus",
              label: "Statut de paiement",
              type: "select",
              options: Object.keys(PAYMENT_LABELS).map(function (key) {
                return { value: key, label: PAYMENT_LABELS[key] };
              }),
            },
          ],
          {
            quotedTotal: fromMinor(order.quotedTotal),
            depositPaid: fromMinor(order.depositPaid),
            paymentStatus: order.paymentStatus,
          },
          function (values) {
            return api("/api/admin/orders/" + order.id, {
              method: "PATCH",
              body: {
                quotedTotal: values.quotedTotal === "" ? null : toMinor(values.quotedTotal),
                depositPaid: toMinor(values.depositPaid) || 0,
                paymentStatus: values.paymentStatus,
              },
            }).then(function () {
              orderDetail(order.id);
            });
          },
        );
      }

      function editLogistics() {
        openForm(
          "Date et livraison",
          [
            { name: "requestedDate", label: "Date souhaitée", type: "date" },
            {
              name: "fulfillment",
              label: "Mode",
              type: "select",
              options: [
                { value: "pickup", label: "Retrait" },
                { value: "delivery", label: "Livraison" },
              ],
            },
            { name: "address", label: "Adresse", type: "text" },
            { name: "deliveryNotes", label: "Précisions de livraison", type: "textarea" },
          ],
          order,
          function (values) {
            return api("/api/admin/orders/" + order.id, { method: "PATCH", body: values }).then(
              function () {
                orderDetail(order.id);
              },
            );
          },
        );
      }

      function addLine() {
        openForm(
          "Ajouter une ligne",
          [
            { name: "productName", label: "Désignation", required: true },
            { name: "quantity", label: "Quantité", type: "number", value: 1 },
            { name: "unitPrice", label: "Prix unitaire", type: "text" },
            { name: "notes", label: "Note", type: "text" },
          ],
          { quantity: 1 },
          function (values) {
            return api("/api/admin/orders/" + order.id + "/items", {
              method: "POST",
              body: {
                productName: values.productName,
                quantity: Number(values.quantity) || 1,
                unitPrice: values.unitPrice === "" ? null : toMinor(values.unitPrice),
                notes: values.notes,
              },
            }).then(function () {
              orderDetail(order.id);
            });
          },
        );
      }

      const notesArea = el("textarea", { "aria-label": "Notes internes" });
      notesArea.value = order.internalNotes || "";

      render([
        head("Commande " + order.reference, [
          el("a", { class: "btn btn--quiet btn--sm", href: "#/commandes", text: "← Retour" }),
        ]),
        el("section", { class: "panel" }, [
          el("div", { class: "panel__head" }, [
            el("div", {}, [statusChip(order.status), el("span", { class: "field__hint", text: " " + (order.kind === "custom" ? "Demande sur mesure" : "Commande standard") })]),
            el("div", { class: "toolbar" }, statusButtons),
          ]),
          el("div", { class: "detail-grid detail" }, [
            el("dl", {}, [
              el("dt", { text: "Client" }),
              el("dd", {}, [
                el("a", { href: "#/clients/" + order.customerId, text: customer.name || "—" }),
              ]),
              el("dt", { text: "Téléphone" }),
              el("dd", {}, [el("a", { href: "tel:" + (customer.phone || ""), text: customer.phone || "—" })]),
              el("dt", { text: "WhatsApp" }),
              el("dd", {}, [
                customer.whatsapp
                  ? el("a", {
                      href: "https://wa.me/" + String(customer.whatsapp).replace(/\D/g, ""),
                      text: customer.whatsapp,
                      target: "_blank",
                      rel: "noopener",
                    })
                  : el("span", { text: "—" }),
              ]),
              el("dt", { text: "E-mail" }),
              el("dd", { text: customer.email || "—" }),
            ]),
            el("dl", {}, [
              el("dt", { text: "Date souhaitée" }),
              el("dd", { text: date(order.requestedDate) }),
              el("dt", { text: "Mode" }),
              el("dd", { text: order.fulfillment === "delivery" ? "Livraison" : "Retrait" }),
              el("dt", { text: "Adresse" }),
              el("dd", { text: order.address || "—" }),
              el("dt", { text: "Reçue le" }),
              el("dd", { text: date(order.createdAt) }),
            ]),
            el("dl", {}, [
              el("dt", { text: "Total panier" }),
              el("dd", { text: money(order.itemsTotal) }),
              el("dt", { text: "Montant confirmé" }),
              el("dd", { text: order.quotedTotal === null ? "à définir" : money(order.quotedTotal) }),
              el("dt", { text: "Acompte" }),
              el("dd", { text: money(order.depositPaid) }),
              el("dt", { text: "Paiement" }),
              el("dd", { text: PAYMENT_LABELS[order.paymentStatus] || order.paymentStatus }),
            ]),
          ]),
          el("div", { class: "toolbar" }, [
            actionButton("Devis et paiement", editQuote, "ghost"),
            actionButton("Date et livraison", editLogistics, "ghost"),
          ]),
        ]),

        request
          ? panel("Demande sur mesure", [
              el("div", { class: "detail-grid detail" }, [
                el("dl", {}, [
                  el("dt", { text: "Occasion" }),
                  el("dd", { text: request.occasion }),
                  el("dt", { text: "Nombre de parts" }),
                  el("dd", { text: request.servings ? String(request.servings) : "—" }),
                  el("dt", { text: "Forme" }),
                  el("dd", { text: request.shape || "—" }),
                ]),
                el("dl", {}, [
                  el("dt", { text: "Parfum" }),
                  el("dd", { text: request.flavour || "—" }),
                  el("dt", { text: "Garniture" }),
                  el("dd", { text: request.filling || "—" }),
                  el("dt", { text: "Couleurs" }),
                  el("dd", { text: request.colours || "—" }),
                ]),
                el("dl", {}, [
                  el("dt", { text: "Décoration" }),
                  el("dd", { text: request.decoration || "—" }),
                  el("dt", { text: "Message sur le gâteau" }),
                  el("dd", { text: request.messageOnCake || "—" }),
                  el("dt", { text: "Inspiration" }),
                  el("dd", {}, [
                    request.inspirationUrl
                      ? el("a", { href: request.inspirationUrl, target: "_blank", rel: "noopener", text: "Voir l'image" })
                      : el("span", { text: "—" }),
                  ]),
                ]),
              ]),
              request.requirements ? el("div", { class: "note-box", text: request.requirements }) : null,
            ])
          : null,

        panel(
          "Lignes de commande",
          [
            items.length === 0
              ? el("div", { class: "empty" }, [
                  el("p", { text: "Aucune ligne — commande à devis." }),
                ])
              : el("div", { class: "table-scroll" }, [
                  el("table", { class: "data" }, [
                    el("thead", {}, [
                      el(
                        "tr",
                        {},
                        ["Produit", "Qté", "Prix unitaire", "Total", ""].map(function (label) {
                          return el("th", { text: label });
                        }),
                      ),
                    ]),
                    el("tbody", {}, items),
                  ]),
                ]),
          ],
          [actionButton("Ajouter une ligne", addLine, "ghost")],
        ),

        order.customerNotes ? panel("Message du client", [el("div", { class: "note-box", text: order.customerNotes })]) : null,

        panel(
          "Notes internes",
          [
            notesArea,
            el("div", { class: "toolbar", style: "margin-top:0.75rem" }, [
              actionButton(
                "Enregistrer les notes",
                function () {
                  api("/api/admin/orders/" + order.id, {
                    method: "PATCH",
                    body: { internalNotes: notesArea.value },
                  }).then(function () {
                    toast("Notes enregistrées.");
                  });
                },
                "primary",
              ),
            ]),
          ],
        ),

        panel("Historique", [
          el(
            "ul",
            { class: "timeline" },
            (order.events || []).map(function (event) {
              return el("li", {}, [
                el("strong", { text: STATUS_LABELS[event.toStatus] || event.toStatus }),
                el("span", { class: "field__hint", text: " — " + date(event.createdAt) }),
                event.note ? el("div", { class: "field__hint", text: event.note }) : null,
              ]);
            }),
          ),
        ]),
      ]);
    });
  }

  function calendarView() {
    api("/api/admin/calendar").then(function (data) {
      const counts = {};
      data.days.forEach(function (day) {
        counts[day.date] = day;
      });

      const cells = [];
      const start = new Date(data.from + "T00:00:00Z");
      for (let i = 0; i < 42; i++) {
        const day = new Date(start);
        day.setUTCDate(start.getUTCDate() + i);
        const iso = day.toISOString().slice(0, 10);
        const entry = counts[iso];
        cells.push(
          el(
            "div",
            {
              class:
                "calendar__cell" +
                (entry ? (entry.orders >= 5 ? " calendar__cell--busy" : "") : " calendar__cell--empty"),
            },
            [
              el("div", { class: "calendar__day", text: date(iso) }),
              entry ? el("div", { class: "calendar__count", text: String(entry.orders) }) : null,
              entry
                ? el("div", {
                    class: "field__hint",
                    text:
                      (entry.customOrders ? entry.customOrders + " sur mesure · " : "") +
                      (entry.deliveries ? entry.deliveries + " livraison(s)" : "retraits"),
                  })
                : null,
            ],
          ),
        );
      }

      render([
        head("Calendrier de production"),
        el("p", { class: "muted", text: "Les journées chargées apparaissent en rose. Vous restez seule juge de ce que vous acceptez." }),
        el("section", { class: "panel" }, [el("div", { class: "calendar" }, cells)]),
        panel("Commandes de la période", [ordersTable(data.orders)]),
      ]);
    });
  }

  function customersView(params) {
    const search = params.get("search") || "";
    api("/api/admin/customers" + (search ? "?search=" + encodeURIComponent(search) : "")).then(
      function (customers) {
        const input = el("input", { type: "search", placeholder: "Nom, téléphone, e-mail", "aria-label": "Rechercher un client" });
        input.value = search;
        input.addEventListener("change", function () {
          window.location.hash = "#/clients?search=" + encodeURIComponent(input.value.trim());
        });

        render([
          head("Clients"),
          el("div", { class: "filters" }, [input]),
          el("section", { class: "panel" }, [
            table(
              ["Nom", "Téléphone", "Commandes", "Total dépensé", "Dernière commande", ""],
              customers,
              function (customer) {
                return el("tr", {}, [
                  el("td", {}, [el("a", { href: "#/clients/" + customer.id, text: customer.name })]),
                  el("td", { text: customer.phone }),
                  el("td", { text: String(customer.totalOrders) }),
                  el("td", { text: money(customer.totalSpend) }),
                  el("td", { text: customer.lastOrderDate ? date(customer.lastOrderDate) : "—" }),
                  el("td", { class: "actions" }, [
                    el("a", { class: "btn btn--ghost btn--sm", href: "#/clients/" + customer.id, text: "Ouvrir" }),
                  ]),
                ]);
              },
            ),
          ]),
        ]);
      },
    );
  }

  function customerDetail(id) {
    api("/api/admin/customers/" + id).then(function (data) {
      const customer = data.customer;

      function edit() {
        openForm(
          "Fiche client",
          [
            { name: "name", label: "Nom", required: true },
            { name: "phone", label: "Téléphone", required: true },
            { name: "whatsapp", label: "WhatsApp" },
            { name: "email", label: "E-mail", type: "email" },
            { name: "address", label: "Adresse", type: "text" },
            { name: "preferences", label: "Préférences", type: "textarea", hint: "Parfums préférés, allergies, habitudes." },
            { name: "notes", label: "Notes", type: "textarea" },
          ],
          customer,
          function (values) {
            return api("/api/admin/customers/" + customer.id, { method: "PATCH", body: values }).then(
              function () {
                customerDetail(customer.id);
              },
            );
          },
        );
      }

      render([
        head(customer.name, [
          el("a", { class: "btn btn--quiet btn--sm", href: "#/clients", text: "← Retour" }),
          actionButton("Modifier", edit, "ghost"),
        ]),
        el("section", { class: "panel" }, [
          el("div", { class: "detail-grid detail" }, [
            el("dl", {}, [
              el("dt", { text: "Téléphone" }),
              el("dd", { text: customer.phone }),
              el("dt", { text: "WhatsApp" }),
              el("dd", { text: customer.whatsapp || "—" }),
              el("dt", { text: "E-mail" }),
              el("dd", { text: customer.email || "—" }),
            ]),
            el("dl", {}, [
              el("dt", { text: "Adresse" }),
              el("dd", { text: customer.address || "—" }),
              el("dt", { text: "Client depuis" }),
              el("dd", { text: date(customer.createdAt) }),
            ]),
            el("dl", {}, [
              el("dt", { text: "Commandes" }),
              el("dd", { text: String(customer.totalOrders) }),
              el("dt", { text: "Total dépensé" }),
              el("dd", { text: money(customer.totalSpend) }),
              el("dt", { text: "Dernière commande" }),
              el("dd", { text: customer.lastOrderDate ? date(customer.lastOrderDate) : "—" }),
            ]),
          ]),
          customer.preferences ? el("div", { class: "note-box", text: "Préférences : " + customer.preferences }) : null,
          customer.notes ? el("div", { class: "note-box", text: customer.notes }) : null,
        ]),
        panel("Historique des commandes", [ordersTable(data.orders)]),
      ]);
    });
  }

  function productsView() {
    Promise.all([api("/api/admin/products"), api("/api/admin/categories")]).then(function (results) {
      const products = results[0];
      state.categories = results[1];

      const categoryOptions = state.categories.map(function (category) {
        return { value: category.id, label: category.name };
      });

      function form(product) {
        openForm(
          product ? "Modifier le produit" : "Nouveau produit",
          [
            { name: "name", label: "Nom", required: true },
            { name: "categoryId", label: "Catégorie", type: "select", options: categoryOptions },
            { name: "description", label: "Description", type: "textarea" },
            { name: "ingredients", label: "Ingrédients", type: "textarea" },
            { name: "basePrice", label: "Prix de base", type: "text", hint: "Laisser vide pour un produit uniquement sur devis." },
            { name: "priceFrom", label: "Prix « à partir de »", type: "checkbox" },
            { name: "servings", label: "Nombre de parts", type: "number" },
            { name: "customisable", label: "Personnalisable", type: "checkbox" },
            { name: "available", label: "Disponible", type: "checkbox" },
            { name: "featured", label: "Mis en avant", type: "checkbox" },
            { name: "active", label: "Visible sur le site", type: "checkbox" },
            { name: "sortOrder", label: "Ordre d'affichage", type: "number" },
          ],
          product
            ? Object.assign({}, product, { basePrice: fromMinor(product.basePrice) })
            : { available: true, active: true, sortOrder: 0, categoryId: categoryOptions[0] && categoryOptions[0].value },
          function (values) {
            const body = {
              name: values.name,
              categoryId: values.categoryId,
              description: values.description,
              ingredients: values.ingredients,
              basePrice: values.basePrice === "" ? null : toMinor(values.basePrice),
              priceFrom: values.priceFrom,
              servings: values.servings === "" ? null : Number(values.servings),
              customisable: values.customisable,
              available: values.available,
              featured: values.featured,
              active: values.active,
              sortOrder: Number(values.sortOrder) || 0,
            };
            const request = product
              ? api("/api/admin/products/" + product.id, { method: "PATCH", body: body })
              : api("/api/admin/products", { method: "POST", body: body });
            return request.then(productsView);
          },
        );
      }

      render([
        head("Produits", [actionButton("Nouveau produit", function () { form(null); }, "primary")]),
        el("section", { class: "panel" }, [
          table(
            ["Nom", "Catégorie", "Prix", "Parts", "État", ""],
            products,
            function (product) {
              return el("tr", {}, [
                el("td", {}, [
                  el("div", { text: product.name }),
                  el("div", { class: "field__hint", text: product.slug }),
                ]),
                el("td", { text: product.categorySlug }),
                el("td", {
                  text:
                    product.basePrice === null
                      ? "Sur devis"
                      : (product.priceFrom ? "dès " : "") + money(product.basePrice),
                }),
                el("td", { text: product.servings ? String(product.servings) : "—" }),
                el("td", {}, [
                  el("span", {
                    class: "status-chip " + (product.active ? "status-CONFIRMED" : "status-CANCELLED"),
                    text: product.active ? (product.available ? "En ligne" : "Indisponible") : "Masqué",
                  }),
                ]),
                el("td", { class: "actions" }, [
                  actionButton("Options", function () {
                    window.location.hash = "#/options?productId=" + product.id;
                  }),
                  actionButton("Photos", function () {
                    productMedia(product);
                  }),
                  actionButton("Modifier", function () {
                    form(product);
                  }, "ghost"),
                  actionButton("Supprimer", function () {
                    if (!window.confirm("Supprimer « " + product.name + " » ?")) return;
                    api("/api/admin/products/" + product.id, { method: "DELETE" }).then(productsView);
                  }),
                ]),
              ]);
            },
          ),
        ]),
      ]);
    });
  }

  function productMedia(product) {
    api("/api/admin/media").then(function (library) {
      const selected = new Set((product.media || []).map(function (asset) {
        return asset.id;
      }));
      const body = document.querySelector("[data-modal-body]");
      document.querySelector("[data-modal-title]").textContent = "Photos — " + product.name;
      body.textContent = "";
      modalSubmit = function () {
        return api("/api/admin/products/" + product.id + "/media", {
          method: "PUT",
          body: { mediaIds: Array.from(selected) },
        }).then(productsView);
      };

      if (library.length === 0) {
        body.appendChild(
          el("p", { class: "muted", text: "Aucune photo dans la bibliothèque. Ajoutez-en depuis la section Photos." }),
        );
      }

      const grid = el("div", { class: "media-grid" });
      library.forEach(function (asset) {
        const checkbox = el("input", { type: "checkbox" });
        checkbox.checked = selected.has(asset.id);
        checkbox.addEventListener("change", function () {
          if (checkbox.checked) selected.add(asset.id);
          else selected.delete(asset.id);
        });
        grid.appendChild(
          el("figure", {}, [
            el("img", { src: asset.url, alt: asset.alt || "", loading: "lazy" }),
            el("figcaption", {}, [el("label", { class: "choice" }, [checkbox, document.createTextNode("Utiliser")])]),
          ]),
        );
      });
      body.appendChild(grid);
      body.appendChild(el("p", { class: "field__error", "data-modal-error": true }));
      modal.showModal();
    });
  }

  function categoriesView() {
    api("/api/admin/categories").then(function (categories) {
      function form(category) {
        openForm(
          category ? "Modifier la catégorie" : "Nouvelle catégorie",
          [
            { name: "name", label: "Nom", required: true },
            {
              name: "kind",
              label: "Type de commande",
              type: "select",
              options: [
                { value: "standard", label: "Commande directe" },
                { value: "custom", label: "Sur devis uniquement" },
                { value: "both", label: "Les deux" },
              ],
            },
            { name: "description", label: "Description", type: "textarea" },
            { name: "sortOrder", label: "Ordre", type: "number" },
            { name: "active", label: "Visible", type: "checkbox" },
          ],
          category || { kind: "standard", active: true, sortOrder: categories.length + 1 },
          function (values) {
            const body = {
              name: values.name,
              kind: values.kind,
              description: values.description,
              sortOrder: Number(values.sortOrder) || 0,
              active: values.active,
            };
            const request = category
              ? api("/api/admin/categories/" + category.id, { method: "PATCH", body: body })
              : api("/api/admin/categories", { method: "POST", body: body });
            return request.then(categoriesView);
          },
        );
      }

      render([
        head("Catégories", [actionButton("Nouvelle catégorie", function () { form(null); }, "primary")]),
        el("p", { class: "muted", text: "Ajoutez librement de nouvelles familles de créations : desserts, pâtisseries, traiteur, boissons, plateaux salés…" }),
        el("section", { class: "panel" }, [
          table(["Nom", "Identifiant", "Type", "Ordre", "Visible", ""], categories, function (category) {
            return el("tr", {}, [
              el("td", { text: category.name }),
              el("td", { text: category.slug }),
              el("td", {
                text:
                  category.kind === "custom"
                    ? "Sur devis"
                    : category.kind === "both"
                      ? "Les deux"
                      : "Commande directe",
              }),
              el("td", { text: String(category.sortOrder) }),
              el("td", { text: category.active ? "Oui" : "Non" }),
              el("td", { class: "actions" }, [
                actionButton("Modifier", function () { form(category); }, "ghost"),
                actionButton("Supprimer", function () {
                  if (!window.confirm("Supprimer cette catégorie ?")) return;
                  api("/api/admin/categories/" + category.id, { method: "DELETE" })
                    .then(categoriesView)
                    .catch(function (error) {
                      toast(error.message, "error");
                    });
                }),
              ]),
            ]);
          }),
        ]),
      ]);
    });
  }

  const OPTION_KINDS = [
    { value: "size", label: "Taille" },
    { value: "flavour", label: "Parfum" },
    { value: "filling", label: "Garniture" },
    { value: "decoration", label: "Décoration" },
    { value: "shape", label: "Forme" },
    { value: "occasion", label: "Occasion" },
    { value: "extra", label: "Supplément" },
  ];

  function optionsView(params) {
    const productId = params.get("productId") || "";
    const path = "/api/admin/options" + (productId ? "?productId=" + encodeURIComponent(productId) : "");

    Promise.all([api(path), api("/api/admin/products")]).then(function (results) {
      const options = results[0];
      const products = results[1];
      const product = products.find(function (candidate) {
        return candidate.id === productId;
      });

      const selector = el("select", { "aria-label": "Choisir la liste d'options" }, [
        el("option", { value: "", text: "Choix des demandes sur mesure" }),
      ]);
      products.forEach(function (candidate) {
        const option = el("option", { value: candidate.id, text: "Produit : " + candidate.name });
        if (candidate.id === productId) option.selected = true;
        selector.appendChild(option);
      });
      selector.addEventListener("change", function () {
        window.location.hash = "#/options" + (selector.value ? "?productId=" + selector.value : "");
      });

      function form(option) {
        openForm(
          option ? "Modifier l'option" : "Nouvelle option",
          [
            { name: "label", label: "Intitulé", required: true },
            { name: "kind", label: "Type", type: "select", options: OPTION_KINDS },
            { name: "groupLabel", label: "Groupe affiché", hint: "Par exemple : Taille, Parfum, Garniture." },
            { name: "priceDelta", label: "Supplément de prix", type: "text", hint: "Uniquement pour les options de produit." },
            { name: "servings", label: "Nombre de parts", type: "number" },
            { name: "required", label: "Choix obligatoire", type: "checkbox" },
            { name: "multiple", label: "Choix multiples", type: "checkbox" },
            { name: "sortOrder", label: "Ordre", type: "number" },
            { name: "active", label: "Actif", type: "checkbox" },
          ],
          option
            ? Object.assign({}, option, { priceDelta: fromMinor(option.priceDelta) })
            : { active: true, kind: productId ? "size" : "flavour", sortOrder: options.length, groupLabel: "" },
          function (values) {
            const body = {
              label: values.label,
              kind: values.kind,
              groupLabel: values.groupLabel || values.label,
              priceDelta: toMinor(values.priceDelta) || 0,
              servings: values.servings === "" ? null : Number(values.servings),
              required: values.required,
              multiple: values.multiple,
              sortOrder: Number(values.sortOrder) || 0,
              active: values.active,
            };
            if (!option) body.productId = productId || null;
            const request = option
              ? api("/api/admin/options/" + option.id, { method: "PATCH", body: body })
              : api("/api/admin/options", { method: "POST", body: body });
            return request.then(function () {
              optionsView(params);
            });
          },
        );
      }

      render([
        head(product ? "Options — " + product.name : "Choix des demandes sur mesure", [
          actionButton("Nouvelle option", function () { form(null); }, "primary"),
        ]),
        el("p", { class: "muted", text: product
          ? "Les tailles, parfums et suppléments proposés sur la fiche de ce produit."
          : "Les listes proposées dans le formulaire « Créer mon gâteau » : occasions, formes, parfums, garnitures, décorations." }),
        el("div", { class: "filters" }, [selector]),
        el("section", { class: "panel" }, [
          table(["Intitulé", "Type", "Groupe", "Supplément", "Parts", "Actif", ""], options, function (option) {
            return el("tr", {}, [
              el("td", { text: option.label }),
              el("td", { text: (OPTION_KINDS.find(function (kind) { return kind.value === option.kind; }) || {}).label || option.kind }),
              el("td", { text: option.groupLabel }),
              el("td", { text: option.priceDelta ? money(option.priceDelta) : "—" }),
              el("td", { text: option.servings ? String(option.servings) : "—" }),
              el("td", { text: option.active ? "Oui" : "Non" }),
              el("td", { class: "actions" }, [
                actionButton("Modifier", function () { form(option); }, "ghost"),
                actionButton("Supprimer", function () {
                  if (!window.confirm("Supprimer cette option ?")) return;
                  api("/api/admin/options/" + option.id, { method: "DELETE" }).then(function () {
                    optionsView(params);
                  });
                }),
              ]),
            ]);
          }),
        ]),
      ]);
    });
  }

  function mediaView() {
    api("/api/admin/media").then(function (assets) {
      const input = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp", "aria-label": "Ajouter une photo" });
      input.addEventListener("change", function () {
        const file = input.files && input.files[0];
        if (!file) return;
        const data = new FormData();
        data.append("file", file);
        api("/api/admin/media", { method: "POST", body: data })
          .then(function () {
            toast("Photo ajoutée.");
            mediaView();
          })
          .catch(function (error) {
            toast(error.message, "error");
          });
      });

      const grid = el(
        "div",
        { class: "media-grid" },
        assets.map(function (asset) {
          return el("figure", {}, [
            el("img", { src: asset.url, alt: asset.alt || "", loading: "lazy" }),
            el("figcaption", {}, [
              el("span", { text: Math.round(asset.byteSize / 1024) + " Ko" }),
              el("span", {}, [
                actionButton("Texte", function () {
                  openForm(
                    "Texte alternatif",
                    [{ name: "alt", label: "Description de l'image", hint: "Lue par les lecteurs d'écran et affichée si l'image ne charge pas." }],
                    asset,
                    function (values) {
                      return api("/api/admin/media/" + asset.id, { method: "PATCH", body: values }).then(mediaView);
                    },
                  );
                }),
                actionButton("✕", function () {
                  if (!window.confirm("Supprimer cette photo ?")) return;
                  api("/api/admin/media/" + asset.id, { method: "DELETE" }).then(mediaView);
                }),
              ]),
            ]),
          ]);
        }),
      );

      render([
        head("Photos"),
        el("section", { class: "panel" }, [
          el("p", { class: "muted", text: "Les photos ajoutées ici alimentent les fiches produits et la galerie du site. JPEG, PNG ou WebP, 6 Mo maximum." }),
          input,
        ]),
        el("section", { class: "panel" }, [
          assets.length ? grid : el("div", { class: "empty" }, [el("p", { text: "Aucune photo pour le moment." })]),
        ]),
      ]);
    });
  }

  function testimonialsView() {
    Promise.all([api("/api/admin/testimonials"), api("/api/admin/products")]).then(function (results) {
      const testimonials = results[0];
      const products = results[1];

      function form(testimonial) {
        openForm(
          testimonial ? "Modifier le témoignage" : "Nouveau témoignage",
          [
            { name: "customerName", label: "Nom du client", required: true },
            { name: "body", label: "Témoignage", type: "textarea", required: true },
            {
              name: "productId",
              label: "Création concernée",
              type: "select",
              options: [{ value: "", label: "Aucune" }].concat(
                products.map(function (product) {
                  return { value: product.id, label: product.name };
                }),
              ),
            },
            { name: "eventDate", label: "Date de l'événement", type: "date" },
            { name: "published", label: "Publié sur le site", type: "checkbox" },
            { name: "sortOrder", label: "Ordre", type: "number" },
          ],
          testimonial || { published: false, sortOrder: testimonials.length },
          function (values) {
            const body = {
              customerName: values.customerName,
              body: values.body,
              productId: values.productId || null,
              eventDate: values.eventDate || null,
              published: values.published,
              sortOrder: Number(values.sortOrder) || 0,
            };
            const request = testimonial
              ? api("/api/admin/testimonials/" + testimonial.id, { method: "PATCH", body: body })
              : api("/api/admin/testimonials", { method: "POST", body: body });
            return request.then(testimonialsView);
          },
        );
      }

      render([
        head("Témoignages", [actionButton("Nouveau témoignage", function () { form(null); }, "primary")]),
        el("p", { class: "muted", text: "Seuls les témoignages que vous saisissez et publiez apparaissent sur le site." }),
        el("section", { class: "panel" }, [
          table(["Client", "Témoignage", "Création", "Publié", ""], testimonials, function (testimonial) {
            return el("tr", {}, [
              el("td", { text: testimonial.customerName }),
              el("td", { text: testimonial.body.length > 90 ? testimonial.body.slice(0, 89) + "…" : testimonial.body }),
              el("td", { text: testimonial.productName || "—" }),
              el("td", { text: testimonial.published ? "Oui" : "Non" }),
              el("td", { class: "actions" }, [
                actionButton(testimonial.published ? "Dépublier" : "Publier", function () {
                  api("/api/admin/testimonials/" + testimonial.id, {
                    method: "PATCH",
                    body: { published: !testimonial.published },
                  }).then(testimonialsView);
                }),
                actionButton("Modifier", function () { form(testimonial); }, "ghost"),
                actionButton("Supprimer", function () {
                  if (!window.confirm("Supprimer ce témoignage ?")) return;
                  api("/api/admin/testimonials/" + testimonial.id, { method: "DELETE" }).then(testimonialsView);
                }),
              ]),
            ]);
          }),
        ]),
      ]);
    });
  }

  function inventoryView() {
    Promise.all([api("/api/admin/inventory"), api("/api/admin/suppliers")]).then(function (results) {
      const items = results[0];
      const suppliers = results[1];

      function form(item) {
        openForm(
          item ? "Modifier l'article" : "Nouvel article",
          [
            { name: "name", label: "Article", required: true },
            { name: "category", label: "Famille", hint: "Par exemple : farines, produits laitiers, emballages." },
            { name: "quantity", label: "Quantité", type: "number", step: "0.01" },
            { name: "unit", label: "Unité", hint: "kg, L, pièce…" },
            { name: "minimumStock", label: "Stock minimum", type: "number", step: "0.01" },
            { name: "purchasePrice", label: "Prix d'achat", type: "text" },
            {
              name: "supplierId",
              label: "Fournisseur",
              type: "select",
              options: [{ value: "", label: "Aucun" }].concat(
                suppliers.map(function (supplier) {
                  return { value: supplier.id, label: supplier.name };
                }),
              ),
            },
          ],
          item
            ? Object.assign({}, item, { purchasePrice: fromMinor(item.purchasePrice) })
            : { quantity: 0, minimumStock: 0, unit: "kg" },
          function (values) {
            const body = {
              name: values.name,
              category: values.category,
              quantity: Number(values.quantity) || 0,
              unit: values.unit,
              minimumStock: Number(values.minimumStock) || 0,
              purchasePrice: values.purchasePrice === "" ? null : toMinor(values.purchasePrice),
              supplierId: values.supplierId || null,
            };
            const request = item
              ? api("/api/admin/inventory/" + item.id, { method: "PATCH", body: body })
              : api("/api/admin/inventory", { method: "POST", body: body });
            return request.then(inventoryView);
          },
        );
      }

      render([
        head("Stock", [actionButton("Nouvel article", function () { form(null); }, "primary")]),
        el("p", { class: "muted", text: "Un article passe en alerte dès que sa quantité atteint le minimum défini." }),
        el("section", { class: "panel" }, [
          table(["Article", "Famille", "Quantité", "Minimum", "Fournisseur", "Mis à jour", ""], items, function (item) {
            const low = item.quantity <= item.minimumStock;
            return el("tr", {}, [
              el("td", {}, [
                el("span", { text: item.name }),
                low ? el("span", { class: "status-chip status-NEW", text: " stock bas" }) : null,
              ]),
              el("td", { text: item.category || "—" }),
              el("td", { text: item.quantity + " " + item.unit }),
              el("td", { text: String(item.minimumStock) }),
              el("td", { text: item.supplierName || "—" }),
              el("td", { text: date(item.updatedAt) }),
              el("td", { class: "actions" }, [
                actionButton("Modifier", function () { form(item); }, "ghost"),
                actionButton("Supprimer", function () {
                  if (!window.confirm("Supprimer cet article ?")) return;
                  api("/api/admin/inventory/" + item.id, { method: "DELETE" }).then(inventoryView);
                }),
              ]),
            ]);
          }),
        ]),
      ]);
    });
  }

  function suppliersView() {
    api("/api/admin/suppliers").then(function (suppliers) {
      function form(supplier) {
        openForm(
          supplier ? "Modifier le fournisseur" : "Nouveau fournisseur",
          [
            { name: "name", label: "Nom", required: true },
            { name: "phone", label: "Téléphone" },
            { name: "email", label: "E-mail", type: "email" },
            { name: "notes", label: "Notes", type: "textarea" },
          ],
          supplier || {},
          function (values) {
            const request = supplier
              ? api("/api/admin/suppliers/" + supplier.id, { method: "PATCH", body: values })
              : api("/api/admin/suppliers", { method: "POST", body: values });
            return request.then(suppliersView);
          },
        );
      }

      render([
        head("Fournisseurs", [actionButton("Nouveau fournisseur", function () { form(null); }, "primary")]),
        el("section", { class: "panel" }, [
          table(["Nom", "Téléphone", "E-mail", ""], suppliers, function (supplier) {
            return el("tr", {}, [
              el("td", { text: supplier.name }),
              el("td", { text: supplier.phone || "—" }),
              el("td", { text: supplier.email || "—" }),
              el("td", { class: "actions" }, [
                actionButton("Modifier", function () { form(supplier); }, "ghost"),
                actionButton("Supprimer", function () {
                  if (!window.confirm("Supprimer ce fournisseur ?")) return;
                  api("/api/admin/suppliers/" + supplier.id, { method: "DELETE" }).then(suppliersView);
                }),
              ]),
            ]);
          }),
        ]),
      ]);
    });
  }

  const APPOINTMENT_LABELS = {
    NEW: "Nouvelle",
    SCHEDULED: "Planifié",
    DONE: "Terminé",
    CANCELLED: "Annulé",
  };

  function appointmentsView() {
    api("/api/admin/appointments").then(function (appointments) {
      render([
        head("Demandes de rendez-vous"),
        el("section", { class: "panel" }, [
          table(["Reçue le", "Nom", "Contact", "Souhait", "Motif", "Statut", ""], appointments, function (appointment) {
            return el("tr", {}, [
              el("td", { text: date(appointment.createdAt) }),
              el("td", { text: appointment.name }),
              el("td", {}, [
                el("div", { text: appointment.phone }),
                appointment.email ? el("div", { class: "field__hint", text: appointment.email }) : null,
              ]),
              el("td", {
                text:
                  (appointment.preferredDate ? date(appointment.preferredDate) : "—") +
                  (appointment.preferredTime ? " · " + appointment.preferredTime : ""),
              }),
              el("td", {}, [
                el("div", { text: appointment.reason }),
                appointment.message ? el("div", { class: "field__hint", text: appointment.message }) : null,
              ]),
              el("td", { text: APPOINTMENT_LABELS[appointment.status] || appointment.status }),
              el("td", { class: "actions" }, [
                actionButton("Modifier", function () {
                  openForm(
                    "Rendez-vous — " + appointment.name,
                    [
                      {
                        name: "status",
                        label: "Statut",
                        type: "select",
                        options: Object.keys(APPOINTMENT_LABELS).map(function (key) {
                          return { value: key, label: APPOINTMENT_LABELS[key] };
                        }),
                      },
                      { name: "preferredDate", label: "Date convenue", type: "date" },
                      { name: "preferredTime", label: "Heure convenue", type: "time" },
                      { name: "internalNotes", label: "Notes internes", type: "textarea" },
                    ],
                    appointment,
                    function (values) {
                      return api("/api/admin/appointments/" + appointment.id, {
                        method: "PATCH",
                        body: values,
                      }).then(appointmentsView);
                    },
                  );
                }, "ghost"),
              ]),
            ]);
          }),
        ]),
      ]);
    });
  }

  function notificationsView() {
    api("/api/admin/notifications").then(function (notifications) {
      render([
        head("Notifications", [
          actionButton("Tout marquer comme lu", function () {
            api("/api/admin/notifications/read", { method: "POST" }).then(function () {
              badge("notifications", 0);
              notificationsView();
            });
          }, "ghost"),
        ]),
        el("p", { class: "muted", text: "Chaque demande reçue depuis le site laisse une trace ici, même si l'envoi d'e-mail n'est pas configuré." }),
        el("section", { class: "panel" }, [
          table(["Reçue le", "Objet", "Détail", "Envoi"], notifications, function (notification) {
            return el("tr", {}, [
              el("td", { text: date(notification.createdAt) }),
              el("td", {}, [
                notification.orderId
                  ? el("a", { href: "#/commandes/" + notification.orderId, text: notification.subject })
                  : el("span", { text: notification.subject }),
                notification.readAt ? null : el("span", { class: "status-chip status-NEW", text: " nouveau" }),
              ]),
              el("td", {}, [el("div", { class: "note-box", text: notification.body })]),
              el("td", {
                text: notification.channel === "email"
                  ? notification.sentAt
                    ? "E-mail envoyé"
                    : notification.error || "E-mail non envoyé"
                  : "Interne",
              }),
            ]);
          }),
        ]),
      ]);
    });
  }

  const SETTING_FIELDS = [
    ["businessName", "Nom de la maison"],
    ["tagline", "Phrase d'accroche"],
    ["phone", "Téléphone"],
    ["whatsapp", "WhatsApp"],
    ["email", "E-mail public"],
    ["address", "Adresse"],
    ["hours", "Horaires"],
    ["instagram", "Instagram (lien)"],
    ["facebook", "Facebook (lien)"],
    ["currency", "Devise (code ISO, ex. EUR, XAF)"],
    ["locale", "Format régional (ex. fr-FR)"],
    ["leadTimeDays", "Délai minimum de commande (jours)"],
    ["announcement", "Annonce affichée sur le site"],
    ["ownerNotificationEmail", "E-mail de réception des demandes"],
  ];

  function settingsView() {
    api("/api/admin/settings").then(function (settings) {
      state.settings.currency = settings.currency || "EUR";
      state.settings.locale = settings.locale || "fr-FR";

      const form = el("form", { class: "form" });
      SETTING_FIELDS.forEach(function (entry) {
        const id = "s_" + entry[0];
        const input = el("input", { type: "text", id: id, name: entry[0] });
        input.value = settings[entry[0]] || "";
        form.appendChild(el("div", { class: "field" }, [el("label", { for: id, text: entry[1] }), input]));
      });

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        const data = new FormData(form);
        const values = {};
        data.forEach(function (value, key) {
          values[key] = value;
        });
        api("/api/admin/settings", { method: "PUT", body: values }).then(function () {
          toast("Paramètres enregistrés.");
          settingsView();
        });
      });
      form.appendChild(el("button", { class: "btn btn--primary", type: "submit", text: "Enregistrer" }));

      const passwordForm = el("form", { class: "form" }, [
        el("div", { class: "field" }, [
          el("label", { for: "currentPassword", text: "Mot de passe actuel" }),
          el("input", { type: "password", id: "currentPassword", name: "currentPassword", autocomplete: "current-password" }),
        ]),
        el("div", { class: "field" }, [
          el("label", { for: "newPassword", text: "Nouveau mot de passe" }),
          el("input", { type: "password", id: "newPassword", name: "newPassword", autocomplete: "new-password" }),
        ]),
        el("button", { class: "btn btn--ghost", type: "submit", text: "Changer le mot de passe" }),
      ]);
      passwordForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const data = new FormData(passwordForm);
        api("/api/admin/password", {
          method: "POST",
          body: { currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") },
        })
          .then(function (response) {
            window.alert(response.message);
            window.location.reload();
          })
          .catch(function (error) {
            toast((error.payload && error.payload.errors && error.payload.errors[0].message) || error.message, "error");
          });
      });

      render([
        head("Paramètres"),
        panel("Coordonnées et affichage", [form]),
        panel("Sécurité", [passwordForm]),
      ]);
    });
  }

  /* ---------------------------------------------------------------- routing */

  const ROUTES = [
    [/^\/$/, dashboard],
    [/^\/commandes$/, function (m, params) { ordersView(params); }],
    [/^\/commandes\/(.+)$/, function (m) { orderDetail(m[1]); }],
    [/^\/calendrier$/, calendarView],
    [/^\/clients$/, function (m, params) { customersView(params); }],
    [/^\/clients\/(.+)$/, function (m) { customerDetail(m[1]); }],
    [/^\/produits$/, productsView],
    [/^\/categories$/, categoriesView],
    [/^\/options$/, function (m, params) { optionsView(params); }],
    [/^\/medias$/, mediaView],
    [/^\/temoignages$/, testimonialsView],
    [/^\/stock$/, inventoryView],
    [/^\/fournisseurs$/, suppliersView],
    [/^\/rendez-vous$/, appointmentsView],
    [/^\/notifications$/, notificationsView],
    [/^\/parametres$/, settingsView],
  ];

  function routeNow() {
    if (!state.user) return;
    const raw = window.location.hash.replace(/^#/, "") || "/";
    const [path, search] = raw.split("?");
    const params = new URLSearchParams(search || "");

    document.querySelectorAll(".admin-nav a").forEach(function (link) {
      const target = link.getAttribute("href").replace(/^#/, "").split("?")[0];
      if (target === path) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    for (const entry of ROUTES) {
      const match = entry[0].exec(path);
      if (match) {
        try {
          entry[1](match, params);
        } catch (error) {
          render([el("div", { class: "alert alert--error", text: error.message })]);
        }
        return;
      }
    }
    render([el("div", { class: "alert alert--error", text: "Section inconnue." })]);
  }

  /* ---------------------------------------------------------------- boot */

  document.querySelector("[data-login-form]").addEventListener("submit", function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const status = document.querySelector("[data-login-status]");
    status.className = "muted";
    status.textContent = "Connexion…";

    fetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Delices-Admin": "1" },
      body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
    })
      .then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok) throw new Error(payload.error || "Connexion impossible.");
          return payload;
        });
      })
      .then(function (payload) {
        state.user = payload.user;
        status.textContent = "";
        showConsole();
        if (!window.location.hash) window.location.hash = "#/";
        routeNow();
      })
      .catch(function (error) {
        status.className = "alert alert--error";
        status.textContent = error.message;
      });
  });

  document.querySelector("[data-logout]").addEventListener("click", function () {
    api("/api/admin/logout", { method: "POST" }).then(function () {
      state.user = null;
      showLogin();
    });
  });

  window.addEventListener("hashchange", routeNow);

  fetch("/api/admin/me", { credentials: "same-origin" })
    .then(function (response) {
      if (!response.ok) throw new Error("anonymous");
      return response.json();
    })
    .then(function (payload) {
      state.user = payload.user;
      showConsole();
      routeNow();
    })
    .catch(function () {
      showLogin();
    });
})();
