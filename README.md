# NetBazar — নেটওয়ার্কিং ডিভাইস ইকমার্স

Production-ready ফুল-স্ট্যাক ইকমার্স: raw HTML/CSS/JS স্টোরফ্রন্ট + Express/MongoDB ব্যাকএন্ড + অ্যাডমিন প্যানেল + **Claude Sonnet 5 AI এজেন্ট** (বাংলা description + FAQ) + **bKash Tokenized Checkout**।

## ফিচার
- 🛍️ স্টোরফ্রন্ট: হোম, কালেকশন, প্রোডাক্ট (ভ্যারিয়েন্ট/SKU), কার্ট, চেকআউট, অর্ডার ট্র্যাকিং, ব্লগ, CMS পেজ — সম্পূর্ণ বাংলা, মোবাইল-ফার্স্ট
- 💳 bKash: ফুল পেমেন্ট **অথবা** COD (৳২০০ অগ্রিম বিকাশে, বাকি ডেলিভারিতে) — সব verification সার্ভার-সাইডে
- 🤖 AI এজেন্ট: সাপ্লায়ার URL বা ছবি দিলে Sonnet 5 বাংলা description, spec টেবিল আর ৬-১০টা FAQ লিখে ফর্মে বসিয়ে দেয়
- 📊 অ্যাডমিন: ড্যাশবোর্ড (সেলস/লো-স্টক), প্রোডাক্ট CRUD, অর্ডার ম্যানেজমেন্ট (স্ট্যাটাস পাইপলাইন, কুরিয়ার ট্র্যাকিং, স্টক অটো-রিস্টোর), কালেকশন, কুপন, ব্লগ, পেজ, সেটিংস
- 🔒 সিকিউরিটি: helmet+CSP (কোনো inline script নেই), rate limiting (login/AI/checkout আলাদা), zod validation, NoSQL injection sanitize, JWT+bcrypt(12), HTML whitelist sanitizer (AI আউটপুটসহ), SSRF-blocked scraper, honeypot, IDOR-safe ট্র্যাকিং, atomic stock অপারেশন, amount-tampering চেক

## দ্রুত শুরু

```bash
# 1. কনফিগার করুন
cp .env.example .env
nano .env        # MongoDB URI, JWT_SECRET, admin, Anthropic key, bKash credentials

# 2. ইনস্টল ও চালু
npm install
npm start        # http://localhost:3000  |  অ্যাডমিন: http://localhost:3000/admin

# (ঐচ্ছিক) স্যাম্পল ডাটা
npm run seed
```

প্রথম রানেই `.env` এর `ADMIN_EMAIL`/`ADMIN_PASSWORD` দিয়ে অ্যাডমিন অটো তৈরি হবে।

## .env — গুরুত্বপূর্ণ ভ্যারিয়েবল

| ভ্যারিয়েবল | কাজ |
|---|---|
| `MONGODB_URI` | লোকাল বা Atlas connection string |
| `JWT_SECRET` | `openssl rand -hex 32` দিয়ে জেনারেট করুন |
| `ANTHROPIC_API_KEY` | platform.claude.com থেকে (নতুন অ্যাকাউন্টে $5 ফ্রি) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` (ডিফল্ট) |
| `BKASH_BASE_URL` | Sandbox: `https://tokenized.sandbox.bka.sh/v1.2.0-beta` → লাইভে: `https://tokenized.pay.bka.sh/v1.2.0-beta` |
| `SITE_URL` | লাইভে আসল ডোমেইন দিন (bKash callback এটায় ফেরে) |
| `COD_ADVANCE_AMOUNT` | COD অগ্রিম (ডিফল্ট ২০০) |

## bKash sandbox → production
1. Sandbox credentials দিয়ে টেস্ট করুন (bKash মার্চেন্ট পোর্টাল থেকে পাবেন)
2. লাইভে যাওয়ার সময় `.env` এ শুধু ৪টা credential + `BKASH_BASE_URL` বদলান — কোডে কিছু না
3. `SITE_URL` অবশ্যই https সহ আসল ডোমেইন হতে হবে

## ডিপ্লয়মেন্ট নোট
- **VPS (সাজেস্টেড):** Ubuntu + Node 18+ + MongoDB (বা Atlas free tier) + nginx reverse proxy + `pm2 start server.js`
- nginx-এ `client_max_body_size 10m;` দিন (ছবি + AI ইমেজ পেলোডের জন্য)
- HTTPS বাধ্যতামূলক (certbot) — bKash production callback https চায়
- `uploads/` ফোল্ডার ব্যাকআপে রাখুন

## AI এজেন্ট ব্যবহার
অ্যাডমিন → প্রোডাক্ট → নতুন প্রোডাক্ট → উপরের বেগুনি "AI দিয়ে লেখান" বক্সে:
- সাপ্লায়ার/অফিশিয়াল পেজের **URL** দিন (সবচেয়ে ভালো ফলাফল), এবং/অথবা
- প্রোডাক্টের **ছবি** (বক্স/স্পেক লেবেল) আপলোড করুন
- Generate চাপুন → description, spec, FAQ, SEO সব ফর্মে বসে যাবে → রিভিউ করে সেভ

খরচ: প্রতি প্রোডাক্টে আনুমানিক ৳৩-৪ (Sonnet 5 intro pricing, Aug 2026 পর্যন্ত $2/$10 per MTok)।

## স্ট্রাকচার
```
server.js                 # entry — security middleware, routes, static
src/
  config/                 # DB connect, admin seed
  models/index.js         # Admin, Product(variants), Order, Coupon, Blog, Page, Settings
  middleware/index.js     # JWT, zod validate, sanitizer, upload, rate limits
  services/bkash.js       # Tokenized Checkout (grant/create/execute/query)
  services/claude.js      # Sonnet 5 agent + SSRF-safe scraper
  routes/                 # public, admin, payment, ai
public/                   # স্টোরফ্রন্ট (raw HTML/CSS/JS)
admin/                    # অ্যাডমিন প্যানেল (raw HTML/CSS/JS)
scripts/seed.js           # স্যাম্পল ডাটা
```
