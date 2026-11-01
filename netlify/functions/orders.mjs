import { getStore } from "@netlify/blobs";

const json = (d, s = 200) => Response.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  const pass = process.env.ADMIN_PASSWORD || "1234";
  if (req.headers.get("x-admin-pass") !== pass) {
    await new Promise(r => setTimeout(r, 800)); // taxminan urinishlarni sekinlashtirish
    return new Response("Unauthorized", { status: 401 });
  }
  const store = getStore("orders");

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const list = (await Promise.all(blobs.map(async b => {
      const o = await store.get(b.key, { type: "json" });
      return o ? { ...o, _k: b.key } : null;
    }))).filter(Boolean).sort((a, b) => b.time - a.time).slice(0, 100);
    return json(list);
  }

  let b;
  try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const key = String(b.key || "");
  if (!/^[\w-]+$/.test(key)) return json({ error: "Bad key" }, 400);

  if (req.method === "PATCH") {
    if (!["new", "cook", "done"].includes(b.status)) return json({ error: "Bad status" }, 400);
    const o = await store.get(key, { type: "json" });
    if (!o) return json({ error: "Not found" }, 404);
    o.status = b.status;
    await store.setJSON(key, o);
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    await store.delete(key);
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/orders" };
