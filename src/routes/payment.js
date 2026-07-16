const router = require('express').Router();
const { z } = require('zod');
const mongoose = require('mongoose');
const { Order, Product } = require('../models');
const { validate } = require('../middleware');
const { getGatewaysConfig, adapters, GATEWAY_META } = require('../services/gateways');
const { notifyPaid } = require('../services/mailer');

/* ---------- helpers ---------- */
async function reduceStock(order) {
  if (order.stockReduced) return;
  for (const it of order.items) {
    await Product.updateOne(
      { _id: it.product, 'variants._id': it.variantId },
      { $inc: { 'variants.$.stock': -it.qty, soldCount: it.qty } }
    );
  }
  order.stockReduced = true;
}

/** সব gateway-র কমন paid-finalize — idempotent + amount-tampering check */
async function finalizePaid(order, { gateway, trxID, payer = '', amount }) {
  if (order.payment.status === 'paid') return true; // ডাবল callback safe
  if (Number(amount) < Number(order.advanceDue)) {
    order.payment.status = 'failed';
    order.statusHistory.push({ status: 'awaiting_payment', note: `Amount mismatch (${gateway}): ${amount}` });
    await order.save();
    return false;
  }
  order.payment.status = 'paid';
  order.payment.gateway = gateway;
  order.payment.trxID = trxID;
  order.payment.payerNumber = payer;
  order.payment.amountPaid = Number(amount);
  order.payment.paidAt = new Date();
  order.status = 'confirmed';
  order.statusHistory.push({
    status: 'confirmed',
    note: order.paymentMethod === 'cod_advance'
      ? `৳${amount} অগ্রিম পেইড — ${GATEWAY_META[gateway]?.name || gateway} (TrxID: ${trxID}), বাকি ৳${order.codDue} ডেলিভারিতে`
      : `ফুল পেমেন্ট পেইড — ${GATEWAY_META[gateway]?.name || gateway} (TrxID: ${trxID})`,
  });
  await reduceStock(order);
  await order.save();
  notifyPaid(order); // fire-and-forget
  return true;
}

const success = (res, order) => res.redirect(`/order-success.html?orderNo=${order.orderNo}&phone=${order.customer.phone}`);
const fail = (res, reason) => res.redirect(`/checkout.html?payment=failed&reason=${encodeURIComponent(reason || '')}`);

async function startPayment(orderId, gw, res, next) {
  try {
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি' });
    if (order.payment.status === 'paid') return res.status(400).json({ error: 'পেমেন্ট আগেই হয়ে গেছে' });

    const cfg = (await getGatewaysConfig())[gw];
    if (!cfg?.enabled || !adapters[gw]) return res.status(400).json({ error: 'এই পেমেন্ট মেথডটা এখন চালু নেই' });

    const { url, ref } = await adapters[gw].create({ order, config: cfg, siteUrl: process.env.SITE_URL });
    order.payment.gateway = gw;
    order.payment.gatewayRef = ref;
    if (gw === 'bkash') order.payment.bkashPaymentID = ref;
    await order.save();
    res.json({ url, bkashURL: url }); // bkashURL: পুরনো ফ্রন্টএন্ড compatibility
  } catch (e) { next(e); }
}

/* ---------- পেমেন্ট শুরু (সব gateway) ---------- */
router.post('/create', validate(z.object({
  orderId: z.string().refine((s) => mongoose.isValidObjectId(s), 'invalid'),
  gateway: z.string().max(30).optional().default('bkash'),
})), (req, res, next) => startPayment(req.body.orderId, req.body.gateway, res, next));

/* Legacy alias */
router.post('/bkash/create', validate(z.object({
  orderId: z.string().refine((s) => mongoose.isValidObjectId(s), 'invalid'),
})), (req, res, next) => startPayment(req.body.orderId, 'bkash', res, next));

