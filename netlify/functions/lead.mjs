/*
 * Ківі Сервіс — приймання заявок на Netlify (POST /api/lead).
 * Та сама логіка, що й у server.py для локального запуску: перевірка полів, пастка для ботів,
 * ліміт частоти, надсилання в Telegram. Успіх — лише коли Telegram підтвердив доставку.
 *
 * Змінні оточення (Netlify → Project configuration → Environment variables):
 *   TELEGRAM_BOT_TOKEN — токен від @BotFather (позначити як secret)
 *   TELEGRAM_CHAT_ID   — ID чату, куди надходять заявки
 */

const MAX_BODY = 8 * 1024;
const RATE_LIMIT = 5;               // заявок
const RATE_WINDOW = 10 * 60 * 1000; // за 10 хвилин з однієї IP-адреси
const SERVICES = new Set(["", "Чистка криниці", "Відкачування септика", "Прочищення каналізації", "Відеодіагностика"]);

// Лічильник живе в межах одного екземпляра функції — базовий захист, не гарантія
const hits = new Map();

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function normalizePhone(raw) {
  let d = String(raw || "").replace(/[\s()\-.]/g, "");
  if (!/^\+?\d+$/.test(d)) return null;
  d = d.replace(/^\+/, "");
  if (/^0\d{9}$/.test(d)) d = "38" + d;
  else if (/^80\d{9}$/.test(d)) d = "3" + d;
  return /^380[1-9]\d{8}$/.test(d) ? "+" + d : null;
}

function clean(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  if (list.length >= RATE_LIMIT) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

function formatLead(lead) {
  const lines = ["Нова заявка з сайту Ківі Сервіс", "", "Телефон: " + lead.phone, "Населений пункт: " + lead.city];
  if (lead.name) lines.push("Ім’я: " + lead.name);
  if (lead.service) lines.push("Послуга: " + lead.service);
  if (lead.comment) lines.push("", "Коментар: " + lead.comment);
  lines.push("", "Отримано: " + lead.receivedAt);
  return lines.join("\n");
}

async function deliverLead(lead, env, fetchImpl) {
  const res = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: formatLead(lead), disable_web_page_preview: true }),
  });
  const data = await res.json().catch(() => ({}));
  // Токен у текст помилки не потрапляє — лише код відповіді
  if (!res.ok || !data.ok) throw new Error("Telegram HTTP " + res.status);
}

// Уся логіка — тут; env і fetch передаються ззовні, щоб функцію можна було перевірити без Netlify
export async function handle(request, ip, env, fetchImpl) {
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return json(503, { ok: false, error: "not_configured" });
  }

  const raw = await request.text();
  if (!raw || raw.length > MAX_BODY) return json(400, { ok: false, error: "invalid" });

  let data;
  try {
    data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
  } catch {
    return json(400, { ok: false, error: "invalid" });
  }

  if (rateLimited(ip || "unknown")) return json(429, { ok: false, error: "rate_limited" });

  // Бот заповнив приховане поле — відхиляємо без імітації успіху
  if (clean(data.website, 200)) return json(400, { ok: false, error: "invalid" });

  const fields = {};
  const phone = normalizePhone(data.phone);
  if (!phone) fields.phone = "Перевірте номер телефону.";
  const city = clean(data.city, 100);
  if (city.length < 2) fields.city = "Вкажіть населений пункт.";
  let service = clean(data.service, 60);
  if (!SERVICES.has(service)) service = "";
  if (Object.keys(fields).length) return json(422, { ok: false, error: "invalid", fields });

  const lead = {
    phone,
    city,
    name: clean(data.name, 80),
    service,
    comment: clean(data.comment, 1000),
    receivedAt: new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" }),
  };

  try {
    await deliverLead(lead, env, fetchImpl);
  } catch (e) {
    console.error("Заявку не доставлено:", e.message);
    return json(502, { ok: false, error: "generic" });
  }
  return json(200, { ok: true });
}

export default async (request, context) => {
  const env = {
    TELEGRAM_BOT_TOKEN: Netlify.env.get("TELEGRAM_BOT_TOKEN"),
    TELEGRAM_CHAT_ID: Netlify.env.get("TELEGRAM_CHAT_ID"),
  };
  return handle(request, context.ip, env, fetch);
};

export const config = { path: "/api/lead" };
