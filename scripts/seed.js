/* স্যাম্পল ডাটা — টেস্টের জন্য। চালান: npm run seed */
require('dotenv').config();
const mongoose = require('mongoose');
const { Collection, Product, Coupon, Page } = require('../src/models');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected — seeding…');

  const routers = await Collection.findOneAndUpdate(
    { slug: 'wifi-router' },
    { name: 'WiFi রাউটার', slug: 'wifi-router', sortOrder: 1, active: true },
    { upsert: true, new: true }
  );
  const switches = await Collection.findOneAndUpdate(
    { slug: 'switch' },
    { name: 'নেটওয়ার্ক সুইচ', slug: 'switch', sortOrder: 2, active: true },
    { upsert: true, new: true }
  );
  await Collection.findOneAndUpdate(
    { slug: 'cable' },
    { name: 'LAN ক্যাবল', slug: 'cable', sortOrder: 3, active: true },
    { upsert: true, new: true }
  );

  await Product.findOneAndUpdate(
    { slug: 'tp-link-archer-ax23' },
    {
      title: 'TP-Link Archer AX23 AX1800 Dual-Band WiFi 6 Router',
      slug: 'tp-link-archer-ax23',
      brand: 'TP-Link',
      model: 'Archer AX23',
      shortDescription: 'WiFi 6 প্রযুক্তির সাশ্রয়ী ডুয়াল-ব্যান্ড রাউটার — মাঝারি বাসা বা অফিসের জন্য।',
      description:
        '<p>TP-Link Archer AX23 একটি WiFi 6 (802.11ax) ডুয়াল-ব্যান্ড রাউটার যা 5GHz ব্যান্ডে 1201 Mbps এবং 2.4GHz ব্যান্ডে 574 Mbps পর্যন্ত স্পিড দেয়।</p><ul><li>4টি এক্সটার্নাল অ্যান্টেনা ও Beamforming — বাসার প্রতিটা কোণে সিগনাল</li><li>MU-MIMO ও OFDMA — একসাথে অনেক ডিভাইসে স্মুথ পারফরম্যান্স</li><li>Tether অ্যাপ দিয়ে ৫ মিনিটে সেটআপ</li></ul>',
      specs: [
        { label: 'WiFi Standard', value: 'WiFi 6 (802.11ax)' },
        { label: 'Speed', value: 'AX1800 (1201 + 574 Mbps)' },
        { label: 'Antenna', value: '4× Fixed External' },
        { label: 'Ports', value: '1× Gigabit WAN, 4× Gigabit LAN' },
      ],
      faqs: [
        { q: 'এটা কি ৩ রুমের বাসা কভার করবে?', a: 'হ্যাঁ, ১২০০-১৫০০ বর্গফুটের বাসায় ভালো কভারেজ দেয়। দেয়াল বেশি মোটা হলে রাউটার মাঝামাঝি জায়গায় রাখুন।' },
        { q: 'লোকাল ISP-র সাথে চলবে?', a: 'হ্যাঁ, PPPoE, Dynamic IP, Static IP — সব সাপোর্ট করে। বাংলাদেশের যেকোনো ব্রডব্যান্ড লাইনে চলবে।' },
      ],
      images: [],
      collections: [routers._id],
      tags: ['router', 'wifi-6', 'tp-link'],
      variants: [{ sku: 'TPL-AX23', name: 'Default', price: 4290, comparePrice: 4800, costPrice: 3700, stock: 12, lowStockAlert: 3 }],
      warranty: '১ বছর অফিশিয়াল ওয়ারেন্টি',
      featured: true,
      status: 'active',
    },
    { upsert: true, new: true }
  );

  await Product.findOneAndUpdate(
    { slug: 'tp-link-ls1005g' },
    {
      title: 'TP-Link LS1005G 5-Port Gigabit Desktop Switch',
      slug: 'tp-link-ls1005g',
      brand: 'TP-Link',
      model: 'LS1005G',
      shortDescription: 'প্লাগ-অ্যান্ড-প্লে ৫ পোর্ট গিগাবিট সুইচ — অফিস বা বাসার নেটওয়ার্ক বাড়ানোর সহজ সমাধান।',
      description: '<p>কোনো কনফিগারেশন ছাড়াই LAN পোর্ট বাড়ান। প্রতিটা পোর্ট 10/100/1000 Mbps অটো-নেগোশিয়েশন।</p>',
      specs: [
        { label: 'Ports', value: '5× Gigabit RJ45' },
        { label: 'Switching Capacity', value: '10 Gbps' },
      ],
      faqs: [{ q: 'সেটআপ করতে কিছু জানা লাগবে?', a: 'না, ক্যাবল লাগালেই চলবে — সম্পূর্ণ প্লাগ-অ্যান্ড-প্লে।' }],
      images: [],
      collections: [switches._id],
      tags: ['switch', 'gigabit'],
      variants: [{ sku: 'TPL-LS1005G', name: 'Default', price: 1190, comparePrice: 1350, costPrice: 950, stock: 25, lowStockAlert: 5 }],
      warranty: 'লাইফটাইম ওয়ারেন্টি',
      featured: true,
      status: 'active',
    },
    { upsert: true, new: true }
  );

  await Coupon.findOneAndUpdate(
    { code: 'WELCOME5' },
    { code: 'WELCOME5', type: 'percent', value: 5, minOrder: 2000, maxDiscount: 300, usageLimit: 0, active: true },
    { upsert: true }
  );

  await Page.findOneAndUpdate(
    { slug: 'return-policy' },
    { title: 'রিটার্ন পলিসি', slug: 'return-policy', content: '<p>পণ্য হাতে পাওয়ার ৩ দিনের মধ্যে ম্যানুফ্যাকচারিং ত্রুটি থাকলে রিটার্ন/এক্সচেঞ্জ করা যাবে। বক্স, ইনটেক্ট অ্যাক্সেসরিজ ও ইনভয়েস সাথে থাকতে হবে।</p>', published: true },
    { upsert: true }
  );

  console.log('✅ Seed শেষ — ২টা প্রোডাক্ট, ৩টা কালেকশন, ১টা কুপন, ১টা পেজ');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
