const router = require('express').Router();
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const { z } = require('zod');
const mongoose = require('mongoose');
const { Admin, Product, Collection, Order, Coupon, Blog, Page, Review, Stat, Image, Settings, nextSeq } = require('../models');
const { requireAdmin, signToken, validate, sanitizeHtml, upload, makeImageName, sniffImage, loginLimiter, PHONE_RE, ADDRESS_RE, normalizePhone } = require('../middleware');
const { invalidate: invalidateSearch } = require('../services/search');
const { notifyPaid, sendTestMail } = require('../services/mailer');

const oid = (s) => mongoose.isValidObjectId(s);
const makeSlug = (s) => slugify(String(s), { lower: true, strict: true }) || `item-${Date.now()}`;
async function uniqueSlug(Model, base, excludeId) {
  let slug = base, i = 1;
  while (await Model.findOne({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) slug = `${base}-${++i}`;
  return slug;
}

/* ================= AUTH ================= */
router.post('/login', loginLimiter, validate(z.object({
  email: z.string().email(), password: z.string().min(6).max(100),
})), async (req, res, next) => {
  try {
    const admin = await Admin.findOne({ email: req.body.email.toLowerCase(), active: true }).select('+password');
    const bad = () => res.status(401).json({ error: 'ইমেইল বা পাসওয়ার্ড ভুল' });
    if (!admin) return bad();
    const ok = await bcrypt.compare(req.body.password, admin.password);
    if (!ok) return bad();
    res.json({ token: signToken(admin), name: admin.name, email: admin.email });
  } catch (e) { next(e); }
});

router.use(requireAdmin); // এর নিচের সব route auth লাগবে

router.get('/me', (req, res) => res.json({ email: req.admin.email, role: req.admin.role }));

/* ---------- নিজের পাসওয়ার্ড বদল (bcrypt) ---------- */
router.put('/change-password', validate(z.object({
  current: z.string().min(1).max(100),
  next: z.string().min(8, 'নতুন পাসওয়ার্ড কমপক্ষে ৮ ক্যারেক্টার').max(100),
})), async (req, res, nextFn) => {
  try {
    const admin = await Admin.findById(req.admin.id).select('+password');
    if (!admin) return res.status(404).json({ error: 'অ্যাডমিন পাওয়া যায়নি' });
    const ok = await bcrypt.compare(req.body.current, admin.password);
    if (!ok) return res.status(401).json({ error: 'বর্তমান পাসওয়ার্ড ভুল' });
    admin.password = await bcrypt.hash(req.body.next, 12);
    await admin.save();
    res.json({ ok: true });
  } catch (e) { nextFn(e); }
});

/* ================= DASHBOARD STATS (Shopify-style) ================= */
router.get('/stats', async (req, res, next) => {
  try {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const since7 = new Date(Date.now() - 7 * 86400000);
    const since30 = new Date(Date.now() - 30 * 86400000);
    const paid = { 'payment.status': 'paid' };
    const notCancelled = { status: { $nin: ['cancelled', 'returned'] } };

    // custom range (?from=YYYY-MM-DD&to=YYYY-MM-DD) — chart/breakdown/top এই রেঞ্জ ফলো করে
    let rFrom = since30, rTo = null;
    if (req.query.from) { const d = new Date(String(req.query.from)); if (!isNaN(d)) rFrom = d; }
    if (req.query.to) { const d = new Date(String(req.query.to)); if (!isNaN(d)) { d.setHours(23, 59, 59, 999); rTo = d; } }
    const rangeMatch = { createdAt: { $gte: rFrom, ...(rTo ? { $lte: rTo } : {}) } };
    const since90 = new Date(Date.now() - 90 * 86400000);
    const allTime = new Date(0);

    const sumMatch = (match) => Order.aggregate([
      { $match: { ...paid, ...notCancelled, ...match } },
      { $unwind: '$items' },
      { $group: {
        _id: '$_id',
        total: { $first: '$total' },
        deliveryFee: { $first: '$deliveryFee' },
        discount: { $first: '$discount' },
        itemRevenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } },
        itemCost: { $sum: { $multiply: [{ $ifNull: ['$items.costPrice', 0] }, '$items.qty'] } },
      } },
      { $group: {
        _id: null,
        orders: { $sum: 1 },
        revenue: { $sum: '$total' },
        productRevenue: { $sum: '$itemRevenue' },
        productCost: { $sum: '$itemCost' },
        deliveryCollected: { $sum: '$deliveryFee' },
        discountGiven: { $sum: '$discount' },
      } },
    ]).then((r) => r[0] || { orders: 0, revenue: 0, productRevenue: 0, productCost: 0, deliveryCollected: 0, discountGiven: 0 });

    // previous-period comparisons (Shopify-স্টাইল %Δ)
    const spanMs = (rTo ? rTo.getTime() : Date.now()) - rFrom.getTime();
    const prevRangeMatch = { createdAt: { $gte: new Date(rFrom.getTime() - spanMs), $lt: rFrom } };
    const yesterday = new Date(dayStart.getTime() - 86400000);

    const [today, prevToday, week, prevWeek, month, prevMonth, quarter, all, range, prevRange, daily, topProducts, statusCounts, paymentSplit, lowStock, totalProducts, visitAgg, repeatAgg] = await Promise.all([
      sumMatch({ createdAt: { $gte: dayStart } }),
      sumMatch({ createdAt: { $gte: yesterday, $lt: dayStart } }),
      sumMatch({ createdAt: { $gte: since7 } }),
      sumMatch({ createdAt: { $gte: new Date(Date.now() - 14 * 86400000), $lt: since7 } }),
      sumMatch({ createdAt: { $gte: since30 } }),
      sumMatch({ createdAt: { $gte: new Date(Date.now() - 60 * 86400000), $lt: since30 } }),
      sumMatch({ createdAt: { $gte: since90 } }),
      sumMatch({ createdAt: { $gte: allTime } }),
      sumMatch(rangeMatch),
      sumMatch(prevRangeMatch),
      // দৈনিক sales (chart) — সিলেক্ট করা রেঞ্জ অনুযায়ী
      Order.aggregate([
        { $match: { ...paid, ...notCancelled, ...rangeMatch } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$total' }, orders: { $sum: 1 },
        } },
        { $sort: { _id: 1 } },
      ]),
      // টপ প্রোডাক্ট — সিলেক্ট করা রেঞ্জ অনুযায়ী
      Order.aggregate([
        { $match: { ...paid, ...notCancelled, ...rangeMatch } },
        { $unwind: '$items' },
        { $group: { _id: '$items.title', qty: { $sum: '$items.qty' }, revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } } } },
        { $sort: { qty: -1 } }, { $limit: 8 },
      ]),
      Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Order.aggregate([
        { $match: { ...paid, createdAt: { $gte: since30 } } },
        { $group: { _id: '$paymentMethod', n: { $sum: 1 }, amount: { $sum: '$total' } } },
      ]),
      Product.aggregate([
        { $match: { status: 'active' } }, { $unwind: '$variants' },
        { $match: { $expr: { $lte: ['$variants.stock', '$variants.lowStockAlert'] } } },
        { $project: { title: 1, 'variants.sku': 1, 'variants.stock': 1, 'variants.name': 1 } }, { $limit: 20 },
      ]),
      Product.countDocuments({ status: 'active' }),
      // রেঞ্জের ভিজিট (conversion rate)
      Stat.aggregate([
        { $match: { date: { $gte: rFrom.toISOString().slice(0, 10), $lte: (rTo || new Date()).toISOString().slice(0, 10) } } },
        { $group: { _id: null, visits: { $sum: '$visits' } } },
      ]),
      // রিপিট কাস্টমার রেট (লাইফটাইম): ২+ পেইড অর্ডার / মোট পেইড কাস্টমার
      Order.aggregate([
        { $match: { 'payment.status': 'paid' } },
        { $group: { _id: '$customer.phone', n: { $sum: 1 } } },
        { $group: { _id: null, customers: { $sum: 1 }, repeat: { $sum: { $cond: [{ $gt: ['$n', 1] }, 1, 0] } } } },
      ]),
    ]);

    const recentOrders = await Order.find().sort({ createdAt: -1 }).limit(8)
      .select('orderNo customer.name total status payment.status paymentMethod codDue createdAt').lean();

    const grossProfit = (r) => ({ ...r, grossProfit: r.productRevenue - r.productCost });
    const visits = visitAgg[0]?.visits || 0;
    const repeat = repeatAgg[0] || { customers: 0, repeat: 0 };
    res.json({
      today: grossProfit(today), prevToday: grossProfit(prevToday),
      week: grossProfit(week), prevWeek: grossProfit(prevWeek),
      month: grossProfit(month), prevMonth: grossProfit(prevMonth),
      quarter: grossProfit(quarter), all: grossProfit(all),
      range: grossProfit(range), prevRange: grossProfit(prevRange),
      visits, conversionRate: visits ? Math.round((range.orders / visits) * 1000) / 10 : null,
      repeatRate: repeat.customers ? Math.round((repeat.repeat / repeat.customers) * 1000) / 10 : 0,
      repeatCustomers: repeat.repeat, totalCustomers: repeat.customers,
      rangeFrom: rFrom.toISOString().slice(0, 10), rangeTo: (rTo || new Date()).toISOString().slice(0, 10),
      daily, topProducts,
      statusCounts: Object.fromEntries(statusCounts.map((s) => [s._id, s.n])),
      paymentSplit, lowStock, totalProducts, recentOrders,
    });
  } catch (e) { next(e); }
});

