(function () {
  "use strict";

  var cfg = window.SITE_CONFIG || {};
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }

  // +380XXXXXXXXX → +380 XX XXX XX XX
  function formatPhone(p) {
    var d = p.replace(/\D/g, "");
    return "+" + d.slice(0, 3) + " " + d.slice(3, 5) + " " + d.slice(5, 8) + " " + d.slice(8, 10) + " " + d.slice(10);
  }

  // Приймає 0XXXXXXXXX, 380XXXXXXXXX, +380…, з пробілами, дужками й дефісами. Повертає +380XXXXXXXXX або null.
  function normalizePhone(raw) {
    var d = String(raw || "").replace(/[\s()\-.]/g, "");
    if (!/^\+?\d+$/.test(d)) return null;
    d = d.replace(/^\+/, "");
    if (/^0\d{9}$/.test(d)) d = "38" + d;
    else if (/^80\d{9}$/.test(d)) d = "3" + d;
    return /^380[1-9]\d{8}$/.test(d) ? "+" + d : null;
  }

  /* ---------- Контакти з конфігурації ---------- */
  var phones = cfg.phones || {};
  var mainPhone = phones.main ? normalizePhone(phones.main) : null;

  if (mainPhone) {
    $$("[data-phone-link]").forEach(function (a) { a.href = "tel:" + mainPhone; });
    $$("[data-phone-text]").forEach(function (s) { s.textContent = formatPhone(mainPhone); });
  } else {
    // Немає підтвердженого номера: кнопки ведуть до блоку контактів, а не на фіктивний tel:
    $$("[data-phone-text]").forEach(function (s) { s.closest("a").hidden = true; });
  }

  var contactItems = [];
  [phones.main, phones.extra].forEach(function (p) {
    var n = p && normalizePhone(p);
    if (n) contactItems.push({ label: formatPhone(n), url: "tel:" + n });
  });
  (cfg.messengers || []).forEach(function (m) { if (m && m.url) contactItems.push(m); });

  var socialNames = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook" };
  var socialItems = Object.keys(socialNames)
    .filter(function (k) { return cfg.socials && cfg.socials[k]; })
    .map(function (k) { return { label: socialNames[k], url: cfg.socials[k] }; });

  function linkList(items) {
    return items.map(function (it) {
      var li = el("li");
      var external = /^https?:/.test(it.url);
      var a = el("a", external ? { href: it.url, target: "_blank", rel: "noopener" } : { href: it.url }, it.label);
      li.appendChild(a);
      return li;
    });
  }

  var contactsList = $("[data-contacts]");
  if (contactItems.length && contactsList) {
    contactsList.innerHTML = "";
    linkList(contactItems).forEach(function (li) { contactsList.appendChild(li); });
  }

  var footerLinks = $("[data-footer-contacts]");
  if (footerLinks) linkList(contactItems.concat(socialItems)).forEach(function (li) { footerLinks.appendChild(li); });

  if (socialItems.length) {
    var wrap = $("[data-socials-wrap]");
    var holder = $("[data-socials]");
    socialItems.forEach(function (s, i) {
      if (i) holder.appendChild(document.createTextNode(", "));
      holder.appendChild(el("a", { href: s.url, target: "_blank", rel: "noopener" }, s.label));
    });
    wrap.hidden = false;
  }

  var privacy = $("[data-privacy-link]");
  if (privacy) {
    if (cfg.privacyUrl) privacy.href = cfg.privacyUrl;
    else privacy.replaceWith(document.createTextNode("Політика конфіденційності — готується."));
  }
  var legal = $("[data-legal]");
  if (cfg.legal) legal.textContent = cfg.legal;
  else legal.hidden = true;

  if (!cfg.prototype) $$("[data-proto]").forEach(function (n) { n.hidden = true; });

  /* ---------- Відгуки: лише підтверджені ---------- */
  var reviews = (cfg.reviews || []).filter(function (r) { return r && r.text && r.author; });
  if (reviews.length) {
    var list = $("[data-reviews-list]");
    reviews.forEach(function (r) {
      var card = el("figure", { class: "quote" });
      card.appendChild(el("p", null, "«" + r.text + "»"));
      card.appendChild(el("footer", null, "— " + r.author + (r.place ? ", " + r.place : "")));
      list.appendChild(card);
    });
    $("[data-reviews]").hidden = false;
    $("[data-reviews-link]").hidden = false;
  }

  /* ---------- Мобільне меню ---------- */
  var burger = $(".burger");
  var nav = $("#nav");
  function setMenu(open) {
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Закрити меню" : "Відкрити меню");
    nav.classList.toggle("is-open", open);
    document.body.classList.toggle("menu-open", open);
  }
  burger.addEventListener("click", function () { setMenu(burger.getAttribute("aria-expanded") !== "true"); });
  nav.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && nav.classList.contains("is-open")) { setMenu(false); burger.focus(); }
  });
  window.matchMedia("(min-width: 961px)").addEventListener("change", function (mq) { if (mq.matches) setMenu(false); });

  /* ---------- Форма заявки ---------- */
  var form = $("#lead-form");
  var phoneInput = $("#f-phone");
  var cityInput = $("#f-city");
  var serviceSelect = $("#f-service");
  var statusBox = $(".form__status", form);
  var submitBtn = $("button[type=submit]", form);

  function goToForm(focusEl) {
    $("#zaiavka").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setTimeout(function () { focusEl.focus({ preventScroll: true }); }, 400);
  }

  // Кнопка з картки послуги — попередньо вибирає послугу
  $$("[data-service]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      serviceSelect.value = btn.getAttribute("data-service");
      goToForm(phoneInput);
    });
  });
  var cityBtn = $("[data-focus-city]");
  if (cityBtn) cityBtn.addEventListener("click", function (e) { e.preventDefault(); goToForm(cityInput); });

  function setFieldError(input, msg) {
    var err = $("#" + input.id + "-err");
    input.setAttribute("aria-invalid", msg ? "true" : "false");
    if (err) err.textContent = msg || "";
  }

  function validate() {
    var ok = true;
    var phone = normalizePhone(phoneInput.value);
    if (!phoneInput.value.trim()) { setFieldError(phoneInput, "Вкажіть номер телефону."); ok = false; }
    else if (!phone) { setFieldError(phoneInput, "Перевірте номер: наприклад, 067 123 45 67 або +380 67 123 45 67."); ok = false; }
    else setFieldError(phoneInput, "");

    if (cityInput.value.trim().length < 2) { setFieldError(cityInput, "Вкажіть населений пункт."); ok = false; }
    else setFieldError(cityInput, "");

    return ok ? phone : null;
  }

  phoneInput.addEventListener("blur", function () { if (phoneInput.value.trim()) validate(); });

  function showStatus(kind, text) {
    statusBox.hidden = false;
    statusBox.className = "form__status form__status--" + kind;
    statusBox.textContent = text;
  }

  var MESSAGES = {
    not_configured: "Заявку не надіслано: прийом заявок через сайт ще не підключено. Будь ласка, зв’яжіться з нами напряму.",
    rate_limited: "Забагато спроб поспіль. Зачекайте хвилину й спробуйте ще раз.",
    invalid: "Перевірте поля форми й спробуйте ще раз.",
    network: "Не вдалося надіслати заявку — немає зв’язку з сервером. Дані збережено у формі, спробуйте ще раз.",
    generic: "Не вдалося надіслати заявку. Дані збережено у формі, спробуйте ще раз або зв’яжіться з нами напряму.",
  };

  var sending = false;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;

    var phone = validate();
    if (!phone) {
      var firstBad = $("[aria-invalid=true]", form);
      if (firstBad) firstBad.focus();
      return;
    }

    var payload = {
      phone: phone,
      city: cityInput.value.trim(),
      name: $("#f-name").value.trim(),
      service: serviceSelect.value,
      comment: $("#f-comment").value.trim(),
      website: $("#f-website").value, // пастка для ботів
    };

    sending = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Надсилаємо…";
    showStatus("pending", "Надсилаємо заявку…");

    var ctrl = "AbortController" in window ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 15000);

    fetch(cfg.leadEndpoint || "/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; });
      })
      .then(function (r) {
        // Успіх — лише коли сервер підтвердив, що заявку прийнято системою доставки
        if (r.res.ok && r.data && r.data.ok === true) {
          form.reset();
          showStatus("success", "Дякуємо! Заявку прийнято — зв’яжемося з вами, щоб уточнити деталі.");
        } else {
          if (r.data && r.data.fields) {
            if (r.data.fields.phone) setFieldError(phoneInput, r.data.fields.phone);
            if (r.data.fields.city) setFieldError(cityInput, r.data.fields.city);
          }
          showStatus("error", MESSAGES[r.data && r.data.error] || MESSAGES.generic);
        }
      })
      .catch(function () { showStatus("error", MESSAGES.network); })
      .then(function () {
        if (timer) clearTimeout(timer);
        sending = false;
        submitBtn.disabled = false;
        submitBtn.textContent = "Надіслати заявку";
      });
  });

  /* ---------- Нижня панель: ховаємо, коли видно форму ---------- */
  var bar = $(".mobile-bar");
  if (bar && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      bar.classList.toggle("is-hidden", entries[0].isIntersecting);
    }, { threshold: 0.1 }).observe(form);
  }
})();
