/**
 * Intelligent fuzzy search — typo-tolerant, Bengali+English
 * Levenshtein distance + prefix bonus + trigram overlap, in-memory index (60s cache)
 * শপ-সাইজ ক্যাটালগে (হাজার খানেক প্রোডাক্ট) instant।
 */
const { Product } = require('../models');

let cache = { at: 0, docs: [] };

async function getIndex() {
  if (Date.now() - cache.at < 60_000 && cache.docs.length) return cache.docs;
  const docs = await Product.find({ status: 'active' })
    .select('title slug brand model tags images variants.price variants.comparePrice variants.stock shortDescription')
    .limit(3000)
    .lean();
  cache = {
    at: Date.now(),
    docs: docs.map((p) => ({
      p,
      tokens: tokenize([p.title, p.brand, p.model, ...(p.tags || [])].join(' ')),
      full: norm([p.title, p.brand, p.model].join(' ')),
    })),
  };
  return cache.docs;
}
function invalidate() { cache.at = 0; }

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const tokenize = (s) => [...new Set(norm(s).split(' ').filter((t) => t.length > 1))];

/* Levenshtein — early-exit banded */
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function trigrams(s) {
  const t = new Set();
  const x = `  ${s} `;
  for (let i = 0; i < x.length - 2; i++) t.add(x.slice(i, i + 3));
  return t;
}
function trigramSim(a, b) {
  const ta = trigrams(a), tb = trigrams(b);
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter++;
  return inter / Math.max(ta.size, tb.size, 1);
}

/* এক query token বনাম এক product token স্কোর (0-1) */
function tokenScore(q, t) {
  if (t === q) return 1;
  if (t.startsWith(q)) return 0.92;               // লাইভ টাইপিং prefix
  if (t.includes(q) && q.length >= 3) return 0.8;
  const maxLen = Math.max(q.length, t.length);
  const d = lev(q, t);
  const levSim = 1 - d / maxLen;                  // typo tolerance
  if (levSim >= 0.65) return levSim * 0.85;
  if (q.length >= 4) {
    const tg = trigramSim(q, t);
    if (tg >= 0.35) return tg * 0.7;
  }
  return 0;
}

function scoreDoc(qTokens, doc) {
  let sum = 0;
  for (const q of qTokens) {
    let best = 0;
    for (const t of doc.tokens) {
      const s = tokenScore(q, t);
      if (s > best) best = s;
      if (best === 1) break;
    }
    if (best === 0 && doc.full.includes(q)) best = 0.6; // যুক্ত লেখা (ax23 → archerax23)
    sum += best;
  }
  const coverage = sum / qTokens.length;
  return coverage;
}

async function search(query, limit = 8) {
  const qTokens = tokenize(query).slice(0, 6);
  if (!qTokens.length) return [];
  const idx = await getIndex();
  const scored = [];
  for (const doc of idx) {
    const s = scoreDoc(qTokens, doc);
    if (s >= 0.45) scored.push({ s, p: doc.p });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.p);
}

module.exports = { search, invalidate };
