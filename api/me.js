import { createClerkClient, verifyToken } from '@clerk/backend';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const AUTHORIZED_PARTIES = [
  'https://salesdesk-five.vercel.app',
  'salesdesk-five.vercel.app',
  'http://localhost:5173',
  'localhost:5173',
  'http://localhost:4173',
  'localhost:4173',
];

export async function verifyAuth(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('No token'), { status: 401 });
  const payload = await verifyToken(token, {
    secretKey: process.env.CLERK_SECRET_KEY,
    authorizedParties: AUTHORIZED_PARTIES,
  });
  const user = await clerk.users.getUser(payload.sub);
  return {
    userId: user.id,
    email: user.emailAddresses[0]?.emailAddress || '',
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    role: user.publicMetadata?.role || null,
    savedSignature: user.publicMetadata?.savedSignature || null,
    orders: user.publicMetadata?.orders || [],
    isManager: user.id === (process.env.ADMIN_USER_ID || "").trim(),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const me = await verifyAuth(req);
    res.status(200).json(me);
  } catch (e) {
    res.status(e.status || 401).json({ error: e.message });
  }
}