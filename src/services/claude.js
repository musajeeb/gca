/**
 * AI Product Agent — Claude Sonnet 5
 * Input: product name + (official/supplier URL এবং/অথবা ছবি)
 * Output: বাংলা description (HTML), spec table, সম্ভাব্য সব FAQ — strict JSON
 */
const Anthropic = require('@anthropic-ai/sdk');
const cheerio = require('cheerio');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

/* ---------- URL scraper (SSRF-safe) ---------- */
const BLOCKED_HOSTS = /^(localhost|127\.|0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|\[?::1)/i;

async function scrapeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('URL টা ঠিক না');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('শুধু http/https URL দেওয়া যাবে');
  if (BLOCKED_HOSTS.test(url.hostname)) throw new Error('এই URL allowed না');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  let html;
  try {
    const res = await fetch(url.href, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NetBazarBot/1.0)' },
    });
    if (!res.ok) throw new Error(`পেজ লোড হয়নি (${res.status})`);
    html = await res.text();
  } finally {
    clearTimeout(t);
  }

  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, iframe, noscript, svg').remove();
  const title = $('title').text().trim();
  // spec টেবিল আলাদা করে তুলি — এগুলোই সবচেয়ে দামি তথ্য
  let tables = '';
  $('table').each((_, el) => {
    $(el).find('tr').each((_, tr) => {
      const cells = $(tr).find('td, th').map((_, c) => $(c).text().trim()).get().filter(Boolean);
      if (cells.length) tables += cells.join(' | ') + '\n';
    });
    tables += '---\n';
  });
  const body = $('main, article, #content, .product, body').first().text().replace(/\s+/g, ' ').trim();
  const text = `PAGE TITLE: ${title}\n\nSPEC TABLES:\n${tables}\n\nPAGE TEXT:\n${body}`.slice(0, 28_000);
  return text;
}

/* ---------- Prompt ---------- */
const SYSTEM_PROMPT = `তুমি বাংলাদেশের একটা networking device (রাউটার, সুইচ, LAN equipment) ecommerce সাইটের product content বিশেষজ্ঞ।

কঠোর নিয়ম:
1. শুধুমাত্র provided source (scraped text/ছবি) থেকে spec নেবে। Source-এ নেই এমন কোনো spec, দাম, বা সংখ্যা নিজে বানাবে না। নিশ্চিত না হলে সেই spec বাদ দেবে।
2. Description লিখবে সাবলীল, বিক্রয়মুখী বাংলায় — বাংলাদেশি ক্রেতার প্রেক্ষাপটে (বাসা/অফিসের সাইজ, লোকাল ISP, বিদ্যুৎ পরিস্থিতি ইত্যাদি প্রাসঙ্গিক হলে)।
3. Technical term (WiFi 6, Mbps, MU-MIMO, PoE, Gigabit) ইংরেজিতেই থাকবে, ব্যাখ্যা বাংলায়।
4. FAQ-তে বাস্তব ক্রেতার প্রশ্ন anticipate করবে: কভারেজ, কতজন ইউজার, কোন ISP-র সাথে চলবে, সেটআপ, ওয়ারেন্টি, আগের মডেলের সাথে পার্থক্য, common সমস্যা। ৬-১০টা FAQ।
5. Description-এ HTML ব্যবহার করবে: <p>, <ul><li>, <h3>। কোনো script/style/inline attribute না।

Output: শুধুমাত্র valid JSON, কোনো markdown fence বা অতিরিক্ত টেক্সট ছাড়া। Schema:
{
  "title_bn": "প্রোডাক্টের আকর্ষণীয় টাইটেল (ব্র্যান্ড + মডেল + মূল ফিচার)",
  "short_description": "১-২ বাক্যের সারাংশ (plain text)",
  "description_html": "<p>...</p> বিস্তারিত বাংলা description",
  "specs": [{"label": "WiFi Standard", "value": "WiFi 6 (802.11ax)"}],
  "faqs": [{"q": "প্রশ্ন?", "a": "উত্তর।"}],
  "seo_title": "৬০ ক্যারেক্টারের মধ্যে",
  "seo_description": "১৫৫ ক্যারেক্টারের মধ্যে",
  "tags": ["router", "wifi-6"]
}`;

/* ---------- Main generate ---------- */
async function generateProductContent({ productName, sourceUrl, images = [], extraNotes = '' }) {
  const content = [];
  let scraped = '';

  if (sourceUrl) {
    scraped = await scrapeUrl(sourceUrl);
  }

  for (const img of images.slice(0, 4)) {
    // img = { media_type, data(base64) }
    if (!/^image\/(jpeg|png|webp|gif)$/.test(img.media_type)) continue;
    content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
  }

  content.push({
    type: 'text',
    text: [
      `Product name: ${productName || 'অজানা — source থেকে বের করো'}`,
      extraNotes ? `Seller notes: ${extraNotes}` : '',
      scraped ? `\n===== SCRAPED SOURCE (${sourceUrl}) =====\n${scraped}` : '',
      !scraped && !images.length ? 'কোনো source দেওয়া হয়নি — শুধু product name থেকে generic কিন্তু সৎ description লেখো, specific spec দাবি করবে না।' : '',
      '\nউপরের schema অনুযায়ী শুধু JSON দাও।',
    ].filter(Boolean).join('\n'),
  });

  const msg = await client.messages.create({
    model: MODEL(),
    max_tokens: 4000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  });

  const raw = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const clean = raw.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    // fallback: প্রথম { থেকে শেষ } পর্যন্ত
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('AI response parse করা যায়নি — আবার চেষ্টা করুন');
    parsed = JSON.parse(clean.slice(start, end + 1));
  }

  return {
    titleBn: String(parsed.title_bn || productName || ''),
    shortDescription: String(parsed.short_description || ''),
    descriptionHtml: String(parsed.description_html || ''),
    specs: Array.isArray(parsed.specs) ? parsed.specs.map((s) => ({ label: String(s.label || ''), value: String(s.value || '') })) : [],
    faqs: Array.isArray(parsed.faqs) ? parsed.faqs.map((f) => ({ q: String(f.q || ''), a: String(f.a || '') })) : [],
    seoTitle: String(parsed.seo_title || ''),
    seoDescription: String(parsed.seo_description || ''),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    usage: { inputTokens: msg.usage?.input_tokens, outputTokens: msg.usage?.output_tokens },
  };
}

module.exports = { generateProductContent, scrapeUrl };