/* ---------- bKash callback ---------- */
router.get('/bkash/callback', async (req, res) => {
  const { paymentID, status, order: orderId } = req.query;
  try {
    if (!paymentID || !mongoose.isValidObjectId(orderId)) return fail(res, 'invalid');
    const order = await Order.findById(orderId);
    if (!order || order.payment.gatewayRef !== paymentID) return fail(res, 'mismatch');
    const cfg = (await getGatewaysConfig()).bkash;

    if (status !== 'success') {
      order.payment.status = 'failed';
      order.statusHistory.push({ status: 'awaiting_payment', note: `bKash ${status === 'cancel' ? 'বাতিল' : 'ব্যর্থ'}` });
      await order.save();
      return fail(res, status);
    }
    let result;
    try { result = await adapters.bkash.execute(cfg, paymentID); }
    catch { result = await adapters.bkash.query(cfg, paymentID).catch(() => null); }
    const ok = result && (result.statusCode === '0000' || result.transactionStatus === 'Completed');
    if (!ok) { order.payment.status = 'failed'; await order.save(); return fail(res, 'verify'); }

    const paid = await finalizePaid(order, { gateway: 'bkash', trxID: result.trxID, payer: result.customerMsisdn || '', amount: result.amount });
    return paid ? success(res, order) : fail(res, 'amount');
  } catch (e) { console.error('bkash cb:', e); return fail(res, 'server'); }
});

/* ---------- SSLCommerz callback (success POST + IPN) ---------- */
router.post('/sslcommerz/callback', async (req, res) => {
  try {
    const orderId = req.query.order;
    const valId = req.body.val_id;
    if (!valId || !mongoose.isValidObjectId(orderId)) return fail(res, 'invalid');
    const order = await Order.findById(orderId);
    if (!order) return fail(res, 'invalid');
    const cfg = (await getGatewaysConfig()).sslcommerz;
    const v = await adapters.sslcommerz.validate(cfg, valId);
    if (!['VALID', 'VALIDATED'].includes(v.status)) { order.payment.status = 'failed'; await order.save(); return fail(res, 'verify'); }
    if (v.value_a && v.value_a !== order._id.toString()) return fail(res, 'mismatch');
    const paid = await finalizePaid(order, { gateway: 'sslcommerz', trxID: v.bank_tran_id || v.tran_id, amount: v.amount });
    return paid ? success(res, order) : fail(res, 'amount');
  } catch (e) { console.error('ssl cb:', e); return fail(res, 'server'); }
});
router.all('/sslcommerz/fail', (req, res) => fail(res, 'cancelled'));

/* ---------- aamarPay callback ---------- */
router.all('/aamarpay/callback', async (req, res) => {
  try {
    const { order: orderId, tran } = req.query;
    if (!tran || !mongoose.isValidObjectId(orderId)) return fail(res, 'invalid');
    const order = await Order.findById(orderId);
    if (!order || order.payment.gatewayRef !== tran) return fail(res, 'mismatch');
    const cfg = (await getGatewaysConfig()).aamarpay;
    const v = await adapters.aamarpay.verify(cfg, tran);
    if (v.pay_status !== 'Successful') { order.payment.status = 'failed'; await order.save(); return fail(res, 'verify'); }
    const paid = await finalizePaid(order, { gateway: 'aamarpay', trxID: v.pg_txnid || tran, payer: v.payment_type || '', amount: v.amount });
    return paid ? success(res, order) : fail(res, 'amount');
  } catch (e) { console.error('aamar cb:', e); return fail(res, 'server'); }
});
router.all('/aamarpay/fail', (req, res) => fail(res, 'cancelled'));

/* ---------- shurjoPay callback ---------- */
router.get('/shurjopay/callback', async (req, res) => {
  try {
    const orderId = req.query.order;
    const spOrderId = req.query.order_id;
    if (!spOrderId || !mongoose.isValidObjectId(orderId)) return fail(res, 'invalid');
    const order = await Order.findById(orderId);
    if (!order) return fail(res, 'invalid');
    const cfg = (await getGatewaysConfig()).shurjopay;
    const v = await adapters.shurjopay.verify(cfg, spOrderId);
    const ok = v && (String(v.sp_code) === '1000' || String(v.sp_code).toLowerCase() === 'success');
    if (!ok) { order.payment.status = 'failed'; await order.save(); return fail(res, 'verify'); }
    const paid = await finalizePaid(order, { gateway: 'shurjopay', trxID: v.bank_trx_id || spOrderId, payer: v.phone_no || '', amount: v.amount || v.received_amount });
    return paid ? success(res, order) : fail(res, 'amount');
  } catch (e) { console.error('sp cb:', e); return fail(res, 'server'); }
});
router.all('/shurjopay/fail', (req, res) => fail(res, 'cancelled'));

module.exports = router;
