/**
 * Mailer — Gmail SMTP (App Password)
 * Google-র নতুন নিয়ম: সাধারণ পাসওয়ার্ড SMTP-তে আর চলে না।
 * 2-Step Verification অন করে App Password (১৬ ক্যারেক্টার) বানিয়ে .env-এ দিন:
 *   SMTP_USER=yourshop@gmail.com
 *   SMTP_APP_PASSWORD=abcdabcdabcdabcd   (স্পেস ছাড়া)
 *   MAIL_ADMIN_TO=owner@gmail.com        (ঐচ্ছিক — না দিলে SMTP_USER-এই যাবে)
 * মেইল পাঠানো fire-and-forget — ব্যর্থ হলে অর্ডার আটকায় না, শুধু লগ হয়।
 */
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

/** ফুল বিল PDF — লম্বা প্রোডাক্ট নামে wrap হয়, লাইন কখনো টেক্সটের উপর পড়ে না */
function buildInvoicePdf(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const Tk = (n) => 'Tk ' + Number(n || 0).toLocaleString('en-US');
    const L = doc.page.margins.left;
    const W = doc.page.width - L * 2; // usable width
    const siteUrl = process.env.SITE_URL && !/localhost/.test(process.env.SITE_URL)
      ? process.env.SITE_URL : 'https://gca.com.bd';

    // ---- header band ----
    doc.rect(0, 0, doc.page.width, 86).fill('#0e4da4');
    doc.fill('#ffffff').font('Helvetica-Bold').fontSize(22).text(process.env.SITE_NAME || 'Global Computer Accessories', L, 26);
    doc.font('Helvetica').fontSize(10).text('Invoice / Order Receipt', L, 54);
    doc.font('Helvetica-Bold').fontSize(14).text(order.orderNo, L, 26, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(9).text(new Date(order.createdAt || Date.now()).toLocaleString('en-GB'), L, 46, { width: W, align: 'right' });
    doc.fill('#000');

    // ---- customer block ----
    let y = 104;
    doc.font('Helvetica-Bold').fontSize(10).text('BILL TO', L, y);
    doc.font('Helvetica').fontSize(10)
      .text(order.customer.name, L, y + 14)
      .text(order.customer.phone, L, y + 28)
      .text(order.customer.address, L, y + 42, { width: W * 0.55 });
    doc.font('Helvetica-Bold').fontSize(10).text('PAYMENT', L + W * 0.62, y);
    doc.font('Helvetica').fontSize(10)
      .text(`Method: ${order.paymentMethod}`, L + W * 0.62, y + 14)
      .text(`Status: ${order.payment.status}`, L + W * 0.62, y + 28)
      .text(order.payment.trxID ? `TrxID: ${order.payment.trxID}` : '', L + W * 0.62, y + 42);
    y = Math.max(doc.y, y + 60) + 14;

    // ---- items table ----
    const cQty = L + W - 170, cPrice = L + W - 125, cTotal = L + W - 62;
    const nameW = cQty - L - 10;
    doc.rect(L, y, W, 20).fill('#eef2f7');
    doc.fill('#334').font('Helvetica-Bold').fontSize(9);
    doc.text('ITEM', L + 6, y + 6, { width: nameW });
    doc.text('QTY', cQty, y + 6);
    doc.text('PRICE', cPrice, y + 6);
    doc.text('TOTAL', cTotal, y + 6);
    y += 26;
    doc.fill('#000').font('Helvetica').fontSize(9);
    for (const it of order.items) {
      const nm = `${it.title}${it.variantName && it.variantName !== 'Default' ? ` (${it.variantName})` : ''}  [${it.sku}]`;
      const nameH = doc.heightOfString(nm, { width: nameW }); // নাম কত লাইন নেবে আগে মাপি
      const rowH = Math.max(nameH, 12) + 8;
      if (y + rowH > doc.page.height - 160) { doc.addPage(); y = doc.page.margins.top; }
      doc.text(nm, L + 6, y, { width: nameW });
      doc.text(String(it.qty), cQty, y);
      doc.text(Tk(it.price), cPrice, y);
      doc.text(Tk(it.price * it.qty), cTotal, y);
      y += rowH;
      doc.moveTo(L, y - 4).lineTo(L + W, y - 4).strokeColor('#e5eaf1').lineWidth(0.7).stroke(); // লাইন সবসময় টেক্সটের নিচে
    }

    // ---- totals (ডান পাশে বক্স) ----
    y += 6;
    const totW = 220, totX = L + W - totW;
    const row = (label, val, bold = false, color = '#000') => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(color);
      doc.text(label, totX, y, { width: totW - 80 });
      doc.text(val, totX + totW - 78, y, { width: 78, align: 'right' });
      y += bold ? 18 : 14;
    };
    row('Subtotal', Tk(order.subtotal));
    if (order.discount) row('Discount', '-' + Tk(order.discount));
    row('Delivery', Tk(order.deliveryFee));
    doc.moveTo(totX, y).lineTo(L + W, y).strokeColor('#334').lineWidth(1).stroke();
    y += 6;
    row('TOTAL', Tk(order.total), true);
    if (order.payment.amountPaid) row('Paid', Tk(order.payment.amountPaid), false, '#17a34a');
    if (order.codDue > 0) row('Due on delivery', Tk(order.codDue), true, '#b45309');

    // ---- footer ----
    doc.fillColor('#667').font('Helvetica').fontSize(8.5)
      .text(`Track your order: ${siteUrl}/track.html  (Order No + Phone)`, L, doc.page.height - 70, { width: W })
      .text('Thank you for shopping with us!', L, doc.page.height - 56, { width: W });
    doc.end();
  });
}

