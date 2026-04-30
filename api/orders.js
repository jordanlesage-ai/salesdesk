import { verifyAuth, withCors } from "./_lib/auth.js";
import { redis } from "./_lib/redis.js";

function newId() {
  return "O" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function visibleTo(order, me) {
  if (me.role === "god") return true;
  if (me.role === "manager") return order.office === me.office;
  return order.repUserId === me.userId;
}

function canMutate(order, me) {
  if (me.role === "god") return true;
  if (me.role === "manager") return order.office === me.office;
  return order.repUserId === me.userId;
}

async function loadAll() {
  const keys = await redis.keys("order:*");
  if (!keys.length) return [];
  const orders = await Promise.all(keys.map(k => redis.get(k)));
  return orders.filter(Boolean);
}

export default async function handler(req, res) {
  withCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  let me;
  try { me = await verifyAuth(req); }
  catch (e) { return res.status(401).json({ error: "Unauthorized" }); }

  const { id } = req.query;

  try {
    if (req.method === "GET" && !id) {
      const all = await loadAll();
      const filtered = all.filter(o => visibleTo(o, me));
      filtered.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return res.status(200).json(filtered);
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const id = newId();
      const order = {
        id,
        fileName:     body.fileName || "",
        client:       body.client || "Unknown",
        date:         body.date || new Date().toISOString().slice(0, 10),
        deliveryDate: body.deliveryDate || null,
        total:        Number(body.total) || 0,
        items:        Array.isArray(body.items) ? body.items : [],
        cancelled:    false,
        repUserId:    me.userId,
        repEmail:     me.email,
        repName:      [me.firstName, me.lastName].filter(Boolean).join(" ") || me.email,
        office:       me.office || "unassigned",
        createdAt:    new Date().toISOString(),
      };
      await redis.set(`order:${id}`, order);
      return res.status(201).json(order);
    }

    if (req.method === "PATCH" && id) {
      const existing = await redis.get(`order:${id}`);
      if (!existing) return res.status(404).json({ error: "Not found" });
      if (!canMutate(existing, me)) return res.status(403).json({ error: "Forbidden" });
      const updated = { ...existing, ...req.body, id, updatedAt: new Date().toISOString() };
      await redis.set(`order:${id}`, updated);
      return res.status(200).json(updated);
    }

    if (req.method === "DELETE" && id) {
      const existing = await redis.get(`order:${id}`);
      if (!existing) return res.status(404).json({ error: "Not found" });
      if (!canMutate(existing, me)) return res.status(403).json({ error: "Forbidden" });
      await redis.del(`order:${id}`);
      return res.status(204).end();
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("orders error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
