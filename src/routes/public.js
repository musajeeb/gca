const router = require('express').Router();
const { z } = require('zod');
const mongoose = require('mongoose');
const { Product, Collection, Order, Coupon, Blog, Page, Review, Customer, Stat, Settings, nextSeq } = require('../models');
const { validate, checkoutLimiter, trackLimiter, reviewLimiter, beaconLimiter, loginLimiter, PHONE_RE, ADDRESS_RE, normalizePhone, signCustomerToken, requireCustomer, optionalCustomer } = require('../middleware');
const bcrypt = require('bcryptjs');
const { notifyNewOrder, sendOtpMail } = require('../services/mailer');
const crypto = require('crypto');

const oid = (s) => mongoose.isValidObjectId(s);
const zPhone = z.string().trim()
  .regex(PHONE_RE, 'ফোন নম্বর 01XXXXXXXXX (১১ ডিজিট) বা +8801XXXXXXXXX ফরম্যাটে দিন')
  .transform(normalizePhone);

/* ---------- Visit beacon (session-প্রতি একবার, conversion rate-এর জন্য) ---------- */
router.post('/t', beaconLimiter, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await Stat.updateOne({ date: today }, { $inc: { visits: 1 } }, { upsert: true });
  } catch {}
  res.json({ ok: 1 });
});

/* ---------- Settings (public subset) ---------- */
const { enabledGateways } = require('../services/gateways');
router.get('/settings', async (req, res, next) => {
  try {
    const s = await Settings.findOne({ key: 'site' }).lean();
    const d = s?.data || {};
    res.json({
      siteName: d.siteName, logo: d.logo || '', phone: d.phone, address: d.address, facebook: d.facebook,
      codAdvance: d.codAdvance, deliveryInside: d.deliveryInside, deliveryOutside: d.deliveryOutside,
      freeDeliveryThreshold: d.freeDeliveryThreshold,
      gateways: await enabledGateways(),
    });
  } catch (e) { next(e); }
});

/* ---------- Collections ---------- */
router.get('/collections', async (req, res, next) => {
  try {
    const list = await Collection.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean();
    res.json(list);
  } catch (e) { next(e); }
});

/* ---------- Live search suggest (typo-tolerant fuzzy) ---------- */
const fuzzy = require('../services/search');
router.get('/search/suggest', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').slice(0, 80);
    if (q.trim().length < 2) return res.json([]);
    const items = await fuzzy.search(q, 8);
    res.json(items.map((p) => ({
      title: p.title, slug: p.slug, brand: p.brand,
      image: p.images?.[0] || '', price: Math.min(...p.variants.map((v) => v.price)),
      inStock: p.variants.some((v) => v.stock > 0),
    })));
  } catch (e) { next(e); }
});

