import { Redis } from '@upstash/redis';
import { verifyAuth } from './me.js';

const redis = Redis.fromEnv();
const DEFAULT_SLOTS = 20;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let me;
  try { me = await verifyAuth(req); }
  catch (e) { return res.status(401).json({ error: 'Unauthorized' }); }

  // GET /api/delivery?dates=2025-06-01,2025-06-02
  if (req.method === 'GET') {
    const { dates } = req.query;
    if (!dates) return res.status(400).json({ error: 'dates param required' });
    const dateList = dates.split(',').map(d => d.trim());
    const result = {};
    for (const date of dateList) {
      for (const slot of ['morning','afternoon','evening']) {
        const key = `slots:${date}:${slot}`;
        const booked = parseInt(await redis.get(key) || '0', 10);
        result[`${date}:${slot}`] = { booked, remaining: DEFAULT_SLOTS - booked, total: DEFAULT_SLOTS };
      }
    }
    return res.status(200).json(result);
  }

  // POST /api/delivery  body: { date, slot, orderId }
  if (req.method === 'POST') {
    const { date, slot, orderId, action } = req.body;
    if (!date || !slot) return res.status(400).json({ error: 'date and slot required' });
    const key = `slots:${date}:${slot}`;
    const booked = parseInt(await redis.get(key) || '0', 10);

    if (action === 'release') {
      if (booked > 0) await redis.set(key, booked - 1);
      return res.status(200).json({ remaining: DEFAULT_SLOTS - Math.max(0, booked - 1) });
    }

    if (booked >= DEFAULT_SLOTS) return res.status(409).json({ error: 'Slot full' });
    await redis.set(key, booked + 1);
    // Track which order booked this slot
    if (orderId) await redis.sadd(`slot_orders:${date}:${slot}`, orderId);
    return res.status(200).json({ remaining: DEFAULT_SLOTS - booked - 1 });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
