import { verifyAuth, withCors, clerk, GOD_EMAIL, DEFAULT_OFFICE } from "./_lib/auth.js";

const VALID_ROLES = ["god", "manager", "rep"];
const VALID_OFFICES = ["beloeil"]; // extend as new offices are added

function shape(u) {
  const email = (u.emailAddresses[0]?.emailAddress || "").trim().toLowerCase();
  const isGod = email === GOD_EMAIL.trim().toLowerCase();
  const meta = u.publicMetadata || {};
  return {
    userId: u.id,
    email,
    firstName: u.firstName || "",
    lastName: u.lastName || "",
    role: isGod ? "god" : (meta.role || "rep"),
    office: isGod ? null : (meta.office || DEFAULT_OFFICE),
    isGod,
    createdAt: u.createdAt,
  };
}

export default async function handler(req, res) {
  withCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  let me;
  try { me = await verifyAuth(req); }
  catch (e) { return res.status(401).json({ error: "Unauthorized" }); }

  if (me.role !== "god") return res.status(403).json({ error: "Forbidden" });

  const { id } = req.query;

  try {
    if (req.method === "GET") {
      const PAGE = 200;
      const all = [];
      let offset = 0;
      while (true) {
        const page = await clerk.users.getUserList({ limit: PAGE, offset });
        const batch = page.data || page;
        all.push(...batch);
        if (batch.length < PAGE) break;
        offset += PAGE;
      }
      const users = all.map(shape);
      users.sort((a, b) => a.email.localeCompare(b.email));
      return res.status(200).json({ users, offices: VALID_OFFICES });
    }

    if (req.method === "PATCH" && id) {
      const target = await clerk.users.getUser(id);
      const targetEmail = (target.emailAddresses[0]?.emailAddress || "").trim().toLowerCase();
      if (targetEmail === GOD_EMAIL.trim().toLowerCase()) {
        return res.status(400).json({ error: "Cannot modify the god account" });
      }
      const { role, office } = req.body || {};
      if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
      if (office && !VALID_OFFICES.includes(office)) return res.status(400).json({ error: "Invalid office" });

      const current = target.publicMetadata || {};
      const next = {
        ...current,
        ...(role !== undefined ? { role } : {}),
        ...(office !== undefined ? { office } : {}),
      };
      await clerk.users.updateUserMetadata(id, { publicMetadata: next });
      const refreshed = await clerk.users.getUser(id);
      return res.status(200).json(shape(refreshed));
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("users error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
