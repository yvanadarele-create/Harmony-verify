/**
 * Shared browser code: settings, navigation, the basket, and the small helpers the
 * page scripts share.
 *
 * Everything that reaches the DOM goes through `text()` or `el()` — no innerHTML with
 * server data, so a product name or a customer note can never become markup.
 */
(function () {
  "use strict";

  const store = {
    settings: null,
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
        else if (key === "html") node.innerHTML = value;
        else if (key.startsWith("on") && typeof value === "function") {
          node.addEventListener(key.slice(2), value);
        } else node.setAttribute(key, value === true ? "" : String(value));
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function api(path, options) {
    const opts = Object.assign({ headers: {} }, options || {});
    opts.headers = Object.assign({ Accept: "application/json" }, opts.headers);
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, opts).then(function (response) {
      const isJson = (response.headers.get("content-type") || "").includes("application/json");
      return (isJson ? response.json() : response.text()).then(function (payload) {
        if (!response.ok) {
          const error = new Error((payload && payload.error) || "Une erreur est survenue.");
          error.status = response.status;
          error.payload = payload;
          throw error;
        }
        return payload;
      });
    });
  }

  function settings() {
    if (store.settings) return Promise.resolve(store.settings);
    return api("/api/settings").then(function (value) {
      store.settings = value;
      return value;
    });
  }

  function formatMoney(minor, config) {
    if (minor === null || minor === undefined) return "Sur devis";
    const currency = (config && config.currency) || "EUR";
    const locale = (config && config.locale) || "fr-FR";
    let digits = 2;
    try {
      digits = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits;
    } catch (error) {
      digits = 2;
    }
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
        minor / Math.pow(10, digits),
      );
    } catch (error) {
      return (minor / Math.pow(10, digits)).toFixed(digits) + " " + currency;
    }
  }

  function formatDate(iso, locale) {
    if (!iso) return "";
    try {
      return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString(
        locale || "fr-FR",
        { weekday: "long", day: "numeric", month: "long", year: "numeric" },
      );
    } catch (error) {
      return iso;
    }
  }

  function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
  }

  /* ---------------------------------------------------------------- basket */

  const CART_KEY = "delices.cart.v1";

  const cart = {
    read: function () {
      try {
        const raw = window.localStorage.getItem(CART_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    },
    write: function (items) {
      try {
        window.localStorage.setItem(CART_KEY, JSON.stringify(items));
      } catch (error) {
        /* storage unavailable — the basket simply does not persist */
      }
      document.dispatchEvent(new CustomEvent("cart:change", { detail: items }));
      paintCartCount();
    },
    add: function (line) {
      const items = cart.read();
      const signature = line.productId + "|" + (line.optionIds || []).slice().sort().join(",");
      const existing = items.find(function (item) {
        return item.productId + "|" + (item.optionIds || []).slice().sort().join(",") === signature;
      });
      if (existing) existing.quantity = Math.min(99, existing.quantity + line.quantity);
      else items.push(line);
      cart.write(items);
    },
    remove: function (index) {
      const items = cart.read();
      items.splice(index, 1);
      cart.write(items);
    },
    setQuantity: function (index, quantity) {
      const items = cart.read();
      if (!items[index]) return;
      items[index].quantity = Math.max(1, Math.min(99, quantity));
      cart.write(items);
    },
    clear: function () {
      cart.write([]);
    },
    count: function () {
      return cart.read().reduce(function (sum, item) {
        return sum + item.quantity;
      }, 0);
    },
  };

  function paintCartCount() {
    const count = cart.count();
    document.querySelectorAll("[data-cart-count]").forEach(function (node) {
      node.textContent = String(count);
      node.classList.toggle("is-hidden", count === 0);
    });
  }

  /* ---------------------------------------------------------------- chrome */

  function hydrateChrome() {
    settings()
      .then(function (config) {
        document.querySelectorAll("[data-setting]").forEach(function (node) {
          const value = config[node.getAttribute("data-setting")];
          if (!value) {
            const container = node.closest("[data-setting-wrap]");
            if (container) container.classList.add("is-hidden");
            return;
          }
          if (node.tagName === "A") {
            const kind = node.getAttribute("data-setting-link");
            if (kind === "tel") node.href = "tel:" + value.replace(/\s/g, "");
            else if (kind === "mailto") node.href = "mailto:" + value;
            else if (kind === "whatsapp") node.href = "https://wa.me/" + digitsOnly(value);
            else node.href = value;
          }
          if (node.getAttribute("data-setting-attr") === "href") return;
          node.textContent = value;
        });

        const fab = document.querySelector("[data-whatsapp-fab]");
        if (fab && config.whatsapp) {
          fab.href =
            "https://wa.me/" +
            digitsOnly(config.whatsapp) +
            "?text=" +
            encodeURIComponent("Bonjour, je souhaite passer une commande.");
          fab.setAttribute("data-ready", "true");
        }

        const announcement = document.querySelector("[data-announcement]");
        if (announcement && config.announcement) {
          announcement.textContent = config.announcement;
          announcement.classList.remove("is-hidden");
        }
      })
      .catch(function () {
        /* the page is still readable without live settings */
      });
  }

  function wireNav() {
    const toggle = document.querySelector("[data-nav-toggle]");
    const nav = document.querySelector("[data-nav]");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function () {
      const open = nav.getAttribute("data-open") === "true";
      nav.setAttribute("data-open", open ? "false" : "true");
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
    });
    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.setAttribute("data-open", "false");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  function markCurrentPage() {
    const here = window.location.pathname.replace(/\/$/, "") || "/";
    document.querySelectorAll("[data-nav] a").forEach(function (link) {
      const target = new URL(link.href, window.location.origin).pathname.replace(/\/$/, "") || "/";
      if (target === here) link.setAttribute("aria-current", "page");
    });
  }

  /* ---------------------------------------------------------------- forms */

  /** Paints server-side field errors next to the fields that produced them. */
  function showErrors(form, errors) {
    form.querySelectorAll("[data-error-for]").forEach(function (node) {
      node.textContent = "";
    });
    form.querySelectorAll("[aria-invalid]").forEach(function (node) {
      node.removeAttribute("aria-invalid");
    });
    let first = null;
    (errors || []).forEach(function (error) {
      const name = error.field.replace(/^customer\./, "");
      const field = form.querySelector('[name="' + name + '"]');
      const slot = form.querySelector('[data-error-for="' + name + '"]');
      if (slot) slot.textContent = error.message;
      if (field) {
        field.setAttribute("aria-invalid", "true");
        if (!first) first = field;
      }
      if (!first && slot) first = slot;
    });
    if (first && first.focus) first.focus();
    else if (first && first.scrollIntoView) first.scrollIntoView({ block: "center" });
  }

  function setStatus(node, message, kind) {
    if (!node) return;
    node.textContent = message || "";
    node.className = message ? "alert alert--" + (kind || "success") : "is-hidden";
  }

  /** Reads a form into a plain object, trimming strings and dropping empties. */
  function formValues(form) {
    const data = new FormData(form);
    const out = {};
    data.forEach(function (value, key) {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (out[key] === undefined) out[key] = trimmed;
      else if (Array.isArray(out[key])) out[key].push(trimmed);
      else out[key] = [out[key], trimmed];
    });
    return out;
  }

  function todayIso(offsetDays) {
    const date = new Date();
    date.setDate(date.getDate() + (offsetDays || 0));
    return date.toISOString().slice(0, 10);
  }

  /* ---------------------------------------------------------------- boot */

  document.addEventListener("DOMContentLoaded", function () {
    hydrateChrome();
    wireNav();
    markCurrentPage();
    paintCartCount();
  });

  window.Delices = {
    api: api,
    cart: cart,
    el: el,
    formatDate: formatDate,
    formatMoney: formatMoney,
    formValues: formValues,
    settings: settings,
    setStatus: setStatus,
    showErrors: showErrors,
    todayIso: todayIso,
  };
})();
