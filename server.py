#!/usr/bin/env python3
"""
Ківі Сервіс — локальний сервер сайту без зовнішніх залежностей (Python 3.8+).

- Віддає файли з ./public
- POST /api/lead — перевіряє заявку на сервері (телефон, населений пункт, пастка для ботів, ліміт частоти)
  і надсилає її в Telegram через бота. Поки бот не налаштований, повертає 503 not_configured,
  тож сайт ніколи не показує фальшивий успіх.

Налаштування — у файлі .env поруч із server.py (див. .env.example):
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

Запуск:  python3 server.py   →   http://localhost:8000
"""
import json
import os
import re
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def load_env(path):
    # Мінімальний читач .env: KEY=value, без перезапису вже заданих змінних
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env(os.path.join(BASE_DIR, ".env"))

PORT = int(os.environ.get("PORT", "8000"))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
TELEGRAM_API = os.environ.get("TELEGRAM_API", "https://api.telegram.org")
MAX_BODY = 8 * 1024
RATE_LIMIT = 5          # заявок
RATE_WINDOW = 10 * 60   # за 10 хвилин з однієї IP-адреси

SERVICES = {"", "Чистка криниці", "Відкачування септика", "Прочищення каналізації", "Відеодіагностика"}
_hits = defaultdict(deque)


class NotConfigured(Exception):
    pass


def format_lead(lead):
    lines = ["Нова заявка з сайту Ківі Сервіс", "", "Телефон: " + lead["phone"], "Населений пункт: " + lead["city"]]
    if lead["name"]:
        lines.append("Ім’я: " + lead["name"])
    if lead["service"]:
        lines.append("Послуга: " + lead["service"])
    if lead["comment"]:
        lines += ["", "Коментар: " + lead["comment"]]
    lines += ["", "Отримано: " + lead["received_at"]]
    return "\n".join(lines)


def deliver_lead(lead):
    """
    Надсилає заявку в Telegram-чат власника через бота.
    Кидає виняток, якщо доставка не вдалася, — тоді клієнт побачить помилку, а не фальшивий успіх.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        raise NotConfigured()
    body = json.dumps({
        "chat_id": TELEGRAM_CHAT_ID,
        "text": format_lead(lead),  # звичайний текст, без parse_mode — нічого не треба екранувати
        "disable_web_page_preview": True,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{TELEGRAM_API}/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            result = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Токен у текст помилки не потрапляє — лише код відповіді
        raise RuntimeError(f"Telegram HTTP {e.code}") from None
    if not result.get("ok"):
        raise RuntimeError("Telegram відхилив повідомлення")


def normalize_phone(raw):
    d = re.sub(r"[\s()\-.]", "", str(raw or ""))
    if not re.fullmatch(r"\+?\d+", d):
        return None
    d = d.lstrip("+")
    if re.fullmatch(r"0\d{9}", d):
        d = "38" + d
    elif re.fullmatch(r"80\d{9}", d):
        d = "3" + d
    return "+" + d if re.fullmatch(r"380[1-9]\d{8}", d) else None


def clean(value, limit):
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def rate_limited(ip):
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return True
    q.append(now)
    return False


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Не пишемо в лог тіла запитів і телефони — лише шлях і статус
        super().log_message(fmt, *args)

    def _json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/lead":
            return self._json(404, {"ok": False, "error": "not_found"})

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._json(400, {"ok": False, "error": "invalid"})
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            assert isinstance(data, dict)
        except Exception:
            return self._json(400, {"ok": False, "error": "invalid"})

        if rate_limited(self.client_address[0]):
            return self._json(429, {"ok": False, "error": "rate_limited"})

        # Бот заповнив приховане поле — мовчки відхиляємо без імітації успіху
        if clean(data.get("website"), 200):
            return self._json(400, {"ok": False, "error": "invalid"})

        fields = {}
        phone = normalize_phone(data.get("phone"))
        if not phone:
            fields["phone"] = "Перевірте номер телефону."
        city = clean(data.get("city"), 100)
        if len(city) < 2:
            fields["city"] = "Вкажіть населений пункт."
        service = clean(data.get("service"), 60)
        if service not in SERVICES:
            service = ""
        if fields:
            return self._json(422, {"ok": False, "error": "invalid", "fields": fields})

        lead = {
            "phone": phone,
            "city": city,
            "name": clean(data.get("name"), 80),
            "service": service,
            "comment": clean(data.get("comment"), 1000),
            "received_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        try:
            deliver_lead(lead)
        except NotConfigured:
            return self._json(503, {"ok": False, "error": "not_configured"})
        except Exception as e:
            self.log_error("Заявку не доставлено: %s", e)
            return self._json(502, {"ok": False, "error": "generic"})
        return self._json(200, {"ok": True})


if __name__ == "__main__":
    print(f"Ківі Сервіс: http://localhost:{PORT}")
    if not (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID):
        print("Увага: Telegram-бот не налаштований — форма відповідатиме «заявку не надіслано». Див. README.")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
