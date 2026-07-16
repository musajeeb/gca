const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

/* ---------------- JWT auth (admin) ---------------- */
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'লগইন করা নেই' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'সেশন শেষ, আবার লগইন করুন' });
  }
}

function signToken(admin) {
  return jwt.sign(
    { id: admin._id.toString(), email: admin.email, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '12h', algorithm: 'HS256' }
  );
}

/* ---------------- Phone & address validation (BD) ---------------- */
// 01XXXXXXXXX (১১ ডিজিট) অথবা +8801XXXXXXXXX (+সহ ১৪ ক্যারেক্টার)
const PHONE_RE = /^(?:\+8801[3-9]\d{8}|01[3-9]\d{8})$/;
const normalizePhone = (s) => String(s || '').trim().replace(/^\+88/, '');
// ঠিকানা: ইংরেজি অক্ষর, সংখ্যা, স্পেস + শুধু , ; : অনুমোদিত
const ADDRESS_RE = /^[A-Za-z0-9\s,;:]+$/;

/* ---------------- Customer auth ---------------- */
function signCustomerToken(c) {
  return jwt.sign({ id: c._id.toString(), phone: c.phone, kind: 'customer' },
    process.env.JWT_SECRET, { expiresIn: '30d', algorithm: 'HS256' });
}
function requireCustomer(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'লগইন করা নেই' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.kind !== 'customer') return res.status(401).json({ error: 'লগইন করা নেই' });
    req.customer = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'সেশন শেষ, আবার লগইন করুন' });
  }
}

function optionalCustomer(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (payload.kind === 'customer') req.customer = payload;
    } catch {}
  }
  next();
}

/* ---------------- Zod validation wrapper ---------------- */
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    return res.status(422).json({ error: msg });
  }
  req.body = result.data;
  next();
};

/* ---------------- HTML sanitizer (whitelist-based, stored-XSS প্রতিরোধ) ---------------- */
const ALLOWED_TAGS = new Set(['p','br','b','strong','i','em','u','ul','ol','li','h2','h3','h4','table','thead','tbody','tr','td','th','blockquote','a','img','span','div','hr','code','pre']);
const ALLOWED_ATTRS = { a: ['href'], img: ['src', 'alt'] };

function sanitizeHtml(dirty = '') {
  if (typeof dirty !== 'string') return '';
  let out = dirty
    // strip script/style/iframe blocks entirely
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form)[^>]*>/gi, '');
  // process every remaining tag
  out = out.replace(/<\/?([a-zA-Z0-9]+)((?:\s+[^<>]*?)?)\s*\/?>/g, (m, tag, attrs) => {
    tag = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (m.startsWith('</')) return `</${tag}>`;
    let safeAttrs = '';
    const allowed = ALLOWED_ATTRS[tag] || [];
    for (const name of allowed) {
      const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
      const found = attrs.match(re);
      if (found) {
        const val = (found[2] ?? found[3] ?? '').trim();
        if (/^javascript:|^data:text/i.test(val)) continue;
        safeAttrs += ` ${name}="${val.replace(/"/g, '&quot;')}"`;
      }
    }
    if (tag === 'a') safeAttrs += ' rel="noopener noreferrer"';
    return `<${tag}${safeAttrs}>`;
  });
  return out;
}

function escapeText(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Upload (memory → MongoDB, MIME + size চেক) ---------------- */
/** আসল ফাইল-সিগনেচার চেক — client-এর দাবি করা MIME বিশ্বাস না করে বাইট দেখে যাচাই */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function makeImageName(mimetype) {
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mimetype] || '.bin';
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('শুধু JPG/PNG/WebP ছবি আপলোড করা যাবে'));
  },
});

/* ---------------- Rate limiters ---------------- */
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'অনেকবার চেষ্টা হয়েছে, ১৫ মিনিট পরে আসুন' } });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'AI রিকোয়েস্ট লিমিট — ১ মিনিট অপেক্ষা করুন' } });
const checkoutLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: { error: 'অনেক বেশি অর্ডার চেষ্টা — কিছুক্ষণ পরে আসুন' } });
// ট্র্যাকিং brute-force (sequential অর্ডার নম্বরে ফোন গেস) আটকাতে
const trackLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'অনেকবার চেষ্টা হয়েছে — কিছুক্ষণ পরে আসুন' } });
const reviewLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, message: { error: 'রিভিউ লিমিট — পরে চেষ্টা করুন' } });
const beaconLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'ok' } });

module.exports = { requireAdmin, signToken, validate, sanitizeHtml, escapeText, upload, makeImageName, sniffImage, loginLimiter, aiLimiter, checkoutLimiter, trackLimiter, reviewLimiter, beaconLimiter, PHONE_RE, ADDRESS_RE, normalizePhone, signCustomerToken, requireCustomer, optionalCustomer };
