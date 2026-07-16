/**
 * পুরনো ডিস্কের ছবি MongoDB-তে ঢোকানো (এককালীন migration)
 * ব্যবহার:
 *   node scripts/import-uploads.js                 → ./uploads ফোল্ডার থেকে
 *   node scripts/import-uploads.js /path/to/old/uploads   → পুরনো ভার্সনের ফোল্ডার থেকে
 * একই নামের ছবি আগে থেকে DB-তে থাকলে স্কিপ হয়।
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Image } = require('../src/models');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

(async () => {
  const dir = process.argv[2] || path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(dir)) {
    console.error(`❌ ফোল্ডার পাওয়া যায়নি: ${dir}`);
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);

  const files = fs.readdirSync(dir).filter((f) => MIME[path.extname(f).toLowerCase()]);
  console.log(`${files.length}টা ছবি পাওয়া গেছে: ${dir}`);
  let added = 0, skipped = 0;
  for (const f of files) {
    if (await Image.findOne({ name: f }).select('_id').lean()) { skipped++; continue; }
    const data = fs.readFileSync(path.join(dir, f));
    await Image.create({ name: f, mime: MIME[path.extname(f).toLowerCase()], data, size: data.length });
    added++;
    process.stdout.write(`\r✅ ${added} ঢুকেছে…`);
  }
  console.log(`\nশেষ — ${added}টা নতুন, ${skipped}টা আগেই ছিল। এখন প্রোডাক্টের ছবিগুলো আবার দেখাবে।`);
  await mongoose.disconnect();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
