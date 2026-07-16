require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');

const { connectDB } = require('./src/config/db');
const { seedAdmin } = require('./src/config/seedAdmin');

const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');
const paymentRoutes = require('./src/routes/payment');
const aiRoutes = require('./src/routes/ai');

const app = express();
app.set('trust proxy', 1);

// ---------- Security ----------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());
app.use(express.json({ limit: '8mb' })); // AI image payloads
app.use(express.urlencoded({ extended: false }));
app.use(mongoSanitize());

// Global rate limit (per IP)
app.use(
  '/api/',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'অনেক বেশি রিকোয়েস্ট। কিছুক্ষণ পরে চেষ্টা করুন।' },
  })
);

// ---------- Routes ----------
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/ai', aiRoutes);
app.use('/api/payment', paymentRoutes);

// ---------- Static ----------
const staticOpts = { maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0, etag: true };
// ছবি MongoDB থেকে serve হয় — redeploy-এ হারায় না। ডিস্ক static টা পুরনো ফাইলের fallback।
const { Image } = require('./src/models');
app.get('/uploads/:name', async (req, res, nextFn) => {
  try {
    const img = await Image.findOne({ name: req.params.name }).lean();
    if (!img) return nextFn();
    res.set('Content-Type', img.mime);
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    res.send(Buffer.isBuffer(img.data) ? img.data : Buffer.from(img.data.buffer));
  } catch (e) { nextFn(e); }
});
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOADS_DIR, staticOpts));
app.use('/admin', express.static(path.join(__dirname, 'admin'), staticOpts));
app.use(express.static(path.join(__dirname, 'public'), staticOpts));

// Pretty URLs for storefront pages
const page = (f) => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get('/p/:slug', page('product.html'));
app.get('/c/:slug', page('collection.html'));
app.get('/blog/:slug', page('blog-post.html'));
app.get('/page/:slug', page('page.html'));
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));

// 404 + error handler
app.use('/api/*', (req, res) => res.status(404).json({ error: 'API endpoint পাওয়া যায়নি' }));
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'সার্ভারে সমস্যা হয়েছে' : err.message });
});

// ---------- Boot ----------
(async () => {
  // ---- Production guards ----
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32 || /change-this/i.test(secret)) {
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ JWT_SECRET দুর্বল বা ডিফল্ট — production-এ চলবে না। openssl rand -hex 32 দিয়ে জেনারেট করুন');
      process.exit(1);
    } else {
      console.warn('⚠️  JWT_SECRET দুর্বল/ডিফল্ট — production-এ যাওয়ার আগে বদলান (openssl rand -hex 32)');
    }
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) {
    console.warn('⚠️  SMTP_USER/SMTP_APP_PASSWORD সেট নেই — অর্ডারের ইমেইল নোটিফিকেশন যাবে না। .env দেখুন।');
  }
  // আগে listen, পরে DB connect — Hostinger/Passenger-জাতীয় হোস্টের startup timeout
  // ("app didn't call listen") এড়াতে। DB connect হওয়ার আগ পর্যন্ত mongoose নিজেই
  // query গুলো buffer করে রাখে, তাই প্রথম কয়েক সেকেন্ডের রিকোয়েস্টও হারায় না।
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`✅ NetBazar চলছে: port ${port}  |  Admin: /admin`));
  try {
    await connectDB();
    await seedAdmin();
    console.log('✅ ডাটাবেস connected');
  } catch (e) {
    console.error('❌ ডাটাবেস connect ব্যর্থ:', e.message);
    console.error('   চেক করুন: (১) hPanel-এ MONGODB_URI ঠিক আছে কিনা (২) Atlas → Network Access → 0.0.0.0/0 allow করা কিনা');
  }
})();
