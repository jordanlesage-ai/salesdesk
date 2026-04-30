import { createClerkClient, verifyToken } from "@clerk/backend";

export const GOD_EMAIL = "jordan.lesage@outlook.com";
export const DEFAULT_OFFICE = "beloeil";

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

const AUTHORIZED_PARTIES = [
  "http://localhost:5173",
  "http://localhost:4173",
  // Vercel preview + prod URLs are also accepted; Clerk verifies origin separately.
];

function normalize(email) {
  return (email || "").trim().toLowerCase();
}

export async function verifyAuth(req) {
  const header = req.headers["authorization"] || req.headers["Authorization"] || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("No token"), { status: 401 });

  const payload = await verifyToken(token, {
    secretKey: process.env.CLERK_SECRET_KEY,
    authorizedParties: AUTHORIZED_PARTIES,
  });

  const user = await clerk.users.getUser(payload.sub);
  const email = normalize(user.emailAddresses[0]?.emailAddress);
  const meta = user.publicMetadata || {};

  // Bootstrap: god email always has god role regardless of stored metadata
  const isGod = email === normalize(GOD_EMAIL);
  const role = isGod ? "god" : (meta.role || "rep");
  const office = isGod ? null : (meta.office || DEFAULT_OFFICE);

  return {
    userId: user.id,
    email,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    role,
    office,
  };
}

export function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
}

export { clerk };
