const bcrypt = require('bcryptjs');
const { Admin, Settings } = require('../models');

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return console.warn('⚠️ ADMIN_EMAIL/ADMIN_PASSWORD সেট নেই — admin তৈরি হয়নি');

  // শুধু প্রথম bootstrap-এ (কোনো admin না থাকলে) .env থেকে তৈরি হয়।
  // Production best practice: লগইনের পরেই Settings → পাসওয়ার্ড বদলান,
  // অথবা শুরু থেকেই `npm run create-admin` ব্যবহার করুন।
  const count = await Admin.countDocuments();
  if (count === 0) {
    const hash = await bcrypt.hash(password, 12);
    await Admin.create({ email, password: hash, name: 'Super Admin', role: 'super' });
    console.log(`✅ প্রথম Admin তৈরি: ${email}`);
    console.log('⚠️  নিরাপত্তার জন্য লগইন করে Settings থেকে পাসওয়ার্ড বদলে নিন, তারপর .env থেকে ADMIN_PASSWORD মুছে দিতে পারেন');
  }

  const settings = await Settings.findOne({ key: 'site' });
  if (!settings) {
    await Settings.create({
      key: 'site',
      data: {
        siteName: process.env.SITE_NAME || 'NetBazar',
        codAdvance: Number(process.env.COD_ADVANCE_AMOUNT || 200),
        deliveryInside: Number(process.env.DELIVERY_FEE_INSIDE_DHAKA || 70),
        deliveryOutside: Number(process.env.DELIVERY_FEE_OUTSIDE_DHAKA || 130),
        freeDeliveryThreshold: Number(process.env.FREE_DELIVERY_THRESHOLD || 0),
        phone: '', address: '', facebook: '',
      },
    });
  }
}

module.exports = { seedAdmin };