async function sendMail({ to, subject, html, attachments }) {
  const t = getTransporter();
  if (!t || !to) return false;
  try {
    await t.sendMail({
      from: `"${process.env.SITE_NAME || 'NetBazar'}" <${process.env.SMTP_USER}>`,
      to, subject, html, attachments,
    });
    return true;
  } catch (e) {
    console.error('✉️ মেইল পাঠানো যায়নি:', e.message);
    return false;
  }
}

/* ---------- templates ---------- */
const bd = (n) => '৳' + Number(n || 0).toLocaleString('bn-BD');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function orderTable(o) {
  return `
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr style="background:#f2f5f9"><th style="padding:8px;text-align:left">আইটেম</th><th style="padding:8px">Qty</th><th style="padding:8px;text-align:right">মোট</th></tr>
    ${o.items.map((i) => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${esc(i.title)}${i.variantName && i.variantName !== 'Default' ? ` (${esc(i.variantName)})` : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.qty}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${bd(i.price * i.qty)}</td></tr>`).join('')}
    <tr><td colspan="2" style="padding:8px;text-align:right">সাবটোটাল</td><td style="padding:8px;text-align:right">${bd(o.subtotal)}</td></tr>
    ${o.discount ? `<tr><td colspan="2" style="padding:8px;text-align:right">ডিসকাউন্ট</td><td style="padding:8px;text-align:right">−${bd(o.discount)}</td></tr>` : ''}
    <tr><td colspan="2" style="padding:8px;text-align:right">ডেলিভারি</td><td style="padding:8px;text-align:right">${bd(o.deliveryFee)}</td></tr>
    <tr style="font-weight:bold;font-size:16px"><td colspan="2" style="padding:8px;text-align:right">মোট</td><td style="padding:8px;text-align:right">${bd(o.total)}</td></tr>
    ${o.codDue > 0 ? `<tr style="color:#b45309"><td colspan="2" style="padding:8px;text-align:right">ডেলিভারিতে দিতে হবে</td><td style="padding:8px;text-align:right"><strong>${bd(o.codDue)}</strong></td></tr>` : ''}
  </table>`;
}

function wrap(title, inner) {
  return `<div style="font-family:sans-serif;max-width:560px;margin:auto;border:1px solid #dde5ee;border-radius:12px;overflow:hidden">
    <div style="background:#0e4da4;color:#fff;padding:16px 22px;font-size:18px;font-weight:bold">${esc(process.env.SITE_NAME || 'NetBazar')}</div>
    <div style="padding:22px"><h2 style="margin:0 0 12px;font-size:18px">${title}</h2>${inner}</div>
    <div style="background:#f2f5f9;padding:12px 22px;font-size:12px;color:#667">এই মেইলটা স্বয়ংক্রিয়ভাবে পাঠানো।</div>
  </div>`;
}

/** নতুন অর্ডার: অ্যাডমিন + কাস্টমার (চেকআউটের ইমেইলে, ফুল বিল PDF-সহ) */
async function notifyNewOrder(o) {
  let pdf = null;
  try { pdf = await buildInvoicePdf(o); } catch (e) { console.error('PDF তৈরি ব্যর্থ:', e.message); }
  const attachments = pdf ? [{ filename: `invoice-${o.orderNo}.pdf`, content: pdf }] : undefined;
  if (o.customer.email) {
    sendMail({
      to: o.customer.email,
      subject: `আপনার অর্ডার ${o.orderNo} আমরা পেয়েছি ✓`,
      html: wrap('অর্ডার কনফার্মড — ধন্যবাদ!', `
        <p>প্রিয় ${esc(o.customer.name)},</p>
        <p>আপনার অর্ডার <strong>${esc(o.orderNo)}</strong> আমরা পেয়েছি। ফুল বিল PDF সংযুক্ত।</p>
        ${orderTable(o)}
        <p>ট্র্যাক করুন (অর্ডার নম্বর + ফোন): <a href="${process.env.SITE_URL}/track.html">${process.env.SITE_URL}/track.html</a></p>`),
      attachments,
    });
  }
  const adminTo = process.env.MAIL_ADMIN_TO || process.env.SMTP_USER;
  sendMail({
    attachments,
    to: adminTo,
    subject: `🛒 নতুন অর্ডার ${o.orderNo} — ${bd(o.total)} (${o.customer.name})`,
    html: wrap(`নতুন অর্ডার: ${esc(o.orderNo)}`, `
      <p><strong>${esc(o.customer.name)}</strong> · ${esc(o.customer.phone)}${o.customer.email ? ` · ${esc(o.customer.email)}` : ''}<br>
      ${esc(o.customer.address)} (${o.customer.area === 'inside_dhaka' ? 'ঢাকার ভেতরে' : 'ঢাকার বাইরে'})</p>
      <p>পেমেন্ট: ${o.paymentMethod === 'cod_advance' ? `COD — অগ্রিম ${bd(o.advanceDue)}` : 'ফুল পেমেন্ট'} · স্ট্যাটাস: ${esc(o.payment.status)}</p>
      ${orderTable(o)}
      <p style="margin-top:14px"><a href="${process.env.SITE_URL}/admin" style="background:#0e4da4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">অ্যাডমিনে দেখুন</a></p>`),
  });
}

/** পেমেন্ট কনফার্ম হলে — অ্যাডমিন + কাস্টমার (ইমেইল দিয়ে থাকলে) */
async function notifyPaid(o) {
  let pdf = null;
  try { pdf = await buildInvoicePdf(o); } catch (e) { console.error('PDF তৈরি ব্যর্থ:', e.message); }
  const attachments = pdf ? [{ filename: `invoice-${o.orderNo}.pdf`, content: pdf }] : undefined;
  const adminTo = process.env.MAIL_ADMIN_TO || process.env.SMTP_USER;
  sendMail({
    attachments,
    to: adminTo,
    subject: `✅ পেমেন্ট পেইড — ${o.orderNo} (${bd(o.payment.amountPaid)})`,
    html: wrap(`পেমেন্ট কনফার্মড: ${esc(o.orderNo)}`, `
      <p>${esc(o.customer.name)} · ${esc(o.customer.phone)}<br>
      TrxID: <strong>${esc(o.payment.trxID || '—')}</strong> · গেটওয়ে: ${esc(o.payment.gateway || 'bkash')}</p>
      ${orderTable(o)}`),
  });
  if (o.customer.email) {
    sendMail({
      attachments,
      to: o.customer.email,
      subject: `আপনার অর্ডার ${o.orderNo} কনফার্ম হয়েছে ✓`,
      html: wrap('অর্ডার কনফার্মড — ধন্যবাদ!', `
        <p>প্রিয় ${esc(o.customer.name)},</p>
        <p>আপনার অর্ডার <strong>${esc(o.orderNo)}</strong> আমরা পেয়েছি এবং পেমেন্ট কনফার্ম হয়েছে${o.payment.trxID ? ` (TrxID: ${esc(o.payment.trxID)})` : ''}। প্রসেসিং শুরু হয়ে গেছে।</p>
        ${orderTable(o)}
        <p>অর্ডার ট্র্যাক করতে অর্ডার নম্বর আর ফোন নম্বর দিয়ে:
        <a href="${process.env.SITE_URL}/track.html">${process.env.SITE_URL}/track.html</a></p>`),
    });
  }
}

/** রেজিস্ট্রেশন OTP — ব্যর্থ হলে throw করে, যেন user জানে মেইল যায়নি */
async function sendOtpMail(email, name, code) {
  const t = getTransporter();
  if (!t) throw new Error('ইমেইল সিস্টেম কনফিগার করা নেই — কিছুক্ষণ পরে চেষ্টা করুন বা আমাদের সাথে যোগাযোগ করুন');
  await t.sendMail({
    from: `"${process.env.SITE_NAME || 'NetBazar'}" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `আপনার ভেরিফিকেশন কোড: ${code}`,
    html: wrap('ইমেইল ভেরিফিকেশন', `
      <p>প্রিয় ${esc(name)},</p>
      <p>আপনার অ্যাকাউন্ট চালু করতে এই কোডটা দিন:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f2f5f9;border-radius:10px;padding:14px;text-align:center">${code}</p>
      <p style="color:#667;font-size:13px">কোডটা ১০ মিনিট কার্যকর। আপনি রেজিস্টার না করে থাকলে মেইলটা উপেক্ষা করুন।</p>`),
  });
}

