import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      await redis.set("salesdesk_orders", req.body.orders);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "GET") {
    try {
      const data = await redis.get("salesdesk_orders");
      return res.status(200).json({ orders: data || [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}