/* ================= UPLOADS ================= */
router.post('/upload', upload.array('images', 8), async (req, res, next) => {
  try {
    const files = [];
    for (const f of req.files || []) {
      // MIME header spoof করা যায় — আসল বাইট-সিগনেচার যাচাই করি
      const realMime = sniffImage(f.buffer);
      if (!realMime) {
        return res.status(400).json({ error: `"${f.originalname}" আসল ছবি না (jpg/png/webp) — বাদ দেওয়া হয়েছে` });
      }
      const name = makeImageName(realMime);
      await Image.create({ name, mime: realMime, data: f.buffer, size: f.size });
      files.push(`/uploads/${name}`);
    }
    res.json({ files });
  } catch (e) { next(e); }
});

/* ================= PRODUCTS ================= */
const variantZ = z.object({
  _id: z.string().optional(),
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().max(120).default('Default'),
  price: z.number().min(0),
  comparePrice: z.number().min(0).default(0),
  costPrice: z.number().min(0).default(0),
  stock: z.number().int().min(0).default(0),
  lowStockAlert: z.number().int().min(0).default(3),
  barcode: z.string().max(60).optional().default(''),
});
const productZ = z.object({
  title: z.string().trim().min(2).max(200),
  slug: z.string().max(220).optional(),
  brand: z.string().max(80).default(''),
  model: z.string().max(120).default(''),
  description: z.string().max(60000).default(''),
  aplusHtml: z.string().max(120000).default(''),
  shortDescription: z.string().max(600).default(''),
  specs: z.array(z.object({ label: z.string().max(120), value: z.string().max(400) })).default([]),
  faqs: z.array(z.object({ q: z.string().max(400), a: z.string().max(2000) })).default([]),
  images: z.array(z.string().max(400)).default([]),
  collections: z.array(z.string().refine(oid)).default([]),
  tags: z.array(z.string().max(40)).default([]),
  variants: z.array(variantZ).min(1),
  warranty: z.string().max(200).default(''),
  featured: z.boolean().default(false),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  seoTitle: z.string().max(120).optional(),
  seoDescription: z.string().max(300).optional(),
  sourceUrl: z.string().max(600).optional(),
});

