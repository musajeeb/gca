/**
 * Payment Gateway Registry
 * প্রতিটা gateway-র config Dashboard → পেমেন্ট থেকে সেট হয় (Settings collection),
 * না থাকলে .env fallback (bKash-এর জন্য)। adapter interface:
 *   create({order, config, siteUrl}) → { url, ref }   // কাস্টমারকে redirect করার URL
 *   verify(...)                                        // callback-এ সার্ভার-সাইড verification
 */
const { Settings } = require('../models');

const GATEWAY_META = {
  bkash: { name: 'bKash', fields: ['appKey', 'appSecret', 'username', 'password'] },
  sslcommerz: { name: 'SSLCommerz', fields: ['storeId', 'storePassword'] },
  aamarpay: { name: 'aamarPay', fields: ['storeId', 'signatureKey'] },
  shurjopay: { name: 'shurjoPay', fields: ['username', 'password', 'prefix'] },
  nagad: { name: 'Nagad (ডিরেক্ট)', fields: ['merchantId', 'merchantNumber', 'publicKey', 'privateKey'], unsupported: 'Nagad-এর ডিরেক্ট API-তে RSA key exchange লাগে যা মার্চেন্ট অনবোর্ডিংয়ের পর Nagad দেয়। তার আগ পর্যন্ত SSLCommerz বা aamarPay চালু করুন — দুটোতেই কাস্টমার Nagad দিয়ে দিতে পারে।' },
  portwallet: { name: 'PortWallet', fields: ['appKey', 'secretKey'], unsupported: 'PortWallet (বর্তমানে PortPos) অ্যাডাপ্টার এখনো যোগ হয়নি — মার্চেন্ট অ্যাকাউন্ট পেলে জানান, যোগ করা যাবে।' },
};

async function getGatewaysConfig() {
  const s = await Settings.findOne({ key: 'site' }).lean();
  const saved = s?.data?.gateways || {};
  // bKash: .env fallback (আগের সেটআপ যেন ভেঙে না যায়)
  const bkash = saved.bkash || {};
  if (!bkash.appKey && process.env.BKASH_APP_KEY) {
    saved.bkash = {
      enabled: bkash.enabled !== false,
      appKey: process.env.BKASH_APP_KEY,
      appSecret: process.env.BKASH_APP_SECRET,
      username: process.env.BKASH_USERNAME,
      password: process.env.BKASH_PASSWORD,
      sandbox: (process.env.BKASH_BASE_URL || '').includes('sandbox'),
    };
  }
  return saved;
}

async function enabledGateways() {
  const cfg = await getGatewaysConfig();
  return Object.keys(GATEWAY_META)
    .filter((id) => cfg[id]?.enabled && !GATEWAY_META[id].unsupported
      && GATEWAY_META[id].fields.every((f) => cfg[id][f]))
    .map((id) => ({ id, name: GATEWAY_META[id].name }));
}

/* ================= bKash (Tokenized Checkout) ================= */
const bkashTokenCache = {};
async function bkashFetch(base, path, { headers = {}, body } = {}) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.statusMessage || data.message || `bKash error ${res.status}`);
  return data;
}
async function bkashToken(c) {
  const base = c.sandbox ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta' : 'https://tokenized.pay.bka.sh/v1.2.0-beta';
  const key = c.appKey;
  const now = Date.now();
  if (bkashTokenCache[key] && now < bkashTokenCache[key].exp - 60000) return { base, token: bkashTokenCache[key].token };
  const d = await bkashFetch(base, '/tokenized/checkout/token/grant', {
    headers: { username: c.username, password: c.password },
    body: { app_key: c.appKey, app_secret: c.appSecret },
  });
  if (!d.id_token) throw new Error('bKash token পাওয়া যায়নি — credentials চেক করুন');
  bkashTokenCache[key] = { token: d.id_token, exp: now + Number(d.expires_in || 3600) * 1000 };
  return { base, token: d.id_token };
}
const bkashAdapter = {
  async create({ order, config, siteUrl }) {
    const { base, token } = await bkashToken(config);
    const d = await bkashFetch(base, '/tokenized/checkout/create', {
      headers: { Authorization: token, 'X-APP-Key': config.appKey },
      body: {
        mode: '0011', payerReference: order.orderNo,
        callbackURL: `${siteUrl}/api/payment/bkash/callback?order=${order._id}`,
        amount: Number(order.advanceDue).toFixed(2), currency: 'BDT',
        intent: 'sale', merchantInvoiceNumber: order.orderNo,
      },
    });
    if (!d.bkashURL) throw new Error('bKash পেমেন্ট শুরু করা যায়নি');
    return { url: d.bkashURL, ref: d.paymentID };
  },
  async execute(config, paymentID) {
    const { base, token } = await bkashToken(config);
    return bkashFetch(base, '/tokenized/checkout/execute', {
      headers: { Authorization: token, 'X-APP-Key': config.appKey }, body: { paymentID },
    });
  },
  async query(config, paymentID) {
    const { base, token } = await bkashToken(config);
    return bkashFetch(base, '/tokenized/checkout/payment/status', {
      headers: { Authorization: token, 'X-APP-Key': config.appKey }, body: { paymentID },
    });
  },
};

