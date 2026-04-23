import { createClerkClient } from "@clerk/backend";

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export default async function handler(req, res) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const payload = await clerk.verifyToken(token, {
      authorizedParties: [
        "salesdesk-five.vercel.app",
        "localhost:5173",
        "localhost:4173",
      ],
    });

    const userId = payload.sub;

    // Fetch user metadata from Clerk to get role
    let role = "rep"; // default
    let savedSignature = null;
    try {
      const user = await clerk.users.getUser(userId);
      role = user.publicMetadata?.role || "rep";
      savedSignature = user.publicMetadata?.savedSignature || null;
    } catch {
      // user metadata fetch failed, use defaults
    }

    const isAdmin = userId === process.env.ADMIN_USER_ID;
    if (isAdmin && role === "rep") role = "manager";

    return res.status(200).json({ userId, role, savedSignature, isAdmin });
  } catch (err) {
    console.error("me.js verifyToken error:", err.message);
    return res.status(401).json({ error: "Unauthorized", detail: err.message });
  }
}
