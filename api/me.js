import { verifyAuth, withCors } from "./_lib/auth.js";

export default async function handler(req, res) {
  withCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const me = await verifyAuth(req);
    return res.status(200).json(me);
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }
}
