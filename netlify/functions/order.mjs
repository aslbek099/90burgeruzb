import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const cut = (s, n) => String(s ?? "").slice(0, n);
const som = n => Number(n).toLocaleString("ru-RU") + " so'm";

function telegramText(o) {
  const map = o.loc ? `\n📍 <a href="https://maps.google.com/?q=${o.loc.lat},${o.loc.lon}">Xaritada ochish</a>` : "";
  return `🍔 <b>Yangi buyurtma ${esc(o.id)}</b>\n` +
    `${o.mode === "delivery" ? "🚚 Yetkazib berish" : "🏪 Olib ketish"}\n` +
    `👤 ${esc(o.name)}\n📞 ${esc(o.phone)}\n` +
    (o.mode === "delivery" ? `🏠 ${esc(o.addr) || "—"}${map}\n` : "") +
    `\n${o.items.map(i => `• ${esc(i.n)} × ${i.q}`).join("\n")}\n` +
    (o.comment ? `\n💬 ${esc(o.comment)}\n` : "") +
    (o.mode === "delivery" ? `\n🚚 Kuryer puli: ${som(o.fee)} (manzilga qarab o'zgarishi mumkin)` : "") +
    `\n💰 <b>Jami: ${som(o.total)}</b> (${esc(o.paid)})`;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let b;
  try { b = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  const items = Array.isArray(b.items)
    ? b.items.slice(0, 50).map(i => ({ n: cut(i.n, 80), q: Math.max(1, Math.min(99, +i.q || 1)), p: Math.max(0, +i.p || 0) }))
    : [];
  const name = cut(b.name, 60).trim();
  const phone = cut(b.phone, 20);
  if (!items.length || name.length < 2 || phone.replace(/\D/g, "").length !== 12)
    return new Response("Invalid order", { status: 400 });

  const time = Date.now();
  const subtotal = items.reduce((a, i) => a + i.p * i.q, 0);
  const mode = b.mode === "pickup" ? "pickup" : "delivery";
  // Dastlabki kuryer puli (sotuvchi panelda manzilga qarab o'zgartiradi). DELIVERY_FEE muhit o'zgaruvchisi bilan ham o'zgartirsa bo'ladi.
  const fee = mode === "delivery" ? Math.max(0, Number(process.env.DELIVERY_FEE ?? 15000) || 0) : 0;
  const o = {
    id: /^№\d{6}$/.test(b.id) ? b.id : "№" + String(time).slice(-6),
    time, status: "new", mode, name, phone,
    addr: cut(b.addr, 300),
    loc: b.loc && isFinite(b.loc.lat) && isFinite(b.loc.lon) ? { lat: +b.loc.lat, lon: +b.loc.lon } : null,
    comment: cut(b.comment, 300),
    items, subtotal, fee, total: subtotal + fee,
    paid: mode === "pickup" ? "Punktda to'lanadi" : "Naqd (kuryerga)"
  };

  let saved = false, sent = false;
  const key = `${time}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  try {
    await getStore("orders").setJSON(key, o);
    saved = true;
  } catch (e) { console.log("Saqlashda xato:", e?.message); }

  const T = process.env.TELEGRAM_BOT_TOKEN, C = process.env.TELEGRAM_CHAT_ID;
  if (T && C) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${T}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: C, parse_mode: "HTML", disable_web_page_preview: true, text: telegramText(o) })
      });
      sent = r.ok;
    } catch (e) { console.log("Telegram xato:", e?.message); }
  }

  if (!saved && !sent) return new Response("Buyurtma saqlanmadi", { status: 500 });
  return Response.json({ ok: true, id: o.id, key: saved ? key : null });
};

export const config = { path: "/api/order" };