router.get('/products', async (req, res, next) => {
  try {
    const { q, status, page = 1 } = req.query;
    const filter = {};
    if (status) filter.status = String(status);
    if (q) filter.$text = { $search: String(q) };
    const perPage = 30, pg = Math.max(Number(page) || 1, 1);
    const [items, total] = await Promise.all([
      Product.find(filter).sort({ createdAt: -1 }).skip((pg - 1) * perPage).limit(perPage).lean(),
      Product.countDocuments(filter),
    ]);
    res.json({ items, total, pages: Math.ceil(total / perPage) });
  } catch (e) { next(e); }
});

router.get('/products/:id', async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const p = await Product.findById(req.params.id).select('+variants.costPrice').lean();
    if (!p) return res.status(404).json({ error: 'পাওয়া যায়নি' });
    res.json(p);
  } catch (e) { next(e); }
});

router.post('/products', validate(productZ), async (req, res, next) => {
  try {
    const body = req.body;
    body.description = sanitizeHtml(body.description);
    body.aplusHtml = sanitizeHtml(body.aplusHtml);
    body.slug = await uniqueSlug(Product, makeSlug(body.slug || body.title));
    const p = await Product.create(body);
    invalidateSearch();
    res.status(201).json(p);
  } catch (e) { next(e); }
});

router.put('/products/:id', validate(productZ.partial()), async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const body = req.body;
    if (body.description !== undefined) body.description = sanitizeHtml(body.description);
    if (body.aplusHtml !== undefined) body.aplusHtml = sanitizeHtml(body.aplusHtml);
    if (body.slug) body.slug = await uniqueSlug(Product, makeSlug(body.slug), req.params.id);
    const p = await Product.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
    invalidateSearch();
    if (!p) return res.status(404).json({ error: 'পাওয়া যায়নি' });
    res.json(p);
  } catch (e) { next(e); }
});

router.delete('/products/:id', async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    await Product.findByIdAndUpdate(req.params.id, { status: 'archived' });
    invalidateSearch();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- Product bulk actions ---------- */
router.post('/products/bulk', validate(z.object({
  ids: z.array(z.string().refine(oid)).min(1).max(200),
  action: z.enum(['status', 'archive', 'feature', 'unfeature']),
  status: z.enum(['draft', 'active', 'archived']).optional(),
})), async (req, res, next) => {
  try {
    const { ids, action, status } = req.body;
    let upd;
    if (action === 'status') { if (!status) return res.status(422).json({ error: 'status দিন' }); upd = { status }; }
    if (action === 'archive') upd = { status: 'archived' };
    if (action === 'feature') upd = { featured: true };
    if (action === 'unfeature') upd = { featured: false };
    const r = await Product.updateMany({ _id: { $in: ids } }, upd);
    invalidateSearch();
    res.json({ done: r.modifiedCount });
  } catch (e) { next(e); }
});

/* ================= COLLECTIONS ================= */
const collectionZ = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).default(''),
  image: z.string().max(400).default(''),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
  smart: z.boolean().default(false),
  rules: z.object({
    tags: z.array(z.string().trim().max(40)).default([]),
    brands: z.array(z.string().trim().max(80)).default([]),
  }).default({ tags: [], brands: [] }),
});
router.get('/collections', async (req, res, next) => {
  try { res.json(await Collection.find().sort({ sortOrder: 1 }).lean()); } catch (e) { next(e); }
});
router.post('/collections', validate(collectionZ), async (req, res, next) => {
  try {
    const slug = await uniqueSlug(Collection, makeSlug(req.body.name));
    res.status(201).json(await Collection.create({ ...req.body, slug }));
  } catch (e) { next(e); }
});
router.put('/collections/:id', validate(collectionZ.partial()), async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    res.json(await Collection.findByIdAndUpdate(req.params.id, req.body, { new: true }));
  } catch (e) { next(e); }
});
router.delete('/collections/:id', async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    await Collection.findByIdAndDelete(req.params.id);
    await Product.updateMany({}, { $pull: { collections: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================= ORDERS ================= */
router.get('/orders', async (req, res, next) => {
  try {
    const { status, payment, q, dateFrom, dateTo, page = 1 } = req.query;
    const filter = {};
    // status: একক ('shipped') বা গ্রুপ ('pending' = কাজ বাকি)
    if (status === 'pending') filter.status = { $in: ['awaiting_payment', 'confirmed', 'processing'] };
    else if (status) filter.status = String(status);
    if (payment) filter['payment.status'] = String(payment);
    if (req.query.tag) filter.tags = String(req.query.tag);
    if (req.query.source) filter.source = String(req.query.source);
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(String(dateFrom));
      if (dateTo) { const d = new Date(String(dateTo)); d.setHours(23, 59, 59, 999); filter.createdAt.$lte = d; }
    }
    if (q) {
      const safe = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { orderNo: new RegExp(safe, 'i') },
        { 'customer.phone': new RegExp(safe) },
        { 'customer.name': new RegExp(safe, 'i') },
        { 'payment.trxID': new RegExp(safe, 'i') },
      ];
    }
    const perPage = 30, pg = Math.max(Number(page) || 1, 1);
    const [items, total, counts] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((pg - 1) * perPage).limit(perPage).lean(),
      Order.countDocuments(filter),
      Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    res.json({
      items, total, pages: Math.ceil(total / perPage),
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    });
  } catch (e) { next(e); }
});

/* ---------- CSV export (ফিল্টারসহ) ---------- */
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
router.get('/orders/export', async (req, res, next) => {
  try {
    const { status, payment, q, dateFrom, dateTo, tag } = req.query;
    const filter = {};
    if (status === 'pending') filter.status = { $in: ['awaiting_payment', 'confirmed', 'processing'] };
    else if (status) filter.status = String(status);
    if (payment) filter['payment.status'] = String(payment);
    if (tag) filter.tags = String(tag);
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(String(dateFrom));
      if (dateTo) { const d = new Date(String(dateTo)); d.setHours(23, 59, 59, 999); filter.createdAt.$lte = d; }
    }
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(5000).lean();
    const head = ['OrderNo', 'Date', 'Customer', 'Phone', 'Address', 'Area', 'Items', 'Subtotal', 'Discount', 'Delivery', 'Total', 'PaymentMethod', 'PaymentStatus', 'Paid', 'CODDue', 'TrxID', 'Status', 'Courier', 'Tracking', 'Tags', 'Source'];
    const rows = orders.map((o) => [
      o.orderNo, new Date(o.createdAt).toISOString(), o.customer.name, o.customer.phone, o.customer.address,
      o.customer.area, o.items.map((i) => `${i.title} (${i.sku}) x${i.qty}`).join(' | '),
      o.subtotal, o.discount, o.deliveryFee, o.total, o.paymentMethod, o.payment.status,
      o.payment.amountPaid || 0, o.codDue, o.payment.trxID || '', o.status,
      o.courier?.name || '', o.courier?.trackingId || '', (o.tags || []).join(','), o.source || 'online',
    ].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.csv"`);
    res.send('\ufeff' + head.join(',') + '\n' + rows.join('\n'));
  } catch (e) { next(e); }
});


router.get('/orders/:id', async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const o = await Order.findById(req.params.id).lean();
    if (!o) return res.status(404).json({ error: 'পাওয়া যায়নি' });
    res.json(o);
  } catch (e) { next(e); }
});

