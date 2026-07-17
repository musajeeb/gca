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

/** ফুল বিল PDF (ইংরেজি লেআউট — PDF-এ বাংলা ফন্ট এমবেড করা নেই বলে labels English) */
function buildInvoicePdf(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 46 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const Tk = (n) => 'Tk ' + Number(n || 0).toLocaleString('en-US');

    doc.fontSize(20).font('Helvetica-Bold').text(process.env.SITE_NAME || 'NetBazar');
    doc.fontSize(9).font('Helvetica').fillColor('#555')
      .text('Invoice / Order Receipt', { continued: false });
    doc.moveDown(0.8);
    doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text(`Invoice: ${order.orderNo}`);
    doc.font('Helvetica').fontSize(10)
      .text(`Date: ${new Date(order.createdAt || Date.now()).toLocaleString('en-GB')}`)
      .text(`Customer: ${order.customer.name}`)
      .text(`Phone: ${order.customer.phone}`)
      .text(`Address: ${order.customer.address}`)
      .text(`Payment: ${order.paymentMethod} (${order.payment.status})${order.payment.trxID ? ' TrxID: ' + order.payment.trxID : ''}`);
    doc.moveDown(0.8);

    // টেবিল
    const x = doc.page.margins.left, w = doc.page.width - x * 2;
    const col = { item: x, qty: x + w - 150, price: x + w - 110, total: x + w - 55 };
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('ITEM', col.item, doc.y, { width: col.qty - col.item - 8 });
    const headY = doc.y - 11;
    doc.text('QTY', col.qty, headY).text('PRICE', col.price, headY).text('TOTAL', col.total, headY);
    doc.moveTo(x, doc.y + 3).lineTo(x + w, doc.y + 3).strokeColor('#999').stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(9);
    for (const it of order.items) {
      const y = doc.y;
      const nm = `${it.title}${it.variantName && it.variantName !== 'Default' ? ` (${it.variantName})` : ''} [${it.sku}]`;
      doc.text(nm, col.item, y, { width: col.qty - col.item - 8 });
      const rowY = y;
      doc.text(String(it.qty), col.qty, rowY).text(Tk(it.price), col.price, rowY).text(Tk(it.price * it.qty), col.total, rowY);
      doc.moveDown(0.35);
    }
    doc.moveTo(x, doc.y + 2).lineTo(x + w, doc.y + 2).strokeColor('#999').stroke();
    doc.moveDown(0.5);
    const right = (label, val, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9);
      const y = doc.y;
      doc.text(label, col.price - 60, y, { width: 105, align: 'right' });
      doc.text(val, col.total, y);
      doc.moveDown(0.25);
    };
    right('Subtotal', Tk(order.subtotal));
    if (order.discount) right('Discount', '-' + Tk(order.discount));
    right('Delivery', Tk(order.deliveryFee));
    right('TOTAL', Tk(order.total), true);
    if (order.payment.amountPaid) right('Paid', Tk(order.payment.amountPaid));
    if (order.codDue > 0) right('Due on delivery', Tk(order.codDue), true);

    doc.moveDown(1.2);
    doc.font('Helvetica').fontSize(8).fillColor('#777')
      .text(`Track your order: ${process.env.SITE_URL || ''}/track.html  (Order No + Phone)`, x);
    doc.end();
  });
}

let transporter = null;
function getTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_APP_PASSWORD.replace(/\s/g, '') },
    });
  }
  return transporter;
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

module.exports = { sendMail, sendTestMail, sendOtpMail, notifyNewOrder, notifyPaid };
