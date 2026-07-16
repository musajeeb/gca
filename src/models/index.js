const mongoose = require('mongoose');
const { Schema } = mongoose;

/* ---------------- Counter (sequential order numbers) ---------------- */
const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 1000 } });
const Counter = mongoose.model('Counter', counterSchema);

async function nextSeq(name) {
  // বাগ ফিক্স: upsert + $inc এ schema default (1000) apply হয় না — কাউন্টার ১ থেকে শুরু হয়ে যাচ্ছিল।
  // কম থাকলে আগে 1000-এ তুলে নিই (বিদ্যমান ডাটাবেসেও এক রানেই ঠিক হয়ে যায়)।
  await Counter.updateOne({ _id: name, seq: { $lt: 1000 } }, { $set: { seq: 1000 } });
  const doc = await Counter.findByIdAndUpdate(name, { $inc: { seq: 1 } }, { new: true, upsert: true });
  if (doc.seq < 1001) {
    doc.seq = 1001;
    await doc.save();
  }
  return doc.seq;
}

/* ---------------- Admin ---------------- */
const adminSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    name: { type: String, default: 'Admin' },
    role: { type: String, enum: ['super', 'staff'], default: 'staff' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
const Admin = mongoose.model('Admin', adminSchema);

/* ---------------- Collection (category) ---------------- */
const collectionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    // Smart collection (Shopify-style): rules মিললে প্রোডাক্ট অটো এই কালেকশনে দেখাবে
    smart: { type: Boolean, default: false },
    rules: {
      tags: [{ type: String }],
      brands: [{ type: String }],
    },
  },
  { timestamps: true }
);
const Collection = mongoose.model('Collection', collectionSchema);

/* ---------------- Product + Variants (SKU) ---------------- */
const variantSchema = new Schema(
  {
    sku: { type: String, required: true, trim: true },
    name: { type: String, default: 'Default' }, // e.g. "AX1800 / সাদা"
    price: { type: Number, required: true, min: 0 },
    comparePrice: { type: Number, default: 0 }, // আগের দাম (কাটা দাম দেখাতে)
    costPrice: { type: Number, default: 0, select: false }, // ক্রয়মূল্য (profit report)
    stock: { type: Number, default: 0, min: 0 },
    lowStockAlert: { type: Number, default: 3 },
    barcode: { type: String, default: '' },
  },
  { _id: true }
);

const faqSchema = new Schema({ q: String, a: String }, { _id: false });
const specSchema = new Schema({ label: String, value: String }, { _id: false });

const productSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    brand: { type: String, default: '', index: true },
    model: { type: String, default: '' },
    description: { type: String, default: '' }, // sanitized HTML (AI generated বাংলা)
    shortDescription: { type: String, default: '' },
    specs: [specSchema],
    faqs: [faqSchema],
    images: [{ type: String }],
    collections: [{ type: Schema.Types.ObjectId, ref: 'Collection', index: true }],
    tags: [{ type: String }],
    variants: { type: [variantSchema], validate: (v) => v.length > 0 },
    warranty: { type: String, default: '' },
    aplusHtml: { type: String, default: '' }, // A+ content — description-এর পরে rich সেকশন
    featured: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
    seoTitle: String,
    seoDescription: String,
    sourceUrl: String, // AI agent যেখান থেকে spec নিয়েছে
    soldCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);
productSchema.index({ title: 'text', brand: 'text', tags: 'text' });
productSchema.virtual('minPrice').get(function () {
  return Math.min(...this.variants.map((v) => v.price));
});
productSchema.set('toJSON', { virtuals: true });
const Product = mongoose.model('Product', productSchema);