/** টেস্ট মেইল — কনফিগ ঠিক আছে কিনা admin থেকে যাচাই (এরর হলে আসল কারণ ফেরত দেয়) */
async function sendTestMail() {
  if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) {
    throw new Error('.env-এ SMTP_USER আর SMTP_APP_PASSWORD সেট করুন (Gmail App Password লাগবে, সাধারণ পাসওয়ার্ড না)');
  }
  const to = process.env.MAIL_ADMIN_TO || process.env.SMTP_USER;
  const t = getTransporter();
  await t.sendMail({
    from: `"${process.env.SITE_NAME || 'NetBazar'}" <${process.env.SMTP_USER}>`,
    to,
    subject: '✅ NetBazar টেস্ট মেইল — কনফিগ ঠিক আছে',
    html: wrap('টেস্ট সফল!', '<p>এই মেইলটা পেয়েছেন মানে ইমেইল নোটিফিকেশন কাজ করছে। এখন থেকে প্রতিটা অর্ডারে মেইল পাবেন।</p>'),
  });
  return to;
}

/** অর্ডার স্ট্যাটাস বদলালে কাস্টমারকে (ইমেইল থাকলে) */
const STATUS_BN = { confirmed: 'কনফার্মড ✅', processing: 'প্রসেসিং শুরু হয়েছে 📦', shipped: 'কুরিয়ারে দেওয়া হয়েছে 🚚', delivered: 'ডেলিভার্ড 🎉', cancelled: 'বাতিল হয়েছে ❌', returned: 'রিটার্ন প্রসেস হয়েছে ↩️' };
function notifyStatusChange(o, status) {
  if (!o.customer.email || !STATUS_BN[status]) return;
  sendMail({
    to: o.customer.email,
    subject: `অর্ডার ${o.orderNo}: ${STATUS_BN[status]}`,
    html: wrap(`আপডেট: ${STATUS_BN[status]}`, `
      <p>প্রিয় ${esc(o.customer.name)},</p>
      <p>আপনার অর্ডার <strong>${esc(o.orderNo)}</strong>-এর স্ট্যাটাস এখন: <strong>${STATUS_BN[status]}</strong></p>
      ${status === 'shipped' && o.courier?.trackingId ? `<p>কুরিয়ার: ${esc(o.courier.name || 'Steadfast')} · ট্র্যাকিং: <strong>${esc(o.courier.trackingId)}</strong></p>` : ''}
      ${status === 'delivered' && o.codDue > 0 ? `<p>ডেলিভারিতে পরিশোধ: ${bd(o.total)}</p>` : ''}
      <p>বিস্তারিত: <a href="${process.env.SITE_URL}/track.html">অর্ডার ট্র্যাক করুন</a> (অর্ডার নম্বর + ফোন)</p>`),
  });
}

module.exports = { sendMail, sendTestMail, sendOtpMail, notifyNewOrder, notifyPaid, notifyStatusChange };
