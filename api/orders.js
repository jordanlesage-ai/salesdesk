import { createClerkClient } from "@clerk/backend";
import { Redis } from "@upstash/redis";
 
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const redis = Redis.fromEnv();
 
export const config = {
  api: { bodyParser: { sizeLimit: "20mb" } },
};
 
async function getUserId(req) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return null;
    const payload = await clerk.verifyToken(token);
    return payload.sub;
  } catch {
    return null;
  }
}
 
export default async function handler(req, res) {
  const userId = await getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
 
  const isAdmin = userId === process.env.ADMIN_USER_ID;
 
  if (req.method === "GET") {
    try {
      const targetId = isAdmin && req.query.userId ? req.query.userId : userId;
      const data = await redis.get(`orders:${targetId}`);
      return res.status(200).json({ orders: data || [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
 
  if (req.method === "POST") {
    try {
      const targetId = isAdmin && req.body.userId ? req.body.userId : userId;
      await redis.set(`orders:${targetId}`, req.body.orders);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
 
  if (req.method === "PUT" && isAdmin) {
    try {
      const keys = await redis.keys("orders:*");
      const userIds = keys.map(k => k.replace("orders:", ""));
      const users = await Promise.all(
        userIds.map(async id => {
          try {
            const user = await clerk.users.getUser(id);
            return {
              id,
              name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.emailAddresses[0]?.emailAddress || id,
              email: user.emailAddresses[0]?.emailAddress || "",
              imageUrl: user.imageUrl,
            };
          } catch {
            return { id, name: id, email: "", imageUrl: "" };
          }
        })
      );
      return res.status(200).json({ users });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
 
  return res.status(405).json({ error: "Method not allowed" });
}
