// 90 Burger Shovot — buyurtmalar serveri (Cloudflare Worker + KV)
// Yo'llar: POST /api/order  |  GET/PATCH/DELETE /api/orders (parol bilan)  |  GET /api/my?k=...

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const cut = (s, n) => String(s ?? "").slice(0, n);
const som = n => Number(n).toLocaleString("ru-RU") + " so'm";
const json = (d, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const PFX = "o:";

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

async function createOrder(req, env) {
  let b;
  try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const items = Array.isArray(b.items)
    ? b.items.slice(0, 50).map(i => ({ n: cut(i.n, 80), q: Math.max(1, Math.min(99, +i.q || 1)), p: Math.max(0, +i.p || 0) }))
    : [];
  const name = cut(b.name, 60).trim();
  const phone = cut(b.phone, 20);
  if (!items.length || name.length < 2 || phone.replace(/\D/g, "").length !== 12) return json({ error: "Invalid order" }, 400);

  const time = Date.now();
  const subtotal = items.reduce((a, i) => a + i.p * i.q, 0);
  const mode = b.mode === "pickup" ? "pickup" : "delivery";
  const fee = mode === "delivery" ? Math.max(0, Number(env.DELIVERY_FEE ?? 15000) || 0) : 0;
  const o = {
    id: /^№\d{6}$/.test(b.id) ? b.id : "№" + String(time).slice(-6),
    time, status: "new", mode, name, phone,
    addr: cut(b.addr, 300),
    loc: b.loc && isFinite(b.loc.lat) && isFinite(b.loc.lon) ? { lat: +b.loc.lat, lon: +b.loc.lon } : null,
    comment: cut(b.comment, 300),
    items, subtotal, fee, total: subtotal + fee,
    paid: mode === "pickup" ? "Punktda to'lanadi" : "Naqd (kuryerga)"
  };

  const key = `${time}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let saved = false, sent = false;
  try { await env.ORDERS.put(PFX + key, JSON.stringify(o)); saved = true; }
  catch (e) { console.log("Saqlashda xato:", e?.message); }

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, parse_mode: "HTML", disable_web_page_preview: true, text: telegramText(o) })
      });
      sent = r.ok;
    } catch (e) { console.log("Telegram xato:", e?.message); }
  }
  if (!saved && !sent) return json({ error: "Buyurtma saqlanmadi" }, 500);
  return json({ ok: true, id: o.id, key: saved ? key : null });
}

async function adminOrders(req, env) {
  const pass = env.ADMIN_PASSWORD || "2008";
  if (req.headers.get("x-admin-pass") !== pass) {
    await new Promise(r => setTimeout(r, 800)); // taxminiy urinishlarni sekinlashtirish
    return new Response("Unauthorized", { status: 401 });
  }
  if (req.method === "GET") {
    const keys = [];
    let cursor;
    do {
      const r = await env.ORDERS.list({ prefix: PFX, cursor });
      keys.push(...r.keys.map(k => k.name));
      cursor = r.list_complete ? undefined : r.cursor;
    } while (cursor && keys.length < 2000);
    const list = (await Promise.all(keys.map(async k => {
      const o = await env.ORDERS.get(k, "json");
      return o ? { ...o, _k: k.slice(PFX.length) } : null;
    }))).filter(Boolean).sort((a, b) => b.time - a.time).slice(0, 500);
    return json(list);
  }

  let b;
  try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const key = String(b.key || "");
  if (!/^[\w-]+$/.test(key)) return json({ error: "Bad key" }, 400);

  if (req.method === "PATCH") {
    const o = await env.ORDERS.get(PFX + key, "json");
    if (!o) return json({ error: "Not found" }, 404);
    if (b.status !== undefined) {
      if (!["new", "cook", "ready", "onway", "done", "cancelled"].includes(b.status)) return json({ error: "Bad status" }, 400);
      o.status = b.status;
    }
    if (b.fee !== undefined) {
      const f = Math.round(Number(b.fee));
      if (!(f >= 0 && f <= 1000000)) return json({ error: "Bad fee" }, 400);
      o.fee = f;
      o.total = (o.subtotal || 0) + f;
    }
    await env.ORDERS.put(PFX + key, JSON.stringify(o));
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    await env.ORDERS.delete(PFX + key);
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
}

// Mijoz o'z buyurtmalarini faqat o'zining maxfiy kaliti (brauzerda saqlanadi) bilan ko'ra oladi.
async function tg(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, parse_mode: "HTML", text })
    });
  } catch (e) { console.log("Telegram xato:", e?.message); }
}

// Mijoz buyurtmani faqat hali qabul qilinmagan ("new") holatda bekor qila oladi.
async function cancelMy(req, env) {
  let b;
  try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const key = String(b.key || "");
  if (b.action !== "cancel" || !/^[\w-]+$/.test(key)) return json({ error: "Bad request" }, 400);
  const o = await env.ORDERS.get(PFX + key, "json");
  if (!o) return json({ error: "Not found" }, 404);
  if (o.status === "cancelled") return json({ ok: true });
  if (o.status !== "new") return json({ error: "Allaqachon tayyorlanmoqda", status: o.status }, 409);
  o.status = "cancelled";
  o.cancelledAt = Date.now();
  await env.ORDERS.put(PFX + key, JSON.stringify(o));
  await tg(env, `❌ <b>Buyurtma bekor qilindi ${esc(o.id)}</b>\n👤 ${esc(o.name)}  📞 ${esc(o.phone)}`);
  return json({ ok: true });
}

async function myOrders(req, env) {
  if (req.method === "POST") return cancelMy(req, env);
  const keys = (new URL(req.url).searchParams.get("k") || "")
    .split(",").map(s => s.trim()).filter(k => /^[\w-]+$/.test(k)).slice(0, 30);
  const out = (await Promise.all(keys.map(async k => {
    const o = await env.ORDERS.get(PFX + k, "json");
    return o ? { key: k, id: o.id, time: o.time, status: o.status, mode: o.mode, items: o.items, subtotal: o.subtotal, fee: o.fee, total: o.total } : null;
  }))).filter(Boolean);
  return json(out);
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    try {
      if (pathname === "/api/order") return req.method === "POST" ? await createOrder(req, env) : new Response("Method not allowed", { status: 405 });
      if (pathname === "/api/orders") return await adminOrders(req, env);
      if (pathname === "/api/my") return await myOrders(req, env);
    } catch (e) {
      console.log("Xato:", e?.message);
      return json({ error: "Server xatosi" }, 500);
    }
    return env.ASSETS.fetch(req);
  }
};