router.put('/orders/:id/status', validate(z.object({
  status: z.enum(['confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']),
  note: z.string().max(400).optional().default(''),
  courierName: z.string().max(80).optional(),
  trackingId: z.string().max(120).optional(),
})), async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'পাওয়া যায়নি' });
    const { status, note, courierName, trackingId } = req.body;

    // cancelled/returned হলে স্টক ফেরত
    if (['cancelled', 'returned'].includes(status) && o.stockReduced) {
      for (const it of o.items) {
        await Product.updateOne(
          { _id: it.product, 'variants._id': it.variantId },
          { $inc: { 'variants.$.stock': it.qty, soldCount: -it.qty } }
        );
      }
      o.stockReduced = false;
    }
    if (status === 'delivered' && o.paymentMethod === 'cod_advance') {
      o.payment.amountPaid = o.total; // COD বাকি টাকা কালেক্টেড
    }
    if (courierName || trackingId) o.courier = { name: courierName || o.courier?.name, trackingId: trackingId || o.courier?.trackingId };
    o.status = status;
    o.statusHistory.push({ status, note });
    await o.save();
    res.json(o);
  } catch (e) { next(e); }
});

/* ---------- Manual payment control (Shopify-র mark as paid / refund) ---------- */
async function restock(o) {
  if (!o.stockReduced) return;
  for (const it of o.items) {
    await Product.updateOne(
      { _id: it.product, 'variants._id': it.variantId },
      { $inc: { 'variants.$.stock': it.qty, soldCount: -it.qty } }
    );
  }
  o.stockReduced = false;
}
async function takeStock(o) {
  if (o.stockReduced) return;
  for (const it of o.items) {
    await Product.updateOne(
      { _id: it.product, 'variants._id': it.variantId },
      { $inc: { 'variants.$.stock': -it.qty, soldCount: it.qty } }
    );
  }
  o.stockReduced = true;
}

router.put('/orders/:id/payment', validate(z.object({
  status: z.enum(['paid', 'pending', 'failed', 'refunded']),
  amountPaid: z.number().min(0).optional(),
  trxID: z.string().trim().max(80).optional(),
  note: z.string().max(400).optional().default(''),
})), async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'পাওয়া যায়নি' });
    const { status, amountPaid, trxID, note } = req.body;

    o.payment.status = status;
    if (trxID !== undefined) o.payment.trxID = trxID;
    if (status === 'paid') {
      o.payment.amountPaid = amountPaid !== undefined ? amountPaid : (o.payment.amountPaid || o.advanceDue);
      o.payment.paidAt = o.payment.paidAt || new Date();
      await takeStock(o); // পেইড হলে স্টক কাটা (idempotent)
      if (o.status === 'awaiting_payment') o.status = 'confirmed';
      o.statusHistory.push({ status: o.status, note: note || `অ্যাডমিন ম্যানুয়ালি paid মার্ক করেছে (৳${o.payment.amountPaid})${trxID ? ' TrxID: ' + trxID : ''}` });
      notifyPaid(o);
    } else if (status === 'refunded') {
      o.statusHistory.push({ status: o.status, note: note || `রিফান্ড করা হয়েছে (৳${o.payment.amountPaid || 0})` });
    } else {
      if (amountPaid !== undefined) o.payment.amountPaid = amountPaid;
      o.statusHistory.push({ status: o.status, note: note || `অ্যাডমিন পেমেন্ট স্ট্যাটাস "${status}" করেছে` });
    }
    await o.save();
    res.json(o);
  } catch (e) { next(e); }
});

/* ---------- Draft order: অ্যাডমিন নিজে অর্ডার তৈরি (ফোন/দোকান সেল) ---------- */
async function buildOrderItems(items) {
  const orderItems = [];
  let subtotal = 0;
  for (const it of items) {
    const p = await Product.findOne({ _id: it.productId }).select('+variants.costPrice').lean();
    if (!p) throw Object.assign(new Error('প্রোডাক্ট পাওয়া যায়নি'), { status: 400 });
    const v = p.variants.find((x) => x._id.toString() === it.variantId);
    if (!v) throw Object.assign(new Error(`${p.title} — ভ্যারিয়েন্ট নেই`), { status: 400 });
    if (v.stock < it.qty) throw Object.assign(new Error(`${p.title} — স্টকে মাত্র ${v.stock}টা`), { status: 400 });
    const price = it.price !== undefined ? it.price : v.price; // অ্যাডমিন কাস্টম দাম দিতে পারে
    subtotal += price * it.qty;
    orderItems.push({
      product: p._id, variantId: v._id, title: p.title, variantName: v.name,
      sku: v.sku, image: p.images?.[0] || '', price, costPrice: v.costPrice || 0, qty: it.qty,
    });
  }
  return { orderItems, subtotal };
}