/* ---------------- Order ---------------- */
const orderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    title: String,
    variantName: String,
    sku: String,
    image: String,
    price: { type: Number, required: true }, // server-verified snapshot
    costPrice: { type: Number, default: 0 }, // profit report-এর জন্য snapshot
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    orderNo: { type: String, unique: true, index: true },
    // লগইন অবস্থায় অর্ডার করলে অ্যাকাউন্টের সাথে বাঁধা হয় — হিস্টোরি শুধু এটা দিয়েই দেখানো হয়
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true, default: null },
    items: { type: [orderItemSchema], validate: (v) => v.length > 0 },
    customer: {
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true, index: true },
      email: { type: String, default: '', trim: true, lowercase: true },
      address: { type: String, required: true },
      area: { type: String, enum: ['inside_dhaka', 'outside_dhaka'], required: true },
      note: String,
    },
    subtotal: { type: Number, required: true },
    deliveryFee: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    couponCode: String,
    total: { type: Number, required: true },
    paymentMethod: { type: String, enum: ['bkash_full', 'cod_advance', 'manual'], required: true },
    advanceDue: { type: Number, required: true }, // bkash এ এখন যত দিতে হবে
    codDue: { type: Number, default: 0 }, // ডেলিভারিতে যত দেবে
    payment: {
      status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending', index: true },
      gateway: { type: String, default: 'bkash' }, // bkash | sslcommerz | aamarpay | shurjopay
      gatewayRef: String, // gateway-র নিজস্ব session/payment id
      bkashPaymentID: String,
      trxID: String,
      payerNumber: String,
      paidAt: Date,
      amountPaid: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ['awaiting_payment', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'],
      default: 'awaiting_payment',
      index: true,
    },
    statusHistory: [{ status: String, at: { type: Date, default: Date.now }, note: String }],
    courier: { name: String, trackingId: String, consignmentId: String, lastSync: Date },
    adminNote: { type: String, default: '', maxlength: 2000 }, // শুধু অ্যাডমিন দেখে
    tags: [{ type: String, index: true }],
    source: { type: String, enum: ['online', 'admin'], default: 'online' },
    stockReduced: { type: Boolean, default: false },
  },
  { timestamps: true }
);
const Order = mongoose.model('Order', orderSchema);

/* ---------------- Coupon ---------------- */
const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: ['percent', 'fixed'], required: true },
    value: { type: Number, required: true, min: 0 },
    minOrder: { type: Number, default: 0 },
    maxDiscount: { type: Number, default: 0 }, // percent এর ক্ষেত্রে cap
    usageLimit: { type: Number, default: 0 }, // 0 = unlimited
    usedCount: { type: Number, default: 0 },
    expiresAt: Date,
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
const Coupon = mongoose.model('Coupon', couponSchema);

/* ---------------- Blog & Page (CMS) ---------------- */
const blogSchema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    excerpt: String,
    content: { type: String, default: '' }, // sanitized HTML
    coverImage: String,
    tags: [String],
    published: { type: Boolean, default: false },
    publishedAt: Date,
  },
  { timestamps: true }
);
const Blog = mongoose.model('Blog', blogSchema);

const pageSchema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    content: { type: String, default: '' },
    published: { type: Boolean, default: true },
  },
  { timestamps: true }
);
const Page = mongoose.model('Page', pageSchema);

/* ---------------- Customer (ঐচ্ছিক অ্যাকাউন্ট — guest checkout-ও চলে) ---------------- */
const customerSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true, trim: true }, // normalized 01XXXXXXXXX
    name: { type: String, required: true, trim: true },
    password: { type: String, required: true, select: false },
    address: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
const Customer = mongoose.model('Customer', customerSchema);

/* ---------------- Review (verified purchase only) ---------------- */
const reviewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    orderNo: { type: String, required: true },
    phone: { type: String, required: true }, // verification-এ লাগে, publicly মাস্ক করে দেখানো হয়
    name: { type: String, required: true, trim: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '', maxlength: 2000 },
    verified: { type: Boolean, default: true },
    approved: { type: Boolean, default: true }, // admin চাইলে hide করতে পারে
  },
  { timestamps: true }
);
reviewSchema.index({ product: 1, orderNo: 1, phone: 1 }, { unique: true }); // এক অর্ডারে এক প্রোডাক্টে একটাই রিভিউ
const Review = mongoose.model('Review', reviewSchema);

/* ---------------- Daily traffic stat (conversion rate-এর জন্য) ---------------- */
const statSchema = new Schema({ date: { type: String, unique: true }, visits: { type: Number, default: 0 } });
const Stat = mongoose.model('Stat', statSchema);

/* ---------------- Image (ছবি MongoDB-তে — redeploy-এ আর হারাবে না) ---------------- */
const imageSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    mime: { type: String, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, default: 0 },
  },
  { timestamps: true }
);
const Image = mongoose.model('Image', imageSchema);

/* ---------------- Settings ---------------- */
const settingsSchema = new Schema({ key: { type: String, unique: true }, data: Schema.Types.Mixed }, { timestamps: true });
const Settings = mongoose.model('Settings', settingsSchema);

module.exports = { Admin, Collection, Product, Order, Coupon, Blog, Page, Review, Customer, Stat, Image, Settings, Counter, nextSeq };
