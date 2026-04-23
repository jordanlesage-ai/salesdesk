import { createClerkClient } from "@clerk/backend";
 
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
 
export default async function handler(req, res) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const payload = await clerk.verifyToken(token);
    const isAdmin = payload.sub === process.env.ADMIN_USER_ID;
    return res.status(200).json({ userId: payload.sub, isAdmin });
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}