const draftItemZ = z.object({
  productId: z.string().refine(oid), variantId: z.string().refine(oid),
  qty: z.number().int().min(1).max(100), price: z.number().min(0).optional(),
});

router.post('/orders/create', validate(z.object({
  items: z.array(draftItemZ).min(1).max(50),
  customer: z.object({
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().regex(PHONE_RE, 'ফোন: 01XXXXXXXXX বা +8801XXXXXXXXX').transform(normalizePhone),
    address: z.string().trim().min(4).max(400).regex(ADDRESS_RE, 'ঠিকানা ইংরেজিতে (অক্ষর, সংখ্যা, , ; :)'),
    area: z.enum(['inside_dhaka', 'outside_dhaka']),
    note: z.string().max(300).optional().default(''),
  }),
  paymentMethod: z.enum(['bkash_full', 'cod_advance', 'manual']),
  deliveryFee: z.number().min(0),
  discount: z.number().min(0).optional().default(0),
  markPaid: z.boolean().optional().default(false),
  adminNote: z.string().max(2000).optional().default(''),
  tags: z.array(z.string().trim().max(30)).optional().default([]),
})), async (req, res, next) => {
  try {
    const { items, customer, paymentMethod, deliveryFee, markPaid, adminNote, tags } = req.body;
    const { orderItems, subtotal } = await buildOrderItems(items);
    const discount = Math.min(req.body.discount, subtotal);
    const total = subtotal - discount + deliveryFee;
    const s = (await Settings.findOne({ key: 'site' }).lean())?.data || {};
    const codAdvance = s.codAdvance !== undefined && s.codAdvance !== null
      ? Number(s.codAdvance)
      : Number(process.env.COD_ADVANCE_AMOUNT || 200);
    const advanceDue = paymentMethod === 'cod_advance' ? Math.min(codAdvance, total) : total;
    const codDue = paymentMethod === 'cod_advance' ? total - advanceDue : 0;

    const order = new Order({
      orderNo: `NB${await nextSeq('order')}`,
      items: orderItems, customer, subtotal, deliveryFee, discount, total,
      paymentMethod, advanceDue, codDue, source: 'admin', adminNote, tags,
      status: 'awaiting_payment',
      statusHistory: [{ status: 'awaiting_payment', note: `অ্যাডমিন (${req.admin.email}) অর্ডার তৈরি করেছে` }],
    });
    if (markPaid) {
      order.payment.status = 'paid';
      order.payment.amountPaid = paymentMethod === 'cod_advance' ? advanceDue : total;
      order.payment.paidAt = new Date();
      order.status = 'confirmed';
      order.statusHistory.push({ status: 'confirmed', note: 'তৈরির সময়েই paid মার্ক' });
      await takeStock(order);
      notifyPaid(order);
    }
    await order.save();
    res.status(201).json(order);
  } catch (e) { next(e); }
});

/* ---------- Order edit: আইটেম/ডেলিভারি/ডিসকাউন্ট বদল (শিপের আগে) ---------- */
router.put('/orders/:id/edit', validate(z.object({
  items: z.array(draftItemZ).min(1).max(50),
  deliveryFee: z.number().min(0).optional(),
  discount: z.number().min(0).optional(),
  note: z.string().max(400).optional().default(''),
})), async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'পাওয়া যায়নি' });
    if (['shipped', 'delivered', 'cancelled', 'returned'].includes(o.status)) {
      return res.status(400).json({ error: `"${o.status}" অর্ডার এডিট করা যায় না — আগে স্ট্যাটাস বদলান` });
    }
    const wasReduced = o.stockReduced;
    if (wasReduced) await restock(o); // পুরনো আইটেমের স্টক ফেরত

    const { orderItems, subtotal } = await buildOrderItems(req.body.items);
    o.items = orderItems;
    o.subtotal = subtotal;
    if (req.body.deliveryFee !== undefined) o.deliveryFee = req.body.deliveryFee;
    o.discount = Math.min(req.body.discount !== undefined ? req.body.discount : o.discount, subtotal);
    o.total = o.subtotal - o.discount + o.deliveryFee;
    const paid = o.payment.amountPaid || 0;
    o.codDue = Math.max(o.total - paid, 0);
    if (o.payment.status !== 'paid') {
      o.advanceDue = o.paymentMethod === 'cod_advance' ? Math.min(o.advanceDue, o.total) : o.total;
    }
    if (wasReduced) await takeStock(o); // নতুন আইটেমের স্টক কাটা
    o.statusHistory.push({ status: o.status, note: req.body.note || `অ্যাডমিন অর্ডার এডিট করেছে — নতুন মোট ৳${o.total}${paid > o.total ? ` (৳${paid - o.total} ফেরত দিতে হবে)` : ''}` });
    await o.save();
    res.json(o);
  } catch (e) { next(e); }
});

/* ---------- Order note & tags ---------- */
router.put('/orders/:id/meta', validate(z.object({
  adminNote: z.string().max(2000).optional(),
  tags: z.array(z.string().trim().max(30)).max(20).optional(),
})), async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const upd = {};
    if (req.body.adminNote !== undefined) upd.adminNote = req.body.adminNote;
    if (req.body.tags !== undefined) upd.tags = req.body.tags;
    const o = await Order.findByIdAndUpdate(req.params.id, upd, { new: true });
    if (!o) return res.status(404).json({ error: 'পাওয়া যায়নি' });
    res.json(o);
  } catch (e) { next(e); }
});

