import { Redis } from '@upstash/redis';
import { createClerkClient } from '@clerk/backend';
import { verifyAuth } from './me.js';

const redis = Redis.fromEnv();
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

function orderId() {
  return 'AP' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase();
}

// Role checks
const canReadAll = r => ['client_service','manager','delivery'].includes(r);
const canWrite = r => ['rep','client_service','manager'].includes(r);
const isAdmin = r => r === 'manager';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let me;
  try { me = await verifyAuth(req); }
  catch (e) { return res.status(401).json({ error: 'Unauthorized' }); }

  const { id } = req.query;

  // ââ GET /api/orders ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  if (req.method === 'GET' && !id) {
    try {
      if (me.role === 'client') {
        // Clients see only their own orders (linked in publicMetadata.orders)
        const orderIds = me.orders || [];
        const orders = (await Promise.all(orderIds.map(oid => redis.get(`order:${oid}`)))).filter(Boolean);
        return res.status(200).json(orders);
      }
      if (canReadAll(me.role) || isAdmin(me.role)) {
        const keys = await redis.keys('order:*');
        if (!keys.length) return res.status(200).json([]);
        const orders = (await Promise.all(keys.map(k => redis.get(k)))).filter(Boolean);
        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return res.status(200).json(orders);
      }
      // rep: own orders
      const keys = await redis.keys('order:*');
      if (!keys.length) return res.status(200).json([]);
      const all = (await Promise.all(keys.map(k => redis.get(k)))).filter(Boolean);
      const mine = all.filter(o => o.repUserId === me.userId);
      mine.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.status(200).json(mine);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ââ GET /api/orders?id=xxx ââââââââââââââââââââââââââââââââââââââââââââââââââ
  if (req.method === 'GET' && id) {
    try {
      const order = await redis.get(`order:${id}`);
      if (!order) return res.status(404).json({ error: 'Not found' });
      // Access check
      if (me.role === 'client' && !me.orders.includes(id)) return res.status(403).json({ error: 'Forbidden' });
      if (me.role === 'rep' && order.repUserId !== me.userId) return res.status(403).json({ error: 'Forbidden' });
      return res.status(200).json(order);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ââ POST /api/orders âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  if (req.method === 'POST') {
    if (!canWrite(me.role)) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = req.body;
      const id = orderId();
      const order = {
        id,
        ...body,
        repUserId: me.userId,
        repEmail: me.email,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await redis.set(`order:${id}`, order);
      return res.status(201).json(order);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ââ PUT /api/orders?id=xxx âââââââââââââââââââââââââââââââââââââââââââââââââââ
  if (req.method === 'PUT' && id) {
    try {
      const existing = await redis.get(`order:${id}`);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      // Access check
      if (me.role === 'rep' && existing.repUserId !== me.userId) return res.status(403).json({ error: 'Forbidden' });
      if (!canWrite(me.role) && me.role !== 'rep') return res.status(403).json({ error: 'Forbidden' });
      // Clients can only submit date change requests
      if (me.role === 'client') return res.status(403).json({ error: 'Forbidden' });

      const updated = { ...existing, ...req.body, id, updatedAt: new Date().toISOString() };
      await redis.set(`order:${id}`, updated);
      return res.status(200).json(updated);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ââ PATCH /api/orders?id=xxx âââââââââââââââââââââââââââââââââââââââââââââââââ
  // Used for: status changes, signature updates, date change requests
  if (req.method === 'PATCH' && id) {
    try {
      const existing = await redis.get(`order:${id}`);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const { action, ...data } = req.body;

      if (action === 'requestDateChange') {
        // Any authenticated user linked to this order
        const updated = {
          ...existing,
          dateChangeRequests: [...(existing.dateChangeRequests || []), { requestedAt: new Date().toISOString(), requestedBy: me.userId, ...data }],
          updatedAt: new Date().toISOString()
        };
        await redis.set(`order:${id}`, updated);
        return res.status(200).json(updated);
      }

      if (action === 'markDelivered') {
        if (me.role !== 'delivery' && me.role !== 'manager' && me.role !== 'client_service') return res.status(403).json({ error: 'Forbidden' });
        const updated = { ...existing, status: 'delivered', deliveredAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        await redis.set(`order:${id}`, updated);
        return res.status(200).json(updated);
      }

      if (action === 'cancel') {
        if (!['client_service','manager','rep'].includes(me.role)) return res.status(403).json({ error: 'Forbidden' });
        if (me.role === 'rep' && existing.repUserId !== me.userId) return res.status(403).json({ error: 'Forbidden' });
        const updated = { ...existing, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelReason: data.reason || '', updatedAt: new Date().toISOString() };
        await redis.set(`order:${id}`, updated);
        return res.status(200).json(updated);
      }

      if (action === 'sign') {
        const { party, signatureData } = data; // party: 'rep' | 'client'
        const updated = {
          ...existing,
          signatures: { ...(existing.signatures || {}), [party]: { data: signatureData, signedAt: new Date().toISOString(), userId: me.userId } },
          updatedAt: new Date().toISOString()
        };
        await redis.set(`order:${id}`, updated);
        return res.status(200).json(updated);
      }

      if (action === 'confirm') {
        if (!canWrite(me.role)) return res.status(403).json({ error: 'Forbidden' });
        const updated = { ...existing, status: 'confirmed', confirmedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        await redis.set(`order:${id}`, updated);
        return res.status(200).json(updated);
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
