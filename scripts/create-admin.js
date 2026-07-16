/**
 * নিরাপদভাবে অ্যাডমিন তৈরি/পাসওয়ার্ড রিসেট (bcrypt hash সরাসরি DB-তে)
 * ব্যবহার:
 *   node scripts/create-admin.js admin@shop.com 'নতুনপাসওয়ার্ড' "নাম (ঐচ্ছিক)"
 * একই ইমেইল থাকলে পাসওয়ার্ড রিসেট হবে।
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Admin } = require('../src/models');

(async () => {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password) {
    console.log('ব্যবহার: node scripts/create-admin.js <email> <password> [name]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('❌ পাসওয়ার্ড কমপক্ষে ৮ ক্যারেক্টার দিন');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const hash = await bcrypt.hash(password, 12);
  const existing = await Admin.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    existing.password = hash;
    if (name) existing.name = name;
    await existing.save();
    console.log(`✅ পাসওয়ার্ড রিসেট হয়েছে: ${existing.email}`);
  } else {
    await Admin.create({ email: email.toLowerCase().trim(), password: hash, name: name || 'Admin', role: 'super' });
    console.log(`✅ নতুন অ্যাডমিন তৈরি: ${email}`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