router.get('/customers/export', async (req, res, next) => {
  try {
    const items = await Order.aggregate([
      { $group: {
        _id: '$customer.phone', name: { $last: '$customer.name' }, address: { $last: '$customer.address' },
        orders: { $sum: 1 }, totalSpent: { $sum: { $cond: [{ $eq: ['$payment.status', 'paid'] }, '$total', 0] } },
        lastOrderAt: { $max: '$createdAt' },
      } }, { $sort: { totalSpent: -1 } }, { $limit: 10000 },
    ]);
    const head = ['Phone', 'Name', 'Address', 'Orders', 'TotalSpent', 'LastOrder'];
    const rows = items.map((c) => [c._id, c.name, c.address, c.orders, c.totalSpent, new Date(c.lastOrderAt).toISOString()].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="customers-${Date.now()}.csv"`);
    res.send('\ufeff' + head.join(',') + '\n' + rows.join('\n'));
  } catch (e) { next(e); }
});

/* ---------- Customer detail (তার সব অর্ডার) ---------- */
router.get('/customers/:phone/orders', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const orders = await Order.find({ 'customer.phone': phone })
      .select('orderNo total status payment.status paymentMethod codDue createdAt items.title items.qty')
      .sort({ createdAt: -1 }).limit(100).lean();
    res.json(orders);
  } catch (e) { next(e); }
});

/* ---------- Bulk order actions (Shopify-style multi-select) ---------- */
router.post('/orders/bulk', validate(z.object({
  ids: z.array(z.string().refine(oid)).min(1).max(200),
  action: z.enum(['status', 'payment', 'delete']),
  status: z.enum(['confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']).optional(),
  paymentStatus: z.enum(['paid', 'pending', 'failed', 'refunded']).optional(),
  note: z.string().max(300).optional().default(''),
})), async (req, res, next) => {
  try {
    const { ids, action, status, paymentStatus, note } = req.body;
    if (action === 'status' && !status) return res.status(422).json({ error: 'status দিতে হবে' });
    if (action === 'payment' && !paymentStatus) return res.status(422).json({ error: 'paymentStatus দিতে হবে' });
    let done = 0; const failed = [];
    for (const id of ids) {
      try {
        const o = await Order.findById(id);
        if (!o) { failed.push(id); continue; }
        if (action === 'delete') {
          if (o.stockReduced && o.status !== 'delivered') await restock(o);
          await Order.deleteOne({ _id: o._id });
        } else if (action === 'status') {
          if (['cancelled', 'returned'].includes(status) && o.stockReduced) await restock(o);
          if (status === 'delivered' && o.paymentMethod === 'cod_advance') o.payment.amountPaid = o.total;
          o.status = status;
          o.statusHistory.push({ status, note: note || 'বাল্ক আপডেট' });
          await o.save();
        } else if (action === 'payment') {
          o.payment.status = paymentStatus;
          if (paymentStatus === 'paid') {
            o.payment.amountPaid = o.payment.amountPaid || o.advanceDue;
            o.payment.paidAt = o.payment.paidAt || new Date();
            await takeStock(o);
            if (o.status === 'awaiting_payment') o.status = 'confirmed';
          }
          o.statusHistory.push({ status: o.status, note: note || `বাল্ক: পেমেন্ট "${paymentStatus}"` });
          await o.save();
        }
        done++;
      } catch { failed.push(id); }
    }
    res.json({ done, failed });
  } catch (e) { next(e); }
});

/* ---------- Order permanent delete ---------- */
router.delete('/orders/:id', async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'পাওয়া যায়নি' });
    if (o.stockReduced && o.status !== 'delivered') await restock(o); // ডেলিভার হয়নি এমন অর্ডার মুছলে স্টক ফেরত
    await Order.deleteOne({ _id: o._id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================= COUPONS ================= */
const couponZ = z.object({
  code: z.string().trim().min(2).max(30),
  type: z.enum(['percent', 'fixed']),
  value: z.number().min(0),
  minOrder: z.number().min(0).default(0),
  maxDiscount: z.number().min(0).default(0),
  usageLimit: z.number().int().min(0).default(0),
  expiresAt: z.string().datetime().optional().nullable(),
  active: z.boolean().default(true),
});
router.get('/coupons', async (req, res, next) => {
  try { res.json(await Coupon.find().sort({ createdAt: -1 }).lean()); } catch (e) { next(e); }
});
router.post('/coupons', validate(couponZ), async (req, res, next) => {
  try { res.status(201).json(await Coupon.create(req.body)); }
  catch (e) { e.code === 11000 ? res.status(400).json({ error: 'এই কোড আগে থেকেই আছে' }) : next(e); }
});
router.put('/coupons/:id', validate(couponZ.partial()), async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    res.json(await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true }));
  } catch (e) { next(e); }
});
router.delete('/coupons/:id', async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    await Coupon.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================= BLOG & PAGES ================= */
const blogZ = z.object({
  title: z.string().trim().min(2).max(200),
  excerpt: z.string().max(500).default(''),
  content: z.string().max(120000).default(''),
  coverImage: z.string().max(400).default(''),
  tags: z.array(z.string().max(40)).default([]),
  published: z.boolean().default(false),
});
router.get('/blog', async (req, res, next) => {
  try { res.json(await Blog.find().sort({ createdAt: -1 }).lean()); } catch (e) { next(e); }
});
router.post('/blog', validate(blogZ), async (req, res, next) => {
  try {
    const body = { ...req.body, content: sanitizeHtml(req.body.content) };
    body.slug = await uniqueSlug(Blog, makeSlug(body.title));
    if (body.published) body.publishedAt = new Date();
    res.status(201).json(await Blog.create(body));
  } catch (e) { next(e); }
});
router.put('/blog/:id', validate(blogZ.partial()), async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const body = { ...req.body };
    if (body.content !== undefined) body.content = sanitizeHtml(body.content);
    if (body.published) body.publishedAt = new Date();
    res.json(await Blog.findByIdAndUpdate(req.params.id, body, { new: true }));
  } catch (e) { next(e); }
});
router.delete('/blog/:id', async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    await Blog.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

const pageZ = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().max(200).optional(),
  content: z.string().max(120000).default(''),
  published: z.boolean().default(true),
});
router.get('/pages', async (req, res, next) => {
  try { res.json(await Page.find().sort({ title: 1 }).lean()); } catch (e) { next(e); }
});
router.post('/pages', validate(pageZ), async (req, res, next) => {
  try {
    const body = { ...req.body, content: sanitizeHtml(req.body.content) };
    body.slug = await uniqueSlug(Page, makeSlug(body.slug || body.title));
    res.status(201).json(await Page.create(body));
  } catch (e) { next(e); }
});
router.put('/pages/:id', validate(pageZ.partial()), async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const body = { ...req.body };
    if (body.content !== undefined) body.content = sanitizeHtml(body.content);
    res.json(await Page.findByIdAndUpdate(req.params.id, body, { new: true }));
  } catch (e) { next(e); }
});
router.delete('/pages/:id', async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    await Page.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================= REVIEWS (moderation) ================= */
router.get('/reviews', async (req, res, next) => {
  try {
    const { page = 1, approved } = req.query;
    const filter = {};
    if (approved === '1') filter.approved = true;
    if (approved === '0') filter.approved = false;
    const perPage = 30, pg = Math.max(Number(page) || 1, 1);
    const [items, total] = await Promise.all([
      Review.find(filter).populate('product', 'title slug').sort({ createdAt: -1 }).skip((pg - 1) * perPage).limit(perPage).lean(),
      Review.countDocuments(filter),
    ]);
    res.json({ items, total, pages: Math.ceil(total / perPage) });
  } catch (e) { next(e); }
});
router.put('/reviews/:id/toggle', async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const r = await Review.findById(req.params.id);
    if (!r) return res.status(404).json({ error: 'পাওয়া যায়নি' });
    r.approved = !r.approved;
    await r.save();
    res.json(r);
  } catch (e) { next(e); }
});
router.delete('/reviews/:id', async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    await Review.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================= CUSTOMERS (অর্ডার থেকে derived) ================= */
router.get('/customers', async (req, res, next) => {
  try {
    const { q, page = 1 } = req.query;
    const match = {};
    if (q) {
      const safe = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      match.$or = [{ 'customer.phone': new RegExp(safe) }, { 'customer.name': new RegExp(safe, 'i') }];
    }
    const perPage = 30, pg = Math.max(Number(page) || 1, 1);
    const pipeline = [
      { $match: match },
      { $group: {
        _id: '$customer.phone',
        name: { $last: '$customer.name' },
        address: { $last: '$customer.address' },
        orders: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $in: ['$status', ['cancelled', 'returned']] }, 1, 0] } },
        totalSpent: { $sum: { $cond: [{ $eq: ['$payment.status', 'paid'] }, '$total', 0] } },
        lastOrderAt: { $max: '$createdAt' },
      } },
      { $sort: { lastOrderAt: -1 } },
    ];
    const [items, totalArr] = await Promise.all([
      Order.aggregate([...pipeline, { $skip: (pg - 1) * perPage }, { $limit: perPage }]),
      Order.aggregate([...pipeline, { $count: 'n' }]),
    ]);
    const total = totalArr[0]?.n || 0;
    res.json({ items, total, pages: Math.ceil(total / perPage) });
  } catch (e) { next(e); }
});

/* ---------- টেস্ট মেইল ---------- */
router.post('/test-mail', async (req, res, next) => {
  try {
    const to = await sendTestMail();
    res.json({ ok: true, to });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ================= PAYMENT GATEWAYS ================= */
const { GATEWAY_META, getGatewaysConfig } = require('../services/gateways');
const SECRETISH = /secret|password|key/i;

router.get('/gateways', async (req, res, next) => {
  try {
    const cfg = await getGatewaysConfig();
    const out = {};
    for (const [id, meta] of Object.entries(GATEWAY_META)) {
      const c = cfg[id] || {};
      out[id] = { name: meta.name, enabled: !!c.enabled, sandbox: c.sandbox !== false, fields: {}, unsupported: meta.unsupported || null };
      for (const f of meta.fields) {
        // secret মাস্ক করে পাঠাই — সেভ আছে কিনা শুধু সেটা জানাই
        out[id].fields[f] = { saved: !!c[f], value: SECRETISH.test(f) ? '' : (c[f] || '') };
      }
    }
    res.json(out);
  } catch (e) { next(e); }
});

router.put('/gateways', validate(z.object({
  id: z.enum(['bkash', 'sslcommerz', 'aamarpay', 'shurjopay', 'nagad', 'portwallet']),
  enabled: z.boolean(),
  sandbox: z.boolean().default(true),
  fields: z.record(z.string().max(5000)).default({}),
})), async (req, res, next) => {
  try {
    const { id, enabled, sandbox, fields } = req.body;
    const meta = GATEWAY_META[id];
    if (enabled && meta.unsupported) return res.status(400).json({ error: meta.unsupported });
    const cur = (await getGatewaysConfig())[id] || {};
    const merged = { ...cur, enabled, sandbox };
    for (const f of meta.fields) {
      if (fields[f] !== undefined && fields[f] !== '') merged[f] = fields[f].trim(); // ফাঁকা মানে আগেরটাই থাকবে
    }
    if (enabled) {
      const missing = meta.fields.filter((f) => !merged[f]);
      if (missing.length) return res.status(400).json({ error: `এই ফিল্ডগুলো লাগবে: ${missing.join(', ')}` });
    }
    await Settings.findOneAndUpdate({ key: 'site' }, { $set: { [`data.gateways.${id}`]: merged } }, { upsert: true });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================= COURIER (Steadfast) ================= */
const steadfast = require('../services/steadfast');

router.get('/courier', async (req, res, next) => {
  try {
    const c = await steadfast.getConfig();
    res.json({ enabled: !!c.enabled, apiKeySaved: !!c.apiKey, secretKeySaved: !!c.secretKey });
  } catch (e) { next(e); }
});

router.put('/courier', validate(z.object({
  enabled: z.boolean(),
  apiKey: z.string().max(200).optional().default(''),
  secretKey: z.string().max(200).optional().default(''),
})), async (req, res, next) => {
  try {
    const cur = await steadfast.getConfig();
    const merged = {
      enabled: req.body.enabled,
      apiKey: req.body.apiKey || cur.apiKey || '',
      secretKey: req.body.secretKey || cur.secretKey || '',
    };
    if (merged.enabled && (!merged.apiKey || !merged.secretKey)) {
      return res.status(400).json({ error: 'API Key আর Secret Key দুটোই লাগবে' });
    }
    await Settings.findOneAndUpdate({ key: 'site' }, { $set: { 'data.courier.steadfast': merged } }, { upsert: true });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/courier/balance', async (req, res, next) => {
  try { res.json({ balance: await steadfast.getBalance() }); } catch (e) { next(e); }
});

/* এক অর্ডার Steadfast-এ পাঠানো */
router.post('/orders/:id/ship-steadfast', async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'পাওয়া যায়নি' });
    if (o.courier?.consignmentId) return res.status(400).json({ error: `আগেই পাঠানো হয়েছে (ট্র্যাকিং: ${o.courier.trackingId})` });
    if (['cancelled', 'returned', 'delivered'].includes(o.status)) return res.status(400).json({ error: `"${o.status}" অর্ডার পাঠানো যায় না` });

    const r = await steadfast.createOrder(o);
    o.courier = { name: 'Steadfast', trackingId: r.trackingCode, consignmentId: r.consignmentId, lastSync: new Date() };
    o.status = 'shipped';
    o.statusHistory.push({ status: 'shipped', note: `Steadfast-এ বুক হয়েছে — ট্র্যাকিং ${r.trackingCode}, COD ৳${o.codDue}` });
    await o.save();
    res.json(o);
  } catch (e) { next(e); }
});

/* বাল্ক Steadfast */
router.post('/orders/bulk-ship', validate(z.object({
  ids: z.array(z.string().refine(oid)).min(1).max(100),
})), async (req, res, next) => {
  try {
    const orders = await Order.find({
      _id: { $in: req.body.ids },
      'courier.consignmentId': { $in: [null, undefined, ''] },
      status: { $nin: ['cancelled', 'returned', 'delivered'] },
    });
    if (!orders.length) return res.status(400).json({ error: 'পাঠানোর মতো অর্ডার নেই (আগেই বুকড বা বাতিল/ডেলিভার্ড)' });

    const results = await steadfast.createBulk(orders);
    let done = 0; const failed = [];
    for (const o of orders) {
      const r = results.find((x) => x.invoice === o.orderNo);
      if (r && (r.tracking_code || r.trackingCode)) {
        o.courier = { name: 'Steadfast', trackingId: r.tracking_code || r.trackingCode, consignmentId: String(r.consignment_id || ''), lastSync: new Date() };
        o.status = 'shipped';
        o.statusHistory.push({ status: 'shipped', note: `Steadfast বাল্ক বুকিং — ${o.courier.trackingId}` });
        await o.save();
        done++;
      } else failed.push(o.orderNo);
    }
    res.json({ done, failed });
  } catch (e) { next(e); }
});

/* Steadfast স্ট্যাটাস sync — delivered হলে অর্ডারও delivered */
router.post('/orders/:id/sync-courier', async (req, res, next) => {
  try {
    if (!oid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const o = await Order.findById(req.params.id);
    if (!o?.courier?.trackingId) return res.status(400).json({ error: 'এই অর্ডার কুরিয়ারে যায়নি' });
    const st = await steadfast.statusByInvoice(o.orderNo);
    o.courier.lastSync = new Date();
    if (st === 'delivered' && o.status !== 'delivered') {
      o.status = 'delivered';
      if (o.paymentMethod === 'cod_advance') o.payment.amountPaid = o.total;
      o.statusHistory.push({ status: 'delivered', note: 'Steadfast sync: ডেলিভার্ড' });
    } else if (st === 'cancelled' && !['cancelled', 'returned'].includes(o.status)) {
      o.statusHistory.push({ status: o.status, note: 'Steadfast sync: কুরিয়ার বাতিল করেছে — রিটার্ন হ্যান্ডেল করুন' });
    } else {
      o.statusHistory.push({ status: o.status, note: `Steadfast sync: ${st}` });
    }
    await o.save();
    res.json({ courierStatus: st, order: o });
  } catch (e) { next(e); }
});

/* ================= SETTINGS ================= */
router.get('/settings', async (req, res, next) => {
  try { res.json((await Settings.findOne({ key: 'site' }).lean())?.data || {}); } catch (e) { next(e); }
});
router.put('/settings', validate(z.object({
  siteName: z.string().max(100).optional(),
  logo: z.string().max(400).optional(),
  phone: z.string().max(20).optional(),
  address: z.string().max(300).optional(),
  facebook: z.string().max(300).optional(),
  codAdvance: z.number().min(0).optional(),
  deliveryInside: z.number().min(0).optional(),
  deliveryOutside: z.number().min(0).optional(),
  freeDeliveryThreshold: z.number().min(0).optional(),
})), async (req, res, next) => {
  try {
    const s = await Settings.findOneAndUpdate(
      { key: 'site' },
      { $set: Object.fromEntries(Object.entries(req.body).map(([k, v]) => [`data.${k}`, v])) },
      { new: true, upsert: true }
    );
    res.json(s.data);
  } catch (e) { next(e); }
});

module.exports = router;
