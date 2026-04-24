import { createClerkClient } from '@clerk/backend';
import { verifyAuth } from './me.js';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let me;
  try { me = await verifyAuth(req); }
  catch (e) { return res.status(401).json({ error: 'Unauthorized' }); }

  const { signatureData } = req.body;
  if (!signatureData) return res.status(400).json({ error: 'signatureData required' });

  try {
    await clerk.users.updateUserMetadata(me.userId, {
      publicMetadata: { ...((await clerk.users.getUser(me.userId)).publicMetadata), savedSignature: signatureData }
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
