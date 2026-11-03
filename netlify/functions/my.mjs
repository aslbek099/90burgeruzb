import { getStore } from "@netlify/blobs";

// Mijoz o'z buyurtmalarini faqat o'zining maxfiy kaliti (brauzerda saqlanadi) bilan ko'ra oladi.
export default async (req) => {
  const keys = (new URL(req.url).searchParams.get("k") || "")
    .split(",").map(s => s.trim()).filter(k => /^[\w-]+$/.test(k)).slice(0, 30);
  const store = getStore("orders");
  const out = (await Promise.all(keys.map(async k => {
    const o = await store.get(k, { type: "json" });
    return o ? { key: k, id: o.id, time: o.time, status: o.status, mode: o.mode, items: o.items, subtotal: o.subtotal, fee: o.fee, total: o.total } : null;
  }))).filter(Boolean);
  return Response.json(out, { headers: { "Cache-Control": "no-store" } });
};

export const config = { path: "/api/my" };