/* ================= SSLCommerz ================= */
const sslBase = (c) => c.sandbox ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
const sslcommerzAdapter = {
  async create({ order, config, siteUrl }) {
    const params = new URLSearchParams({
      store_id: config.storeId, store_passwd: config.storePassword,
      total_amount: Number(order.advanceDue).toFixed(2), currency: 'BDT',
      tran_id: `${order.orderNo}-${Date.now()}`,
      success_url: `${siteUrl}/api/payment/sslcommerz/callback?order=${order._id}`,
      fail_url: `${siteUrl}/api/payment/sslcommerz/fail?order=${order._id}`,
      cancel_url: `${siteUrl}/api/payment/sslcommerz/fail?order=${order._id}`,
      ipn_url: `${siteUrl}/api/payment/sslcommerz/callback?order=${order._id}`,
      cus_name: order.customer.name, cus_email: 'customer@netbazar.local',
      cus_add1: order.customer.address.slice(0, 90), cus_city: order.customer.area === 'inside_dhaka' ? 'Dhaka' : 'Bangladesh',
      cus_country: 'Bangladesh', cus_phone: order.customer.phone,
      shipping_method: 'NO', product_name: order.items.map((i) => i.title).join(', ').slice(0, 250),
      product_category: 'Networking', product_profile: 'general',
      value_a: order._id.toString(),
    });
    const res = await fetch(`${sslBase(config)}/gwprocess/v4/api.php`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params,
    });
    const d = await res.json().catch(() => ({}));
    if (d.status !== 'SUCCESS' || !d.GatewayPageURL) throw new Error(d.failedreason || 'SSLCommerz সেশন তৈরি হয়নি — store credentials চেক করুন');
    return { url: d.GatewayPageURL, ref: d.sessionkey };
  },
  async validate(config, valId) {
    const qs = new URLSearchParams({ val_id: valId, store_id: config.storeId, store_passwd: config.storePassword, format: 'json' });
    const res = await fetch(`${sslBase(config)}/validator/api/validationserverAPI.php?${qs}`);
    return res.json().catch(() => ({}));
  },
};

/* ================= aamarPay ================= */
const aamarBase = (c) => c.sandbox ? 'https://sandbox.aamarpay.com' : 'https://secure.aamarpay.com';
const aamarpayAdapter = {
  async create({ order, config, siteUrl }) {
    const tranId = `${order.orderNo}-${Date.now()}`;
    const res = await fetch(`${aamarBase(config)}/jsonpost.php`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store_id: config.storeId, signature_key: config.signatureKey,
        tran_id: tranId, amount: Number(order.advanceDue).toFixed(2), currency: 'BDT',
        desc: `Order ${order.orderNo}`,
        cus_name: order.customer.name, cus_email: 'customer@netbazar.local',
        cus_phone: order.customer.phone, cus_add1: order.customer.address.slice(0, 90),
        cus_city: 'Dhaka', cus_country: 'Bangladesh',
        success_url: `${siteUrl}/api/payment/aamarpay/callback?order=${order._id}&tran=${tranId}`,
        fail_url: `${siteUrl}/api/payment/aamarpay/fail?order=${order._id}`,
        cancel_url: `${siteUrl}/api/payment/aamarpay/fail?order=${order._id}`,
        type: 'json', opt_a: order._id.toString(),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!d.payment_url) throw new Error(typeof d === 'string' ? d : 'aamarPay সেশন তৈরি হয়নি — credentials চেক করুন');
    return { url: d.payment_url, ref: tranId };
  },
  async verify(config, tranId) {
    const qs = new URLSearchParams({ request_id: tranId, store_id: config.storeId, signature_key: config.signatureKey, type: 'json' });
    const res = await fetch(`${aamarBase(config)}/api/v1/trxcheck/request.php?${qs}`);
    return res.json().catch(() => ({}));
  },
};

/* ================= shurjoPay ================= */
const spBase = (c) => c.sandbox ? 'https://sandbox.shurjopay.com.bd' : 'https://engine.shurjopay.com.bd';
async function spToken(config) {
  const res = await fetch(`${spBase(config)}/api/get_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.username, password: config.password }),
  });
  const d = await res.json().catch(() => ({}));
  if (!d.token) throw new Error('shurjoPay token পাওয়া যায়নি — credentials চেক করুন');
  return d;
}
const shurjopayAdapter = {
  async create({ order, config, siteUrl }) {
    const t = await spToken(config);
    const res = await fetch(`${spBase(config)}/api/secret-pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
      body: JSON.stringify({
        prefix: config.prefix || 'NB', token: t.token, store_id: t.store_id,
        return_url: `${siteUrl}/api/payment/shurjopay/callback?order=${order._id}`,
        cancel_url: `${siteUrl}/api/payment/shurjopay/fail?order=${order._id}`,
        amount: Number(order.advanceDue).toFixed(2), order_id: order._id.toString(),
        currency: 'BDT', customer_name: order.customer.name,
        customer_phone: order.customer.phone, customer_address: order.customer.address.slice(0, 90),
        customer_city: 'Dhaka', client_ip: '127.0.0.1',
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!d.checkout_url) throw new Error(d.message || 'shurjoPay সেশন তৈরি হয়নি');
    return { url: d.checkout_url, ref: d.sp_order_id };
  },
  async verify(config, spOrderId) {
    const t = await spToken(config);
    const res = await fetch(`${spBase(config)}/api/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
      body: JSON.stringify({ order_id: spOrderId }),
    });
    const d = await res.json().catch(() => ([]));
    return Array.isArray(d) ? d[0] : d;
  },
};

const adapters = { bkash: bkashAdapter, sslcommerz: sslcommerzAdapter, aamarpay: aamarpayAdapter, shurjopay: shurjopayAdapter };

module.exports = { GATEWAY_META, getGatewaysConfig, enabledGateways, adapters };
