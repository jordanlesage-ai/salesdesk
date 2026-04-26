import { Redis } from '@upstash/redis';
import { verifyAuth } from './me.js';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let me;
  try { me = await verifyAuth(req); }
  catch (e) { return res.status(401).json({ error: 'Unauthorized' }); }

  if (req.method === 'GET') {
    const data = await redis.get('excel:company');
    return res.status(200).json(data || { headers: [], rows: [] });
  }

  if (req.method === 'POST') {
    if (!me.isManager) return res.status(403).json({ error: 'Managers only' });
    const { headers, rows } = req.body;
    await redis.set('excel:company', { headers, rows });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
