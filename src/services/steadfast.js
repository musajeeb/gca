/**
 * Steadfast Courier — Merchant API
 * Docs base: https://portal.packzy.com/api/v1
 * Auth headers: Api-Key, Secret-Key (Dashboard → পেমেন্ট → কুরিয়ার থেকে সেট হয়)
 */
const { Settings } = require('../models');

const BASE = 'https://portal.packzy.com/api/v1';

async function getConfig() {
  const s = await Settings.findOne({ key: 'site' }).lean();
  return s?.data?.courier?.steadfast || {};
}

async function sfFetch(path, { method = 'GET', body } = {}) {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.apiKey || !cfg.secretKey) {
    throw Object.assign(new Error('Steadfast চালু নেই — পেমেন্ট ট্যাব থেকে API key সেভ করুন'), { status: 400 });
  }
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Api-Key': cfg.apiKey,
      'Secret-Key': cfg.secretKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.message || `Steadfast API error (${res.status}) — credentials চেক করুন`), { status: 502, data });
  }
  return data;
}

/** অর্ডার → Steadfast consignment payload */
function toConsignment(order) {
  return {
    invoice: order.orderNo,
    recipient_name: order.customer.name.slice(0, 100),
    recipient_phone: order.customer.phone,
    recipient_address: order.customer.address.slice(0, 250),
    cod_amount: Number(order.codDue || 0), // ফুল পেইড হলে ০ — শুধু ডেলিভারি হবে
    note: order.items.map((i) => `${i.sku} x${i.qty}`).join(', ').slice(0, 200),
  };
}

async function createOrder(order) {
  const d = await sfFetch('/create_order', { method: 'POST', body: toConsignment(order) });
  const c = d.consignment;
  if (!c?.tracking_code) throw new Error(d.message || 'Steadfast consignment তৈরি হয়নি');
  return { consignmentId: String(c.consignment_id), trackingCode: c.tracking_code, status: c.status };
}

async function createBulk(orders) {
  const d = await sfFetch('/create_order/bulk-order', {
    method: 'POST',
    body: { data: JSON.stringify(orders.map(toConsignment)) },
  });
  // response: array — প্রতিটায় invoice, consignment_id, tracking_code বা error
  return Array.isArray(d) ? d : (d.data || []);
}

async function statusByInvoice(orderNo) {
  const d = await sfFetch(`/status_by_invoice/${encodeURIComponent(orderNo)}`);
  return d.delivery_status; // pending | delivered | partial_delivered | cancelled | hold | in_review ...
}

async function getBalance() {
  const d = await sfFetch('/get_balance');
  return d.current_balance;
}

module.exports = { getConfig, createOrder, createBulk, statusByInvoice, getBalance };