/* ---------- Products (list + filters + search + pagination) ---------- */
router.get('/products', async (req, res, next) => {
  try {
    const { collection, q, sort, featured, page = 1, limit = 24, brand } = req.query;
    const filter = { status: 'active' };
    if (featured === '1') filter.featured = true;
    if (brand) filter.brand = String(brand);
    if (collection) {
      const col = await Collection.findOne({ slug: String(collection) }).lean();
      if (!col) return res.json({ items: [], total: 0, pages: 0 });
      if (col.smart && (col.rules?.tags?.length || col.rules?.brands?.length)) {
        // Smart collection: rules-এ মিললে অটো অন্তর্ভুক্ত (ম্যানুয়ালি যোগ করা প্রোডাক্টও থাকবে)
        const or = [{ collections: col._id }];
        if (col.rules.tags?.length) or.push({ tags: { $in: col.rules.tags } });
        if (col.rules.brands?.length) or.push({ brand: { $in: col.rules.brands.map((b) => new RegExp(`^${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) } });
        filter.$or = or;
      } else {
        filter.collections = col._id;
      }
    }
    if (q) filter.$text = { $search: String(q) };

    const sortMap = {
      newest: { createdAt: -1 },
      price_asc: { 'variants.0.price': 1 },
      price_desc: { 'variants.0.price': -1 },
      popular: { soldCount: -1 },
    };
    const perPage = Math.min(Number(limit) || 24, 48);
    const pg = Math.max(Number(page) || 1, 1);

    let [items, total] = await Promise.all([
      Product.find(filter)
        .select('title slug brand images variants.price variants.comparePrice variants.stock shortDescription featured')
        .sort(sortMap[sort] || { createdAt: -1 })
        .skip((pg - 1) * perPage)
        .limit(perPage)
        .lean({ virtuals: true }),
      Product.countDocuments(filter),
    ]);
    // বানান ভুল হলে $text কিছু পায় না — fuzzy fallback
    if (q && total === 0 && !collection) {
      items = await fuzzy.search(String(q), perPage);
      total = items.length;
    }
    res.json({ items, total, pages: Math.ceil(total / perPage) });
  } catch (e) { next(e); }
});

router.get('/products/:slug', async (req, res, next) => {
  try {
    const p = await Product.findOne({ slug: req.params.slug, status: 'active' })
      .populate('collections', 'name slug')
      .lean({ virtuals: true });
    if (!p) return res.status(404).json({ error: 'প্রোডাক্ট পাওয়া যায়নি' });
    p.variants = p.variants.map((v) => { delete v.costPrice; return v; });
    const related = await Product.find({
      status: 'active', _id: { $ne: p._id },
      collections: { $in: (p.collections || []).map((c) => c._id) },
    }).select('title slug images variants.price').limit(4).lean();
    const [reviews, ratingAgg] = await Promise.all([
      Review.find({ product: p._id, approved: true })
        .select('name rating comment verified createdAt').sort({ createdAt: -1 }).limit(30).lean(),
      Review.aggregate([
        { $match: { product: p._id, approved: true } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
    ]);
    const rating = ratingAgg[0] ? { avg: Math.round(ratingAgg[0].avg * 10) / 10, count: ratingAgg[0].count } : { avg: 0, count: 0 };
    res.json({ product: p, related, reviews, rating });
  } catch (e) { next(e); }
});

/* ---------- Blog & Pages ---------- */
router.get('/blog', async (req, res, next) => {
  try {
    const posts = await Blog.find({ published: true }).select('-content').sort({ publishedAt: -1 }).limit(30).lean();
    res.json(posts);
  } catch (e) { next(e); }
});
router.get('/blog/:slug', async (req, res, next) => {
  try {
    const post = await Blog.findOne({ slug: req.params.slug, published: true }).lean();
    if (!post) return res.status(404).json({ error: 'পোস্ট পাওয়া যায়নি' });
    res.json(post);
  } catch (e) { next(e); }
});
router.get('/pages/:slug', async (req, res, next) => {
  try {
    const page = await Page.findOne({ slug: req.params.slug, published: true }).lean();
    if (!page) return res.status(404).json({ error: 'পেজ পাওয়া যায়নি' });
    res.json(page);
  } catch (e) { next(e); }
});

/* ---------- Coupon check ---------- */
router.post('/coupon/check', validate(z.object({ code: z.string().min(2).max(30), subtotal: z.number().min(0) })), async (req, res, next) => {
  try {
    const c = await Coupon.findOne({ code: req.body.code.toUpperCase(), active: true }).lean();
    const fail = (m) => res.status(400).json({ error: m });
    if (!c) return fail('কুপন কোডটা ঠিক না');
    if (c.expiresAt && c.expiresAt < new Date()) return fail('কুপনের মেয়াদ শেষ');
    if (c.usageLimit && c.usedCount >= c.usageLimit) return fail('কুপনের ব্যবহার সীমা শেষ');
    if (req.body.subtotal < c.minOrder) return fail(`কমপক্ষে ৳${c.minOrder} অর্ডারে এই কুপন চলবে`);
    res.json({ code: c.code, type: c.type, value: c.value, maxDiscount: c.maxDiscount });
  } catch (e) { next(e); }
});

/* ---------- Checkout: order create (সব দাম server-এ হিসাব) ---------- */
const checkoutSchema = z.object({
  items: z.array(z.object({
    productId: z.string().refine(oid, 'invalid id'),
    variantId: z.string().refine(oid, 'invalid id'),
    qty: z.number().int().min(1).max(20),
  })).min(1).max(30),
  customer: z.object({
    name: z.string().trim().min(2).max(80),
    phone: zPhone,
    email: z.string().trim().email('সঠিক ইমেইল দিন').max(120).optional().or(z.literal('')).default(''),
    address: z.string().trim().min(8).max(400)
      .regex(ADDRESS_RE, 'ঠিকানা ইংরেজিতে লিখুন — অক্ষর, সংখ্যা আর কমা/সেমিকোলন/কোলন ছাড়া অন্য চিহ্ন চলবে না'),
    area: z.enum(['inside_dhaka', 'outside_dhaka']),
    note: z.string().max(300).optional().default(''),
  }),
  paymentMethod: z.enum(['bkash_full', 'cod_advance']),
  gateway: z.string().max(30).optional().default('bkash'),
  couponCode: z.string().max(30).optional(),
  website: z.string().max(0).optional(), // honeypot — bot হলে ভরবে
});

router.post('/checkout', checkoutLimiter, requireCustomer, validate(checkoutSchema), async (req, res, next) => {
  try {
    if (req.body.website) return res.status(400).json({ error: 'Invalid request' });
    const { items, customer, paymentMethod, couponCode } = req.body;

    // ---- server-side price + stock verification ----
    const orderItems = [];
    let subtotal = 0;
    for (const it of items) {
      const p = await Product.findOne({ _id: it.productId, status: 'active' }).select('+variants.costPrice').lean();
      if (!p) return res.status(400).json({ error: 'একটা প্রোডাক্ট আর available নেই' });
      const v = p.variants.find((x) => x._id.toString() === it.variantId);
      if (!v) return res.status(400).json({ error: `${p.title} — ভ্যারিয়েন্ট পাওয়া যায়নি` });
      if (v.stock < it.qty) return res.status(400).json({ error: `${p.title} — স্টকে আছে মাত্র ${v.stock}টা` });
      subtotal += v.price * it.qty;
      orderItems.push({
        product: p._id, variantId: v._id, title: p.title, variantName: v.name,
        sku: v.sku, image: p.images?.[0] || '', price: v.price,
        costPrice: v.costPrice || 0, qty: it.qty,
      });
    }

    // ---- delivery + coupon ----
    const s = (await Settings.findOne({ key: 'site' }).lean())?.data || {};
    let deliveryFee = customer.area === 'inside_dhaka' ? (s.deliveryInside ?? 70) : (s.deliveryOutside ?? 130);
    if (s.freeDeliveryThreshold > 0 && subtotal >= s.freeDeliveryThreshold) deliveryFee = 0;

    let discount = 0, appliedCoupon;
    if (couponCode) {
      const c = await Coupon.findOne({ code: couponCode.toUpperCase(), active: true });
      if (c && (!c.expiresAt || c.expiresAt > new Date()) && (!c.usageLimit || c.usedCount < c.usageLimit) && subtotal >= c.minOrder) {
        discount = c.type === 'percent' ? Math.floor((subtotal * c.value) / 100) : c.value;
        if (c.type === 'percent' && c.maxDiscount > 0) discount = Math.min(discount, c.maxDiscount);
        discount = Math.min(discount, subtotal);
        appliedCoupon = c.code;
        await Coupon.updateOne({ _id: c._id }, { $inc: { usedCount: 1 } });
      }
    }

    const total = subtotal - discount + deliveryFee;
    // Dashboard-এর মান আগে (০ হলেও সম্মান পাবে), env শুধু fallback
    const codAdvance = s.codAdvance !== undefined && s.codAdvance !== null
      ? Number(s.codAdvance)
      : Number(process.env.COD_ADVANCE_AMOUNT || 200);
    const advanceDue = paymentMethod === 'bkash_full' ? total : Math.min(codAdvance, total);
    const codDue = paymentMethod === 'cod_advance' ? total - advanceDue : 0;

    // অনলাইন পেমেন্ট লাগবে কি? অগ্রিম ০ হলে বা কোনো gateway চালু না থাকলে — লাগবে না,
    // অর্ডার সরাসরি কনফার্ম হবে (সার্ভার এরর দিয়ে অর্ডার হারানো চলবে না)
    const gws = await enabledGateways();
    const requiresPayment = advanceDue > 0 && gws.length > 0;

    const orderNo = `NB${await nextSeq('order')}`;
    const order = new Order({
      orderNo, items: orderItems, customer,
      customerId: req.customer.id,
      subtotal, deliveryFee, discount, couponCode: appliedCoupon,
      total, paymentMethod, advanceDue, codDue,
      status: 'awaiting_payment',
      statusHistory: [{ status: 'awaiting_payment', note: 'অর্ডার তৈরি' }],
    });

    if (!requiresPayment) {
      order.advanceDue = 0;
      order.codDue = total; // পুরোটা ডেলিভারিতে
      order.status = 'confirmed';
      order.statusHistory.push({
        status: 'confirmed',
        note: advanceDue === 0
          ? 'অগ্রিম ছাড়া COD — অর্ডার কনফার্মড, পুরো টাকা ডেলিভারিতে'
          : 'কোনো পেমেন্ট গেটওয়ে চালু নেই — অর্ডার কনফার্মড, পেমেন্ট ম্যানুয়ালি নিতে হবে',
      });
      // স্টক এখনই কাটা (নাহলে overselling হবে) — cancel করলে ফেরত যায়
      for (const it of orderItems) {
        await Product.updateOne(
          { _id: it.product, 'variants._id': it.variantId },
          { $inc: { 'variants.$.stock': -it.qty, soldCount: it.qty } }
        );
      }
      order.stockReduced = true;
    }
    await order.save();

    notifyNewOrder(order); // fire-and-forget — মেইল ব্যর্থ হলেও অর্ডার আটকায় না
    res.json({
      orderNo: order.orderNo, orderId: order._id,
      advanceDue: order.advanceDue, codDue: order.codDue, total,
      noPayment: !requiresPayment,
    });
  } catch (e) { next(e); }
});

/* ---------- Order tracking (orderNo + phone দিয়ে — IDOR-safe) ---------- */
router.post('/orders/track', trackLimiter, validate(z.object({
  orderNo: z.string().trim().min(2).max(20),
  phone: zPhone,
})), async (req, res, next) => {
  try {
    const o = await Order.findOne({ orderNo: req.body.orderNo.toUpperCase(), 'customer.phone': req.body.phone })
      .select('orderNo items status statusHistory total advanceDue codDue payment.status payment.trxID paymentMethod courier createdAt deliveryFee discount subtotal')
      .lean();
    if (!o) return res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি — নম্বর দুটো মিলিয়ে দেখুন' });
    res.json(o);
  } catch (e) { next(e); }
});

/* ---------- Review submit (শুধু verified কাস্টমার: delivered অর্ডার + ফোন মিলতে হবে) ---------- */
router.post('/reviews', reviewLimiter, validate(z.object({
  productId: z.string().refine(oid, 'invalid id'),
  orderNo: z.string().trim().min(2).max(20),
  phone: zPhone,
  name: z.string().trim().min(2).max(60),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional().default(''),
})), async (req, res, next) => {
  try {
    const { productId, orderNo, phone, name, rating, comment } = req.body;
    // verification: এই ফোন+অর্ডারে প্রোডাক্টটা delivered হয়েছে তো?
    const order = await Order.findOne({
      orderNo: orderNo.toUpperCase(), 'customer.phone': phone,
      status: 'delivered', 'items.product': productId,
    }).select('_id').lean();
    if (!order) {
      return res.status(403).json({ error: 'রিভিউ দিতে হলে এই প্রোডাক্টের ডেলিভার্ড অর্ডারের নম্বর ও ফোন মিলতে হবে' });
    }
    try {
      const r = await Review.create({ product: productId, orderNo: orderNo.toUpperCase(), phone, name, rating, comment, verified: true });
      res.status(201).json({ ok: true, review: { name: r.name, rating: r.rating, comment: r.comment, verified: true, createdAt: r.createdAt } });
    } catch (e) {
      if (e.code === 11000) return res.status(400).json({ error: 'এই অর্ডার থেকে এই প্রোডাক্টে আগেই রিভিউ দেওয়া হয়েছে' });
      throw e;
    }
  } catch (e) { next(e); }
});

/* ================= CUSTOMER ACCOUNT (অর্ডারে অ্যাকাউন্ট বাধ্যতামূলক) ================= */
const hashOtp = (code) => crypto.createHash('sha256').update(code + process.env.JWT_SECRET).digest('hex');
const genOtp = () => String(crypto.randomInt(100000, 1000000)); // 6 digit

async function issueOtp(customer) {
  const code = genOtp();
  customer.otpHash = hashOtp(code);
  customer.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
  customer.otpTries = 0;
  await customer.save();
  await sendOtpMail(customer.email, customer.name, code); // ব্যর্থ হলে throw
}

router.post('/auth/register', loginLimiter, validate(z.object({
  name: z.string().trim().min(2).max(80),
  phone: zPhone,
  email: z.string().trim().email('সঠিক ইমেইল দিন').max(120).toLowerCase(),
  password: z.string().min(8, 'পাসওয়ার্ড কমপক্ষে ৮ ক্যারেক্টার').max(100),
})), async (req, res, next) => {
  try {
    const { name, phone, email, password } = req.body;
    if (await Customer.findOne({ phone })) return res.status(400).json({ error: 'এই নম্বরে আগেই অ্যাকাউন্ট আছে — লগইন করুন' });
    if (await Customer.findOne({ email })) return res.status(400).json({ error: 'এই ইমেইলে আগেই অ্যাকাউন্ট আছে — লগইন করুন' });
    const hash = await bcrypt.hash(password, 12);
    const c = await Customer.create({ name, phone, email, password: hash, emailVerified: false });
    try {
      await issueOtp(c);
    } catch (e) {
      return res.status(502).json({ error: 'ভেরিফিকেশন মেইল পাঠানো যায়নি — কিছুক্ষণ পরে "কোড আবার পাঠান" চাপুন', pendingVerify: true });
    }
    res.status(201).json({ pendingVerify: true, email: c.email });
  } catch (e) { next(e); }
});

router.post('/auth/verify-otp', loginLimiter, validate(z.object({
  phone: zPhone,
  otp: z.string().trim().regex(/^\d{6}$/, '৬ ডিজিটের কোড দিন'),
})), async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.body.phone, active: true }).select('+otpHash +otpExpires +otpTries');
    if (!c) return res.status(404).json({ error: 'অ্যাকাউন্ট পাওয়া যায়নি' });
    if (c.emailVerified) return res.json({ token: signCustomerToken(c), name: c.name, phone: c.phone });
    if (!c.otpHash || !c.otpExpires || c.otpExpires < new Date()) {
      return res.status(400).json({ error: 'কোডের মেয়াদ শেষ — "কোড আবার পাঠান" চাপুন' });
    }
    if (c.otpTries >= 5) return res.status(429).json({ error: 'অনেকবার ভুল হয়েছে — নতুন কোড নিন' });
    if (hashOtp(req.body.otp) !== c.otpHash) {
      c.otpTries += 1;
      await c.save();
      return res.status(400).json({ error: `কোড ভুল (${5 - c.otpTries} বার বাকি)` });
    }
    c.emailVerified = true;
    c.otpHash = undefined; c.otpExpires = undefined; c.otpTries = 0;
    await c.save();
    res.json({ token: signCustomerToken(c), name: c.name, phone: c.phone, address: c.address });
  } catch (e) { next(e); }
});

router.post('/auth/resend-otp', loginLimiter, validate(z.object({ phone: zPhone })), async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.body.phone, active: true });
    if (!c) return res.status(404).json({ error: 'অ্যাকাউন্ট পাওয়া যায়নি' });
    if (c.emailVerified) return res.status(400).json({ error: 'ইমেইল আগেই ভেরিফায়েড — লগইন করুন' });
    if (!c.email) return res.status(400).json({ error: 'এই অ্যাকাউন্টে ইমেইল নেই — নতুন করে রেজিস্টার করুন' });
    await issueOtp(c);
    res.json({ ok: true, email: c.email });
  } catch (e) {
    res.status(502).json({ error: 'মেইল পাঠানো যায়নি — অ্যাডমিনের ইমেইল কনফিগ চেক করা দরকার' });
  }
});

router.post('/auth/login', loginLimiter, validate(z.object({
  phone: zPhone,
  password: z.string().min(1).max(100),
})), async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.body.phone, active: true }).select('+password');
    const bad = () => res.status(401).json({ error: 'ফোন নম্বর বা পাসওয়ার্ড ভুল' });
    if (!c) return bad();
    const ok = await bcrypt.compare(req.body.password, c.password);
    if (!ok) return bad();
    if (!c.emailVerified) {
      return res.status(403).json({ error: 'ইমেইল ভেরিফাই করা হয়নি — কোড দিয়ে ভেরিফাই করুন', needVerify: true, email: c.email || '' });
    }
    res.json({ token: signCustomerToken(c), name: c.name, phone: c.phone, address: c.address });
  } catch (e) { next(e); }
});

router.get('/me', requireCustomer, async (req, res, next) => {
  try {
    const c = await Customer.findById(req.customer.id).lean();
    if (!c || !c.active) return res.status(401).json({ error: 'অ্যাকাউন্ট পাওয়া যায়নি' });
    res.json({ name: c.name, phone: c.phone, email: c.email || '', address: c.address });
  } catch (e) { next(e); }
});

router.put('/me', requireCustomer, validate(z.object({
  name: z.string().trim().min(2).max(80).optional(),
  address: z.string().trim().max(400).regex(ADDRESS_RE, 'ঠিকানা ইংরেজিতে লিখুন').optional().or(z.literal('')),
  password: z.string().min(6).max(100).optional(),
})), async (req, res, next) => {
  try {
    const upd = {};
    if (req.body.name) upd.name = req.body.name;
    if (req.body.address !== undefined) upd.address = req.body.address;
    if (req.body.password) upd.password = await bcrypt.hash(req.body.password, 12);
    const c = await Customer.findByIdAndUpdate(req.customer.id, upd, { new: true });
    res.json({ name: c.name, phone: c.phone, address: c.address });
  } catch (e) { next(e); }
});

router.get('/me/orders', requireCustomer, async (req, res, next) => {
  try {
    // নিরাপত্তা: ফোন-ম্যাচ দিয়ে না — শুধু এই অ্যাকাউন্ট থেকে করা অর্ডার।
    // নাহলে অন্যের নম্বর দিয়ে রেজিস্টার করে তার অর্ডার হিস্টোরি দেখা যেত।
    const orders = await Order.find({ customerId: req.customer.id })
      .select('orderNo items.title items.qty items.image total status payment.status codDue courier createdAt')
      .sort({ createdAt: -1 }).limit(50).lean();
    res.json(orders);
  } catch (e) { next(e); }
});

module.exports = router;
