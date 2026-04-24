import { createClerkClient } from '@clerk/backend';
import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
import { verifyAuth } from './me.js';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const resend = new Resend(process.env.RESEND_API_KEY);
const APP_URL = process.env.APP_URL || 'https://salesdesk-five.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let me;
  try { me = await verifyAuth(req); }
  catch (e) { return res.status(401).json({ error: 'Unauthorized' }); }

  const { orderId, clientEmail, clientName, orderTotal, firstDeliveryDate } = req.body;
  if (!orderId || !clientEmail) return res.status(400).json({ error: 'orderId and clientEmail required' });

  try {
    // Find or create Clerk account for client
    let clientUser = null;
    try {
      const existing = await clerk.users.getUserList({ emailAddress: [clientEmail] });
      if (existing.data?.length) {
        clientUser = existing.data[0];
        // Link order to existing user
        const currentOrders = clientUser.publicMetadata?.orders || [];
        if (!currentOrders.includes(orderId)) {
          await clerk.users.updateUserMetadata(clientUser.id, {
            publicMetadata: { ...clientUser.publicMetadata, orders: [...currentOrders, orderId], role: 'client' }
          });
        }
      }
    } catch (_) {}

    if (!clientUser) {
      // Create new client account
      const parts = (clientName || '').trim().split(' ');
      clientUser = await clerk.users.createUser({
        emailAddress: [clientEmail],
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ') || '',
        publicMetadata: { role: 'client', orders: [orderId] },
        skipPasswordRequirement: true,
      });
    }

    // Generate a sign-in link (magic link)
    const signInToken = await clerk.signInTokens.createSignInToken({ userId: clientUser.id, expiresInSeconds: 7 * 24 * 3600 });
    const signLink = `${APP_URL}?__clerk_ticket=${signInToken.token}`;

    // Send bilingual confirmation email
    const total = typeof orderTotal === 'number' ? orderTotal.toFixed(2) : orderTotal;
    const { error: emailError } = await resend.emails.send({
      from: 'noreply@alimentationpremiere.ca',
      to: clientEmail,
      subject: `Confirmation de commande / Order Confirmation — ${orderId}`,
      html: buildEmail({ orderId, clientName, orderTotal: total, firstDeliveryDate, signLink, APP_URL }),
    });

    if (emailError) console.error('Resend error:', emailError);

    return res.status(200).json({ ok: true, clientUserId: clientUser.id, signLink });
  } catch (e) {
    console.error('invite error:', e);
    return res.status(500).json({ error: e.message });
  }
}

function buildEmail({ orderId, clientName, orderTotal, firstDeliveryDate, signLink, APP_URL }) {
  const name = clientName || 'Client';
  const date = firstDeliveryDate || '–';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;margin:0;padding:0;background:#f5f5f5;}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;}
  .header{background:#C41E1E;padding:24px 32px;}
  .header h1{color:#fff;margin:0;font-size:22px;}
  .body{padding:32px;}
  .detail-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;}
  .btn{display:inline-block;background:#C41E1E;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:24px;}
  .divider{border:none;border-top:2px dashed #C41E1E;margin:32px 0;}
</style></head><body>
<div class="wrap">
  <div class="header"><h1>🥩 Alimentation Première</h1></div>
  <div class="body">
    <h2 style="color:#C41E1E">Merci pour votre commande, ${name}!</h2>
    <p>Votre commande a été confirmée. Voici les détails :</p>
    <div class="detail-row"><span><strong>Numéro de commande</strong></span><span>${orderId}</span></div>
    <div class="detail-row"><span><strong>Total</strong></span><span>${orderTotal}$</span></div>
    <div class="detail-row"><span><strong>Première livraison</strong></span><span>${date}</span></div>
    <a href="${signLink}" class="btn">Voir ma commande / Signer</a>
    <hr class="divider"/>
    <h2 style="color:#C41E1E">Thank you for your order, ${name}!</h2>
    <p>Your order has been confirmed. Here are the details:</p>
    <div class="detail-row"><span><strong>Order Number</strong></span><span>${orderId}</span></div>
    <div class="detail-row"><span><strong>Total</strong></span><span>$${orderTotal}</span></div>
    <div class="detail-row"><span><strong>First Delivery</strong></span><span>${date}</span></div>
    <a href="${signLink}" class="btn">View my order / Sign</a>
    <p style="margin-top:32px;color:#888;font-size:12px;">
      Alimentation Première — alimentation directement chez vous / direct to your door<br>
      <a href="${APP_URL}">${APP_URL}</a>
    </p>
  </div>
</div></body></html>`;
}
