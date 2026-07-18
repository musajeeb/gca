/* ============ NetBazar Admin ============ */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bd = (n) => '৳' + Number(n || 0).toLocaleString('bn-BD');
  const dt = (d) => new Date(d).toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' });

  const TOKEN_KEY = 'nb_admin_token';
  const getToken = () => sessionStorage.getItem(TOKEN_KEY);

  const api = async (path, opts = {}) => {
    const res = await fetch('/api/admin' + path, {
      ...opts,
      headers: {
        ...(opts.isForm ? {} : { 'Content-Type': 'application/json' }),
        ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
      },
      body: opts.isForm ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && getToken()) { sessionStorage.removeItem(TOKEN_KEY); showLogin(); throw new Error('সেশন শেষ — আবার লগইন করুন'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'সার্ভার এরর');
    return data;
  };

  const toast = (msg, err = false) => {
    const t = $('#toast');
    t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600);
  };

  const delta = (cur, prev, key = 'revenue') => {
    const c = cur?.[key] || 0, p = prev?.[key] || 0;
    if (!p && !c) return '';
    if (!p) return '<span style="color:var(--ok);font-size:.78rem;font-weight:700">নতুন ↑</span>';
    const pct = Math.round(((c - p) / p) * 100);
    const up = pct >= 0;
    return `<span style="color:${up ? 'var(--ok)' : 'var(--danger)'};font-size:.78rem;font-weight:700">${up ? '↑' : '↓'} ${Math.abs(pct)}%</span>`;
  };
  async function downloadCsv(path, filename) {
    try {
      const res = await fetch('/api/admin' + path, { headers: { Authorization: 'Bearer ' + getToken() } });
      if (!res.ok) throw new Error('এক্সপোর্ট ব্যর্থ');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { toast(e.message, true); }
  }

  function setNavBadge(view, n) {
    const btn = document.querySelector(`.sidebar nav button[data-view="${view}"]`);
    if (!btn) return;
    let b = btn.querySelector('.nav-badge');
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; btn.appendChild(b); }
    b.textContent = n > 99 ? '99+' : n;
  }

  const modal = {
    open(html) { $('#modal-body').innerHTML = html; $('#modal').hidden = false; },
    close() { $('#modal').hidden = true; $('#modal-body').innerHTML = ''; },
  };
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') modal.close(); });

  const confirmBox = (msg) => new Promise((resolve) => {
    modal.open(`<h3>নিশ্চিত?</h3><p>${esc(msg)}</p>
      <div class="modal-actions"><button class="btn btn-ghost" id="cf-no">না</button><button class="btn btn-danger" id="cf-yes">হ্যাঁ, করুন</button></div>`);
    $('#cf-no').onclick = () => { modal.close(); resolve(false); };
    $('#cf-yes').onclick = () => { modal.close(); resolve(true); };
  });

  /* ---------- rich text editor (contenteditable) ---------- */
  function richEditor(mount, initialHtml = '', { tall = false, withImage = false, placeholder = '' } = {}) {
    mount.innerHTML = `
      <div class="rte ${tall ? 'rte-tall' : ''}">
        <div class="rte-toolbar">
          <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
          <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
          <button type="button" data-cmd="underline" title="Underline"><u>U</u></button>
          <span class="sep"></span>
          <button type="button" data-block="h3" title="হেডিং">H3</button>
          <button type="button" data-block="p" title="প্যারাগ্রাফ">¶</button>
          <span class="sep"></span>
          <button type="button" data-cmd="insertUnorderedList" title="বুলেট লিস্ট">• লিস্ট</button>
          <button type="button" data-cmd="insertOrderedList" title="নম্বর লিস্ট">1. লিস্ট</button>
          <span class="sep"></span>
          <button type="button" data-link title="লিংক">🔗</button>
          ${withImage ? '<button type="button" data-img title="ছবি যোগ করুন">🖼️ ছবি</button><input type="file" accept="image/jpeg,image/png,image/webp" hidden class="rte-img-input">' : ''}
          <span class="sep"></span>
          <button type="button" data-cmd="removeFormat" title="ফরম্যাট মুছুন">✕ Tx</button>
        </div>
        <div class="rte-body" contenteditable="true" data-ph="${esc(placeholder)}"></div>
      </div>`;
    const body = mount.querySelector('.rte-body');
    body.innerHTML = initialHtml || '';
    mount.querySelector('.rte-toolbar').addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      body.focus();
      if (b.dataset.cmd) document.execCommand(b.dataset.cmd, false, null);
      else if (b.dataset.block) document.execCommand('formatBlock', false, b.dataset.block);
      else if (b.hasAttribute('data-link')) {
        const url = prompt('লিংক URL:');
        if (url) document.execCommand('createLink', false, url);
      } else if (b.hasAttribute('data-img')) {
        mount.querySelector('.rte-img-input').click();
      }
    });
    const imgInput = mount.querySelector('.rte-img-input');
    if (imgInput) imgInput.onchange = async (e) => {
      if (!e.target.files.length) return;
      const fd = new FormData();
      fd.append('images', e.target.files[0]);
      try {
        const data = await api('/upload', { method: 'POST', body: fd, isForm: true });
        body.focus();
        document.execCommand('insertHTML', false, `<img src="${esc(data.files[0])}" alt="">`);
        toast('ছবি যোগ হয়েছে ✓');
      } catch (err) { toast(err.message, true); }
      e.target.value = '';
    };
    return { get: () => body.innerHTML.trim(), set: (h) => { body.innerHTML = h || ''; } };
  }

  /* ================= AUTH ================= */
  function showLogin() { $('#login-view').hidden = false; $('#app-view').hidden = true; }
  function showApp() { $('#login-view').hidden = true; $('#app-view').hidden = false; views.dashboard(); }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-err').textContent = '';
    try {
      const data = await api('/login', { method: 'POST', body: { email: $('#l-email').value.trim(), password: $('#l-pass').value } });
      sessionStorage.setItem(TOKEN_KEY, data.token);
      showApp();
    } catch (err) { $('#login-err').textContent = err.message; }
  });
  $('#logout-btn').addEventListener('click', () => { sessionStorage.removeItem(TOKEN_KEY); showLogin(); });

  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    $$('#nav button').forEach((x) => x.classList.toggle('active', x === b));
    views[b.dataset.view]();
  });

  const main = () => $('#main');

  /* ================= DASHBOARD (Shopify-style) ================= */
  const views = {};
  const ST_LABEL = { awaiting_payment: 'পেমেন্ট বাকি', confirmed: 'কনফার্মড', processing: 'প্রসেসিং', shipped: 'কুরিয়ারে', delivered: 'ডেলিভার্ড', cancelled: 'বাতিল', returned: 'রিটার্নড' };

  function statusBars(counts) {
    const labels = { awaiting_payment: 'পেমেন্ট বাকি', confirmed: 'কনফার্মড', processing: 'প্রসেসিং', shipped: 'কুরিয়ারে', delivered: 'ডেলিভার্ড', cancelled: 'বাতিল', returned: 'রিটার্নড' };
    const colors = { awaiting_payment: '#f5a623', confirmed: '#0e4da4', processing: '#4f46e5', shipped: '#0891b2', delivered: '#17a34a', cancelled: '#dc2626', returned: '#991b1b' };
    const entries = Object.keys(labels).map((k) => [k, counts[k] || 0]);
    const max = Math.max(...entries.map(([, v]) => v), 1);
    return `<div style="display:grid;gap:8px">${entries.map(([k, v]) => `
      <div style="display:grid;grid-template-columns:110px 1fr 44px;gap:10px;align-items:center;font-size:.88rem">
        <span>${labels[k]}</span>
        <div style="background:var(--bg);border-radius:6px;height:18px;overflow:hidden"><div style="width:${(v / max) * 100}%;height:100%;background:${colors[k]};border-radius:6px;min-width:${v ? 4 : 0}px"></div></div>
        <strong style="text-align:right">${v}</strong>
      </div>`).join('')}</div>`;
  }

  function salesChart(daily, metric = 'revenue', rangeFrom, rangeTo) {
    // সিলেক্টেড রেঞ্জের প্রতিটা দিন — ডাটা না থাকলে ০ (৩ দিনের ডাটায় ৯০ দিনের রেঞ্জেও পুরো axis)
    const map = Object.fromEntries((daily || []).map((d) => [d._id, d]));
    const start = rangeFrom ? new Date(rangeFrom) : (daily.length ? new Date(daily[0]._id) : new Date());
    const end = rangeTo ? new Date(rangeTo) : (daily.length ? new Date(daily[daily.length - 1]._id) : new Date());
    let days = [];
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      const dte = new Date(t), key = dte.toISOString().slice(0, 10);
      days.push({ key, label: dte.getDate(), revenue: map[key]?.revenue || 0, orders: map[key]?.orders || 0 });
    }
    if (days.length > 92) { // বড় রেঞ্জ → সাপ্তাহিক bucket
      const weeks = [];
      for (let i = 0; i < days.length; i += 7) {
        const chunk = days.slice(i, i + 7);
        weeks.push({ key: chunk[0].key + ' সপ্তাহ', label: chunk[0].key.slice(5), revenue: chunk.reduce((a, d) => a + d.revenue, 0), orders: chunk.reduce((a, d) => a + d.orders, 0) });
      }
      days = weeks;
    }
    const max = Math.max(...days.map((d) => d[metric]), 1);
    const W = 900, H = 190, bw = W / days.length;
    const bars = days.map((d, i) => {
      const h = Math.round((d[metric] / max) * 140);
      return `<rect class="chart-bar" style="${metric === 'orders' ? 'fill:#0891b2' : ''}" x="${(i * bw + 3).toFixed(1)}" y="${160 - h}" width="${(bw - 6).toFixed(1)}" height="${Math.max(h, d[metric] ? 3 : 0)}" rx="3"><title>${d.key}: ${d.revenue} টাকা, ${d.orders} অর্ডার</title></rect>
        <text class="chart-label" x="${(i * bw + bw / 2).toFixed(1)}" y="178" text-anchor="middle">${i % Math.max(1, Math.ceil(days.length / 12)) === 0 ? d.label : ''}</text>`;
    }).join('');
    return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="৩০ দিনের সেলস চার্ট">${bars}</svg></div>`;
  }

  views.dashboard = async (from = '', to = '') => {
    main().innerHTML = '<div class="page-head"><h1 class="page-title">ড্যাশবোর্ড</h1></div><p>লোড হচ্ছে…</p>';
    try {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const s = await api('/stats' + (qs.toString() ? '?' + qs : ''));
      setNavBadge('orders', s.unreadOrders);
      const kpi = (t, r, prev) => `
        <div class="stat"><div class="l">${t} ${prev ? delta(r, prev) : ''}</div><div class="v">${bd(r.revenue)}</div>
          <div class="sub">${r.orders}টা অর্ডার · <span class="profit">লাভ ${bd(r.grossProfit)}</span></div></div>`;
      const pendingCount = (s.statusCounts.awaiting_payment || 0) + (s.statusCounts.confirmed || 0) + (s.statusCounts.processing || 0);
      const rangeLabel = `${s.rangeFrom} → ${s.rangeTo}`;
      main().innerHTML = `
        <div class="page-head"><h1 class="page-title">ড্যাশবোর্ড</h1>
          <span class="status-badge st-confirmed">অ্যাকশন দরকার: ${pendingCount} · কুরিয়ারে: ${s.statusCounts.shipped || 0}</span></div>
        <div class="stat-grid">
          ${kpi('আজ (vs গতকাল)', s.today, s.prevToday)}
          ${kpi('৭ দিন (vs আগের ৭)', s.week, s.prevWeek)}
          ${kpi('৩০ দিন (vs আগের ৩০)', s.month, s.prevMonth)}
          ${kpi('গত ৯০ দিন', s.quarter)}
          ${kpi('অল টাইম', s.all)}
        </div>
        <div class="stat-grid">
          <div class="stat"><div class="l">ভিজিট (রেঞ্জ)</div><div class="v">${s.visits}</div><div class="sub">স্টোরফ্রন্ট সেশন</div></div>
          <div class="stat"><div class="l">কনভার্সন রেট</div><div class="v">${s.conversionRate !== null ? s.conversionRate + '%' : '—'}</div><div class="sub">পেইড অর্ডার ÷ ভিজিট</div></div>
          <div class="stat"><div class="l">রিপিট কাস্টমার</div><div class="v">${s.repeatRate}%</div><div class="sub">${s.repeatCustomers}/${s.totalCustomers} কাস্টমার আবার কিনেছে</div></div>
          <div class="stat"><div class="l">রেঞ্জ সেলস ${delta(s.range, s.prevRange)}</div><div class="v">${bd(s.range.revenue)}</div><div class="sub">আগের সমান সময়ে ${bd(s.prevRange.revenue)}</div></div>
        </div>

        <div class="card">
          <div class="filter-row" style="margin-bottom:6px">
            <strong style="align-self:center">রেঞ্জ:</strong>
            <button class="btn btn-ghost btn-sm" data-range="7">৭ দিন</button>
            <button class="btn btn-ghost btn-sm" data-range="30">৩০ দিন</button>
            <button class="btn btn-ghost btn-sm" data-range="90">৯০ দিন</button>
            <button class="btn btn-ghost btn-sm" data-range="365">১ বছর</button>
            <input id="d-from" type="date" value="${from || s.rangeFrom}">
            <input id="d-to" type="date" value="${to || s.rangeTo}">
            <button class="btn btn-primary btn-sm" id="d-apply">দেখুন</button>
          </div>
          <h3>সেলস (৳) — ${rangeLabel}</h3>${salesChart(s.daily, 'revenue', s.rangeFrom, s.rangeTo)}
          <h3 style="margin-top:18px">অর্ডার সংখ্যা — ${rangeLabel}</h3>${salesChart(s.daily, 'orders', s.rangeFrom, s.rangeTo)}
        </div>

        <div class="card"><h3>অর্ডার স্ট্যাটাস ডিস্ট্রিবিউশন (সব সময়)</h3>${statusBars(s.statusCounts)}</div>

        <div class="dash-2col">
          <div class="card"><h3>কস্ট ব্রেকডাউন — ${rangeLabel}</h3><div class="table-wrap"><table>
            <tr><td>মোট সেলস (ডেলিভারিসহ)</td><td style="text-align:right"><strong>${bd(s.range.revenue)}</strong></td></tr>
            <tr><td>প্রোডাক্ট সেলস</td><td style="text-align:right">${bd(s.range.productRevenue)}</td></tr>
            <tr><td>প্রোডাক্ট খরচ (ক্রয়মূল্য)</td><td style="text-align:right">−${bd(s.range.productCost)}</td></tr>
            <tr><td><strong>গ্রস প্রফিট</strong></td><td style="text-align:right"><strong style="color:var(--ok)">${bd(s.range.grossProfit)}</strong></td></tr>
            <tr><td>ডেলিভারি চার্জ কালেক্টেড</td><td style="text-align:right">${bd(s.range.deliveryCollected)}</td></tr>
            <tr><td>ডিসকাউন্ট দেওয়া হয়েছে</td><td style="text-align:right">−${bd(s.range.discountGiven)}</td></tr>
            <tr><td>অর্ডার সংখ্যা</td><td style="text-align:right">${s.range.orders}</td></tr>
            <tr><td>গড় অর্ডার ভ্যালু</td><td style="text-align:right">${s.range.orders ? bd(Math.round(s.range.revenue / s.range.orders)) : '—'}</td></tr>
          </table></div>
          <p style="font-size:.8rem;color:var(--ink-soft);margin-top:8px">* লাভের হিসাব প্রোডাক্টে ক্রয়মূল্য দেওয়া থাকলে সঠিক হবে</p></div>

          <div class="card"><h3>টপ প্রোডাক্ট — ${rangeLabel}</h3><div class="table-wrap"><table>
            <tr><th>প্রোডাক্ট</th><th>বিক্রি</th><th>সেলস</th></tr>
            ${s.topProducts.map((t) => `<tr><td>${esc(t._id)}</td><td>${t.qty}</td><td>${bd(t.revenue)}</td></tr>`).join('') || '<tr><td colspan="3">ডাটা নেই</td></tr>'}
          </table></div>
          <h3 style="margin-top:16px">পেমেন্ট (৩০ দিন)</h3><div class="table-wrap"><table>
            ${s.paymentSplit.map((p) => `<tr><td>${p._id === 'bkash_full' ? 'bKash ফুল পেমেন্ট' : 'COD (অগ্রিমসহ)'}</td><td>${p.n}টা</td><td>${bd(p.amount)}</td></tr>`).join('') || '<tr><td>ডাটা নেই</td></tr>'}
          </table></div></div>
        </div>

        ${s.lowStock.length ? `<div class="card"><h3 style="color:var(--danger)">⚠️ লো স্টক — রিস্টক করুন</h3><div class="table-wrap"><table>
          <tr><th>প্রোডাক্ট</th><th>ভ্যারিয়েন্ট</th><th>SKU</th><th>স্টক</th></tr>
          ${s.lowStock.map((x) => `<tr><td>${esc(x.title)}</td><td>${esc(x.variants.name || '')}</td><td>${esc(x.variants.sku)}</td><td><strong style="color:var(--danger)">${x.variants.stock}</strong></td></tr>`).join('')}
        </table></div></div>` : ''}

        <div class="card"><h3>সাম্প্রতিক অর্ডার</h3><div class="table-wrap"><table>
          <tr><th>অর্ডার</th><th>কাস্টমার</th><th>মোট</th><th>পেমেন্ট</th><th>স্ট্যাটাস</th><th>সময়</th></tr>
          ${s.recentOrders.map((o) => `<tr>
            <td><strong>${esc(o.orderNo)}</strong></td><td>${esc(o.customer.name)}</td><td>${bd(o.total)}</td>
            <td><span class="status-badge st-${esc(o.payment.status)}">${esc(o.payment.status)}</span></td>
            <td><span class="status-badge st-${esc(o.status)}">${ST_LABEL[o.status] || o.status}</span></td><td>${dt(o.createdAt)}</td>
          </tr>`).join('')}
        </table></div></div>`;
      const iso = (d) => d.toISOString().slice(0, 10);
      main().querySelectorAll('[data-range]').forEach((b) => b.onclick = () => {
        const days = +b.dataset.range;
        views.dashboard(iso(new Date(Date.now() - days * 86400000)), iso(new Date()));
      });
      $('#d-apply').onclick = () => views.dashboard($('#d-from').value, $('#d-to').value);
    } catch (e) { toast(e.message, true); }
  };

  /* ================= PRODUCTS ================= */
  views.products = async (page = 1) => {
    main().innerHTML = `
      <div class="page-head"><h1 class="page-title">প্রোডাক্ট</h1>
        <button class="btn btn-primary" id="new-product">+ নতুন প্রোডাক্ট</button></div>
      <div class="filter-row">
        <input id="p-search" placeholder="সার্চ…">
        <select id="p-status"><option value="active" selected>Active (ডিফল্ট)</option><option value="">সব স্ট্যাটাস</option><option value="draft">Draft</option><option value="archived">Archived</option></select>
      </div>
      <div class="bulk-bar" id="p-bulk" hidden>
        <strong><span id="pb-count">0</span>টা সিলেক্টেড</strong>
        <span class="sep"></span>
        <select id="pb-status"><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option></select>
        <button class="btn btn-primary btn-sm" id="pb-status-apply">স্ট্যাটাস প্রয়োগ</button>
        <span class="sep"></span>
        <button class="btn btn-ghost btn-sm" id="pb-feature">⭐ ফিচারড</button>
        <button class="btn btn-ghost btn-sm" id="pb-unfeature">ফিচারড বাদ</button>
      </div>
      <div class="card"><div class="table-wrap" id="p-table">লোড হচ্ছে…</div><div class="pager" id="p-pager"></div></div>`;
    $('#new-product').onclick = () => productForm();
    const pSelected = new Set();
    const pBulkBar = () => { $('#p-bulk').hidden = !pSelected.size; $('#pb-count').textContent = pSelected.size; };
    const pBulk = async (body) => {
      try {
        const r = await api('/products/bulk', { method: 'POST', body: { ids: [...pSelected], ...body } });
        toast(`✓ ${r.done}টা প্রোডাক্টে প্রয়োগ হয়েছে`); pSelected.clear(); pBulkBar(); loadRef();
      } catch (e) { toast(e.message, true); }
    };
    $('#pb-status-apply').onclick = () => pBulk({ action: 'status', status: $('#pb-status').value });
    $('#pb-feature').onclick = () => pBulk({ action: 'feature' });
    $('#pb-unfeature').onclick = () => pBulk({ action: 'unfeature' });
    let loadRef = () => {};
    const load = async (pg = 1) => {
      const qs = new URLSearchParams({ page: pg });
      if ($('#p-search').value.trim()) qs.set('q', $('#p-search').value.trim());
      if ($('#p-status').value) qs.set('status', $('#p-status').value);
      try {
        const data = await api('/products?' + qs);
        pSelected.clear(); pBulkBar();
        $('#p-table').innerHTML = `<table>
          <tr><th style="width:34px"><input type="checkbox" id="p-check-all"></th><th></th><th>টাইটেল</th><th>দাম</th><th>স্টক</th><th>স্ট্যাটাস</th><th></th></tr>
          ${data.items.map((p) => {
            const stock = p.variants.reduce((s, v) => s + v.stock, 0);
            return `<tr>
              <td><input type="checkbox" class="p-check" data-id="${p._id}"></td>
              <td><img class="thumb" src="${esc(p.images?.[0] || '/img-placeholder.svg')}"></td>
              <td><strong>${esc(p.title)}</strong><br><small>${esc(p.brand || '')} · ${p.variants.length} ভ্যারিয়েন্ট</small></td>
              <td>${bd(Math.min(...p.variants.map((v) => v.price)))}</td>
              <td>${stock}</td>
              <td><span class="status-badge st-${esc(p.status)}">${esc(p.status)}</span></td>
              <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-edit="${p._id}">এডিট</button>
                <button class="btn btn-danger btn-sm" data-del="${p._id}">আর্কাইভ</button></td>
            </tr>`;
          }).join('') || '<tr><td colspan="7">কোনো প্রোডাক্ট নেই</td></tr>'}</table>`;
        loadRef = () => load(pg);
        const pAll = $('#p-check-all');
        if (pAll) pAll.onchange = () => { $$('.p-check').forEach((c) => { c.checked = pAll.checked; c.checked ? pSelected.add(c.dataset.id) : pSelected.delete(c.dataset.id); }); pBulkBar(); };
        $$('.p-check').forEach((c) => c.onchange = () => { c.checked ? pSelected.add(c.dataset.id) : pSelected.delete(c.dataset.id); pBulkBar(); });
        $('#p-pager').innerHTML = data.pages > 1 ? Array.from({ length: data.pages }, (_, i) =>
          `<button class="btn btn-sm ${i + 1 === pg ? 'btn-primary' : 'btn-ghost'}" data-pg="${i + 1}">${i + 1}</button>`).join('') : '';
        $('#p-pager').onclick = (e) => { const b = e.target.closest('[data-pg]'); if (b) load(+b.dataset.pg); };
        $('#p-table').onclick = async (e) => {
          const ed = e.target.closest('[data-edit]');
          if (ed) { const p = await api('/products/' + ed.dataset.edit); productForm(p); return; }
          const del = e.target.closest('[data-del]');
          if (del && await confirmBox('প্রোডাক্টটা আর্কাইভ হবে (স্টোরে দেখাবে না)।')) {
            await api('/products/' + del.dataset.del, { method: 'DELETE' });
            toast('আর্কাইভ হয়েছে'); load(pg);
          }
        };
      } catch (e) { toast(e.message, true); }
    };
    let t; $('#p-search').oninput = () => { clearTimeout(t); t = setTimeout(() => load(1), 400); };
    $('#p-status').onchange = () => load(1);
    load(page);
  };

  /* ---------- product form + AI ---------- */
  function productForm(p = null) {
    let collections = [];
    const state = {
      images: p?.images || [],
      specs: p?.specs || [],
      faqs: p?.faqs || [],
      variants: p?.variants?.length ? p.variants : [{ sku: '', name: 'Default', price: 0, comparePrice: 0, costPrice: 0, stock: 0, lowStockAlert: 3 }],
      aiImages: [], // base64 for AI
    };

    main().innerHTML = `
      <div class="page-head"><h1 class="page-title">${p ? 'প্রোডাক্ট এডিট' : 'নতুন প্রোডাক্ট'}</h1>
        <button class="btn btn-ghost" id="back-products">← ফিরে যান</button></div>

      <div class="ai-box">
        <h3>🤖 AI দিয়ে লেখান <small style="font-weight:400;color:#6b7280">(Claude Sonnet 5)</small></h3>
        <p style="font-size:.9rem;color:var(--ink-soft)">সাপ্লায়ার/অফিশিয়াল পেজের লিংক অথবা প্রোডাক্টের ছবি দিন — বাংলা description, spec আর FAQ অটো লিখে ফর্মে বসিয়ে দেবে।</p>
        <div class="form-2col">
          <div><label>সোর্স URL (অফিশিয়াল/সাপ্লায়ার পেজ)</label><input id="ai-url" placeholder="https://www.tp-link.com/..."></div>
          <div><label>প্রোডাক্টের নাম (জানা থাকলে)</label><input id="ai-name" placeholder="TP-Link Archer AX23"></div>
          <div class="full"><label>অতিরিক্ত নোট (ঐচ্ছিক)</label><input id="ai-notes" placeholder="যেমন: ১ বছরের ওয়ারেন্টি দিচ্ছি, গ্লোবাল ভার্সন"></div>
          <div class="full"><label>ছবি (ঐচ্ছিক, বক্স/স্পেক লেবেলের ছবি — সর্বোচ্চ ৪টা)</label><input type="file" id="ai-imgs" accept="image/jpeg,image/png,image/webp" multiple></div>
        </div>
        <div style="margin-top:12px"><button class="btn btn-ai" id="ai-generate">✨ Generate করুন</button>
        <span class="ai-status" id="ai-status"></span></div>
      </div>

      <form class="card" id="product-form">
        <div class="form-2col">
          <div class="full"><label>টাইটেল *</label><input id="pf-title" required value="${esc(p?.title || '')}"></div>
          <div><label>ব্র্যান্ড</label><input id="pf-brand" value="${esc(p?.brand || '')}"></div>
          <div><label>মডেল</label><input id="pf-model" value="${esc(p?.model || '')}"></div>
          <div class="full"><label>শর্ট ডেসক্রিপশন</label><input id="pf-short" maxlength="600" value="${esc(p?.shortDescription || '')}"></div>
          <div class="full"><label>বিস্তারিত ডেসক্রিপশন</label><div id="pf-desc-editor"></div></div>
          <div class="full"><label>A+ কনটেন্ট <small style="font-weight:400;color:var(--ink-soft)">(ঐচ্ছিক — description-এর পরে বড় ছবি+টেক্সট সেকশন, Amazon A+ স্টাইল)</small></label><div id="pf-aplus-editor"></div></div>
          <div><label>ওয়ারেন্টি</label><input id="pf-warranty" value="${esc(p?.warranty || '')}"></div>
          <div><label>স্ট্যাটাস</label><select id="pf-status">
            <option value="draft" ${p?.status === 'draft' || !p ? 'selected' : ''}>Draft</option>
            <option value="active" ${p?.status === 'active' ? 'selected' : ''}>Active (স্টোরে দেখাবে)</option>
            <option value="archived" ${p?.status === 'archived' ? 'selected' : ''}>Archived</option></select></div>
          <div><label>কালেকশন</label><select id="pf-collections" multiple size="4"></select></div>
          <div><label><input type="checkbox" id="pf-featured" style="width:auto" ${p?.featured ? 'checked' : ''}> ফিচারড (হোমপেজে দেখাবে)</label>
            <label>ট্যাগ (কমা দিয়ে)</label><input id="pf-tags" value="${esc((p?.tags || []).join(', '))}"></div>
          <div class="full"><label>SEO টাইটেল</label><input id="pf-seotitle" maxlength="120" value="${esc(p?.seoTitle || '')}"></div>
          <div class="full"><label>SEO ডেসক্রিপশন</label><input id="pf-seodesc" maxlength="300" value="${esc(p?.seoDescription || '')}"></div>
        </div>

        <label style="margin-top:18px">প্রোডাক্টের ছবি</label>
        <input type="file" id="pf-upload" accept="image/jpeg,image/png,image/webp" multiple>
        <div class="img-list" id="pf-images"></div>

        <label style="margin-top:18px">ভ্যারিয়েন্ট / SKU *</label>
        <div id="pf-variants"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-variant" style="margin-top:8px">+ ভ্যারিয়েন্ট</button>

        <label style="margin-top:18px">স্পেসিফিকেশন</label>
        <div id="pf-specs"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-spec" style="margin-top:8px">+ স্পেক</button>
        <details style="margin-top:10px">
          <summary style="cursor:pointer;font-weight:700;color:var(--brand)">📋 একসাথে অনেক স্পেক (পেস্ট বা CSV)</summary>
          <div style="margin-top:10px">
            <textarea id="spec-bulk" rows="5" placeholder="প্রতি লাইনে একটা — যেকোনো ফরম্যাট চলবে:&#10;RAM: 6GB&#10;ROM, 200GB&#10;Bluetooth&#9;5.4"></textarea>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              <button type="button" class="btn btn-primary btn-sm" id="spec-bulk-add">যোগ করুন</button>
              <label class="btn btn-ghost btn-sm" style="cursor:pointer">📄 CSV ফাইল<input type="file" id="spec-csv" accept=".csv,.txt,text/csv,text/plain" hidden></label>
              <span style="font-size:.8rem;color:var(--ink-soft);align-self:center">Name: Value / Name, Value / CSV — সব সাপোর্টেড; আগের স্পেকের সাথে যোগ হবে</span>
            </div>
          </div>
        </details>

        <label style="margin-top:18px">FAQ</label>
        <div id="pf-faqs"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-faq" style="margin-top:8px">+ FAQ</button>

        <div class="modal-actions"><button class="btn btn-primary" type="submit">${p ? 'আপডেট করুন' : 'সেভ করুন'}</button></div>
      </form>`;

    $('#back-products').onclick = () => views.products();

    /* rich editors */
    const descEd = richEditor($('#pf-desc-editor'), p?.description || '', { placeholder: 'প্রোডাক্টের বিস্তারিত লিখুন… (AI Generate করলে এখানে বসবে)' });
    const aplusEd = richEditor($('#pf-aplus-editor'), p?.aplusHtml || '', { tall: true, withImage: true, placeholder: 'বড় ব্যানার ছবি, ফিচার হাইলাইট, ব্যবহারের গল্প…' });

    /* collections dropdown */
    api('/collections').then((cols) => {
      collections = cols;
      const sel = (p?.collections || []).map((c) => (typeof c === 'string' ? c : c._id));
      $('#pf-collections').innerHTML = cols.map((c) => `<option value="${c._id}" ${sel.includes(c._id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    });

    /* renderers */
    const renderImages = () => {
      $('#pf-images').innerHTML = state.images.map((im, i) => `
        <div class="im">
          ${i === 0 ? '<span class="cover-badge">কভার</span>' : ''}
          <img src="${esc(im)}">
          <button type="button" data-rmimg="${i}" title="মুছুন">×</button>
          <div class="im-move">
            <button type="button" data-mvl="${i}" ${i === 0 ? 'disabled' : ''} title="বামে সরান">←</button>
            <button type="button" data-mvr="${i}" ${i === state.images.length - 1 ? 'disabled' : ''} title="ডানে সরান">→</button>
          </div>
        </div>`).join('');
    };
    const renderVariants = () => {
      $('#pf-variants').innerHTML = state.variants.map((v, i) => `
        <div class="variant-row">
          <div><label>SKU *</label><input data-v="${i}" data-k="sku" value="${esc(v.sku)}" required></div>
          <div><label>নাম</label><input data-v="${i}" data-k="name" value="${esc(v.name)}"></div>
          <div><label>দাম *</label><input data-v="${i}" data-k="price" type="number" min="0" value="${v.price}"></div>
          <div><label>আগের দাম</label><input data-v="${i}" data-k="comparePrice" type="number" min="0" value="${v.comparePrice || 0}"></div>
          <div><label>ক্রয়মূল্য</label><input data-v="${i}" data-k="costPrice" type="number" min="0" value="${v.costPrice || 0}"></div>
          <div><label>স্টক</label><input data-v="${i}" data-k="stock" type="number" min="0" value="${v.stock}"></div>
          <button type="button" class="btn btn-danger btn-sm" data-rmv="${i}" ${state.variants.length === 1 ? 'disabled' : ''}>×</button>
        </div>`).join('');
    };
    const renderSpecs = () => {
      $('#pf-specs').innerHTML = state.specs.map((s, i) => `
        <div class="spec-row">
          <input data-s="${i}" data-k="label" placeholder="লেবেল" value="${esc(s.label)}">
          <input data-s="${i}" data-k="value" placeholder="ভ্যালু" value="${esc(s.value)}">
          <button type="button" class="btn btn-danger btn-sm" data-rms="${i}">×</button>
        </div>`).join('');
    };
    const renderFaqs = () => {
      $('#pf-faqs').innerHTML = state.faqs.map((f, i) => `
        <div class="faq-row">
          <div><input data-f="${i}" data-k="q" placeholder="প্রশ্ন" value="${esc(f.q)}" style="margin-bottom:6px">
          <textarea data-f="${i}" data-k="a" placeholder="উত্তর" rows="2">${esc(f.a)}</textarea></div>
          <button type="button" class="btn btn-danger btn-sm" data-rmf="${i}">×</button>
        </div>`).join('');
    };
    renderImages(); renderVariants(); renderSpecs(); renderFaqs();

    /* form events (delegation) */
    $('#product-form').addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.v !== undefined) state.variants[+el.dataset.v][el.dataset.k] = el.type === 'number' ? +el.value : el.value;
      if (el.dataset.s !== undefined) state.specs[+el.dataset.s][el.dataset.k] = el.value;
      if (el.dataset.f !== undefined) state.faqs[+el.dataset.f][el.dataset.k] = el.value;
    });
    $('#product-form').addEventListener('click', (e) => {
      const rmv = e.target.closest('[data-rmv]'); if (rmv) { state.variants.splice(+rmv.dataset.rmv, 1); renderVariants(); }
      const rms = e.target.closest('[data-rms]'); if (rms) { state.specs.splice(+rms.dataset.rms, 1); renderSpecs(); }
      const rmf = e.target.closest('[data-rmf]'); if (rmf) { state.faqs.splice(+rmf.dataset.rmf, 1); renderFaqs(); }
      const rmi = e.target.closest('[data-rmimg]'); if (rmi) { state.images.splice(+rmi.dataset.rmimg, 1); renderImages(); }
      const mvl = e.target.closest('[data-mvl]'); if (mvl) { const i = +mvl.dataset.mvl; [state.images[i - 1], state.images[i]] = [state.images[i], state.images[i - 1]]; renderImages(); }
      const mvr = e.target.closest('[data-mvr]'); if (mvr) { const i = +mvr.dataset.mvr; [state.images[i], state.images[i + 1]] = [state.images[i + 1], state.images[i]]; renderImages(); }
    });
    $('#add-variant').onclick = () => { state.variants.push({ sku: '', name: '', price: 0, comparePrice: 0, costPrice: 0, stock: 0, lowStockAlert: 3 }); renderVariants(); };
    $('#add-spec').onclick = () => { state.specs.push({ label: '', value: '' }); renderSpecs(); };

    /* বাল্ক স্পেক পার্সার — colon / comma / tab / quoted CSV সব বোঝে */
    function parseCsvLine(line) {
      // quoted CSV: Ports,"4x LAN, 1x WAN" — quote-এর ভেতরের কমা ভাঙে না
      const out = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    }
    function parseSpecText(text) {
      const pairs = [];
      for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        let label = '', value = '';
        if (line.includes(':')) { // Name: Value (value-তে আরো : থাকলেও ঠিক থাকে)
          const i = line.indexOf(':');
          label = line.slice(0, i).trim();
          value = line.slice(i + 1).trim();
        } else if (line.includes('\t')) { // supplier টেবিল থেকে কপি = tab-আলাদা
          const i = line.indexOf('\t');
          label = line.slice(0, i).trim();
          value = line.slice(i + 1).trim();
        } else if (line.includes(',')) { // CSV
          const cells = parseCsvLine(line);
          label = (cells[0] || '').trim();
          value = cells.slice(1).join(', ').trim();
        } else continue;
        if (!label || !value) continue;
        if (/^(name|field|label|নাম|ফিল্ড)$/i.test(label) && /^(value|val|মান|ভ্যালু)$/i.test(value)) continue; // হেডার সারি বাদ
        pairs.push({ label: label.slice(0, 100), value: value.slice(0, 300) });
      }
      return pairs;
    }
    function addBulkSpecs(text) {
      const pairs = parseSpecText(text);
      if (!pairs.length) return toast('কিছু পাওয়া যায়নি — প্রতি লাইনে Name: Value বা Name, Value দিন', true);
      // ফাঁকা রো ফেলে দিয়ে নতুনগুলো যোগ (একই নামেরটা replace)
      state.specs = state.specs.filter((x) => x.label || x.value);
      for (const pr of pairs) {
        const ex = state.specs.find((x) => x.label.toLowerCase() === pr.label.toLowerCase());
        if (ex) ex.value = pr.value; else state.specs.push(pr);
      }
      renderSpecs();
      toast(`✓ ${pairs.length}টা স্পেক যোগ/আপডেট হয়েছে`);
      $('#spec-bulk').value = '';
    }
    $('#spec-bulk-add').onclick = () => addBulkSpecs($('#spec-bulk').value);
    $('#spec-csv').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => addBulkSpecs(rd.result);
      rd.readAsText(f, 'UTF-8');
      e.target.value = '';
    };
    $('#add-faq').onclick = () => { state.faqs.push({ q: '', a: '' }); renderFaqs(); };

    /* image upload */
    $('#pf-upload').onchange = async (e) => {
      const fd = new FormData();
      [...e.target.files].forEach((f) => fd.append('images', f));
      try {
        const data = await api('/upload', { method: 'POST', body: fd, isForm: true });
        state.images.push(...data.files);
        renderImages();
        toast('ছবি আপলোড হয়েছে ✓');
      } catch (err) { toast(err.message, true); }
      e.target.value = '';
    };

    /* ---------- AI generate ---------- */
    $('#ai-imgs').onchange = async (e) => {
      state.aiImages = [];
      for (const f of [...e.target.files].slice(0, 4)) {
        const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(f); });
        state.aiImages.push({ media_type: f.type, data });
      }
    };
    $('#ai-generate').onclick = async () => {
      const url = $('#ai-url').value.trim();
      const name = $('#ai-name').value.trim();
      if (!url && !name && !state.aiImages.length) return toast('URL, নাম বা ছবি — অন্তত একটা দিন', true);
      const btn = $('#ai-generate'), st = $('#ai-status');
      btn.disabled = true;
      st.innerHTML = '<span class="spinner"></span> Sonnet 5 লিখছে… (১০-২০ সেকেন্ড)';
      try {
        const r = await api('/ai/generate', {
          method: 'POST',
          body: { productName: name, sourceUrl: url || undefined, extraNotes: $('#ai-notes').value.trim(), images: state.aiImages },
        });
        if (r.titleBn && !$('#pf-title').value) $('#pf-title').value = r.titleBn;
        if (r.shortDescription) $('#pf-short').value = r.shortDescription;
        if (r.descriptionHtml) descEd.set(r.descriptionHtml);
        if (r.seoTitle) $('#pf-seotitle').value = r.seoTitle;
        if (r.seoDescription) $('#pf-seodesc').value = r.seoDescription;
        if (r.tags?.length) $('#pf-tags').value = r.tags.join(', ');
        if (r.specs?.length) { state.specs = r.specs; renderSpecs(); }
        if (r.faqs?.length) { state.faqs = r.faqs; renderFaqs(); }
        if (url) state.sourceUrl = url;
        st.innerHTML = `✅ হয়ে গেছে! ${r.specs?.length || 0}টা স্পেক, ${r.faqs?.length || 0}টা FAQ — চেক করে সেভ করুন`;
        toast('AI কনটেন্ট ফর্মে বসানো হয়েছে ✓');
      } catch (err) {
        st.textContent = '❌ ' + err.message;
        toast(err.message, true);
      }
      btn.disabled = false;
    };

    /* ---------- save ---------- */
    $('#product-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        title: $('#pf-title').value.trim(),
        brand: $('#pf-brand').value.trim(),
        model: $('#pf-model').value.trim(),
        shortDescription: $('#pf-short').value.trim(),
        description: descEd.get(),
        aplusHtml: aplusEd.get(),
        warranty: $('#pf-warranty').value.trim(),
        status: $('#pf-status').value,
        featured: $('#pf-featured').checked,
        tags: $('#pf-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
        seoTitle: $('#pf-seotitle').value.trim(),
        seoDescription: $('#pf-seodesc').value.trim(),
        collections: [...$('#pf-collections').selectedOptions].map((o) => o.value),
        images: state.images,
        specs: state.specs.filter((s) => s.label && s.value),
        faqs: state.faqs.filter((f) => f.q && f.a),
        variants: state.variants.map((v) => ({ ...v, price: +v.price, comparePrice: +v.comparePrice || 0, costPrice: +v.costPrice || 0, stock: +v.stock || 0, lowStockAlert: +v.lowStockAlert || 3 })),
        sourceUrl: state.sourceUrl || p?.sourceUrl,
      };
      try {
        if (p) await api('/products/' + p._id, { method: 'PUT', body });
        else await api('/products', { method: 'POST', body });
        toast('সেভ হয়েছে ✓');
        views.products();
      } catch (err) { toast(err.message, true); }
    });
  }

  /* ================= ORDERS (Shopify-style) ================= */
  views.orders = async () => {
    main().innerHTML = `
      <div class="page-head"><h1 class="page-title">অর্ডার</h1>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost" id="o-export">⬇️ CSV এক্সপোর্ট</button>
          <button class="btn btn-primary" id="o-create">+ অর্ডার তৈরি</button>
        </div></div>
      <div class="tab-strip" id="o-tabs"></div>
      <div class="filter-row">
        <input id="o-search" placeholder="অর্ডার নং / নাম / ফোন / TrxID…">
        <select id="o-payment"><option value="">সব পেমেন্ট</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="refunded">Refunded</option></select>
        <input id="o-tag" placeholder="ট্যাগ ফিল্টার" style="max-width:130px">
        <select id="o-source"><option value="">সব সোর্স</option><option value="online">অনলাইন</option><option value="admin">অ্যাডমিন</option></select>
        <input id="o-from" type="date" title="শুরুর তারিখ">
        <input id="o-to" type="date" title="শেষ তারিখ">
        <button class="btn btn-ghost btn-sm" id="o-clear">রিসেট</button>
      </div>
      <div class="bulk-bar" id="o-bulk" hidden>
        <strong><span id="ob-count">0</span>টা সিলেক্টেড</strong>
        <span class="sep"></span>
        <label>অর্ডার স্ট্যাটাস:</label>
        <select id="ob-status">${['confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'].map((st) => `<option value="${st}">${({ confirmed: 'কনফার্মড', processing: 'প্রসেসিং', shipped: 'কুরিয়ারে', delivered: 'ডেলিভার্ড', cancelled: 'বাতিল', returned: 'রিটার্নড' })[st]}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm" id="ob-status-apply">প্রয়োগ</button>
        <span class="sep"></span>
        <label>পেমেন্ট:</label>
        <select id="ob-pay"><option value="paid">paid</option><option value="pending">pending</option><option value="failed">failed</option><option value="refunded">refunded</option></select>
        <button class="btn btn-primary btn-sm" id="ob-pay-apply">প্রয়োগ</button>
        <span class="sep"></span>
        <button class="btn btn-sm" id="ob-steadfast" style="background:#f5a623;color:#0b1b2b;font-weight:700">📦 Steadfast</button>
        <span class="sep"></span>
        <button class="btn btn-danger btn-sm" id="ob-delete">🗑️ মুছুন</button>
        <button class="btn btn-ghost btn-sm" id="ob-clear">সিলেকশন বাদ</button>
      </div>
      <div class="card"><div class="table-wrap" id="o-table">লোড হচ্ছে…</div><div class="pager" id="o-pager"></div></div>`;

    const state = { tab: '', page: 1 };
    const TABS = [
      ['', 'সব'], ['pending', 'পেন্ডিং'], ['shipped', 'কুরিয়ারে'],
      ['delivered', 'ডেলিভার্ড'], ['cancelled', 'বাতিল'], ['returned', 'রিটার্নড'],
    ];
    const renderTabs = (counts = {}) => {
      const pend = (counts.awaiting_payment || 0) + (counts.confirmed || 0) + (counts.processing || 0);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const n = { '': total, pending: pend, shipped: counts.shipped || 0, delivered: counts.delivered || 0, cancelled: counts.cancelled || 0, returned: counts.returned || 0 };
      $('#o-tabs').innerHTML = TABS.map(([v, l]) =>
        `<button data-tab="${v}" class="${state.tab === v ? 'active' : ''}">${l}<span class="n">${n[v] ?? 0}</span></button>`).join('');
    };

    const selected = new Set();
    const renderBulkBar = () => {
      const bar = $('#o-bulk');
      if (!selected.size) { bar.hidden = true; return; }
      bar.hidden = false;
      $('#ob-count').textContent = selected.size;
    };
    const load = async () => {
      selected.clear(); renderBulkBar();
      const qs = new URLSearchParams({ page: state.page });
      if (state.tab) qs.set('status', state.tab);
      if ($('#o-search').value.trim()) qs.set('q', $('#o-search').value.trim());
      if ($('#o-payment').value) qs.set('payment', $('#o-payment').value);
      if ($('#o-tag').value.trim()) qs.set('tag', $('#o-tag').value.trim());
      if ($('#o-source').value) qs.set('source', $('#o-source').value);
      if ($('#o-from').value) qs.set('dateFrom', $('#o-from').value);
      if ($('#o-to').value) qs.set('dateTo', $('#o-to').value);
      try {
        const data = await api('/orders?' + qs);
        renderTabs(data.counts);
        setNavBadge('orders', data.unread);
        $('#o-table').innerHTML = `<table>
          <tr><th style="width:34px"><input type="checkbox" id="o-check-all" title="সব সিলেক্ট"></th><th>অর্ডার</th><th>কাস্টমার</th><th>মোট</th><th>পেমেন্ট</th><th>বাকি (COD)</th><th>স্ট্যাটাস</th><th>সময়</th><th></th></tr>
          ${data.items.map((o) => `<tr>
            <td><input type="checkbox" class="o-check" data-id="${o._id}"></td>
            <td>${!o.seenByAdmin ? '<span class="unread-dot" title="নতুন — এখনো দেখা হয়নি"></span>' : ''}<strong>${esc(o.orderNo)}</strong>${o.source === 'admin' ? '<br><small style="color:var(--brand)">🖊️ ম্যানুয়াল</small>' : ''}${o.adminNote ? ' 📝' : ''}</td>
            <td>${esc(o.customer.name)}<br><small>${esc(o.customer.phone)}</small>${(o.tags || []).length ? `<br><small style="color:#6d28d9">🏷️ ${o.tags.map(esc).join(', ')}</small>` : ''}</td>
            <td>${bd(o.total)}</td>
            <td><span class="status-badge st-${esc(o.payment.status)}">${esc(o.payment.status)}</span></td>
            <td>${o.codDue > 0 ? bd(o.codDue) : '—'}</td>
            <td><span class="status-badge st-${esc(o.status)}">${ST_LABEL[o.status] || o.status}</span></td>
            <td><small>${dt(o.createdAt)}</small></td>
            <td><button class="btn btn-ghost btn-sm" data-view-order="${o._id}">দেখুন</button></td>
          </tr>`).join('') || '<tr><td colspan="9">এই ফিল্টারে কোনো অর্ডার নেই</td></tr>'}</table>`;
        $('#o-pager').innerHTML = data.pages > 1 ? Array.from({ length: data.pages }, (_, i) =>
          `<button class="btn btn-sm ${i + 1 === state.page ? 'btn-primary' : 'btn-ghost'}" data-pg="${i + 1}">${i + 1}</button>`).join('') : '';
        const all = $('#o-check-all');
        if (all) all.onchange = () => {
          $$('.o-check').forEach((c) => { c.checked = all.checked; c.checked ? selected.add(c.dataset.id) : selected.delete(c.dataset.id); });
          renderBulkBar();
        };
        $$('.o-check').forEach((c) => c.onchange = () => {
          c.checked ? selected.add(c.dataset.id) : selected.delete(c.dataset.id);
          renderBulkBar();
        });
      } catch (e) { toast(e.message, true); }
    };

    /* বাল্ক অ্যাকশন */
    const bulk = async (body) => {
      try {
        const r = await api('/orders/bulk', { method: 'POST', body: { ids: [...selected], ...body } });
        toast(`✓ ${r.done}টা অর্ডারে প্রয়োগ হয়েছে${r.failed.length ? `, ${r.failed.length}টা ব্যর্থ` : ''}`);
        load();
      } catch (e) { toast(e.message, true); }
    };
    $('#ob-status-apply').onclick = async () => {
      const st = $('#ob-status').value;
      const ids = [...selected];
      await bulk({ action: 'status', status: st });
      if (st === 'delivered' && ids.length && await confirmBox(`${ids.length}টা অর্ডার ডেলিভার্ড — সবগুলোর পেমেন্টও paid মার্ক করবেন?`)) {
        try {
          const r = await api('/orders/bulk', { method: 'POST', body: { ids, action: 'payment', paymentStatus: 'paid' } });
          toast(`✓ ${r.done}টা paid হয়েছে`);
          load();
        } catch (e) { toast(e.message, true); }
      }
    };
    $('#ob-pay-apply').onclick = () => bulk({ action: 'payment', paymentStatus: $('#ob-pay').value });
    $('#ob-steadfast').onclick = async () => {
      if (!await confirmBox(`${selected.size}টা অর্ডার Steadfast-এ বাল্ক বুক হবে (আগেই বুকড/বাতিল/ডেলিভার্ডগুলো বাদ যাবে)। নিশ্চিত?`)) return;
      try {
        const r = await api('/orders/bulk-ship', { method: 'POST', body: { ids: [...selected] } });
        toast(`✓ ${r.done}টা বুকড${r.failed.length ? `, ব্যর্থ: ${r.failed.join(', ')}` : ''}`);
        load();
      } catch (e) { toast(e.message, true); }
    };
    $('#ob-delete').onclick = async () => {
      if (await confirmBox(`${selected.size}টা অর্ডার স্থায়ীভাবে মুছে যাবে (ডেলিভার না হওয়াগুলোর স্টক ফেরত যাবে)। নিশ্চিত?`)) bulk({ action: 'delete' });
    };
    $('#ob-clear').onclick = () => { selected.clear(); $$('.o-check').forEach((c) => c.checked = false); const a = $('#o-check-all'); if (a) a.checked = false; renderBulkBar(); };

    $('#o-tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { state.tab = b.dataset.tab; state.page = 1; load(); } };
    $('#o-pager').onclick = (e) => { const b = e.target.closest('[data-pg]'); if (b) { state.page = +b.dataset.pg; load(); } };
    $('#o-table').onclick = async (e) => {
      const b = e.target.closest('[data-view-order]');
      if (b) orderDetail(await api('/orders/' + b.dataset.viewOrder), load);
    };
    let t; $('#o-search').oninput = () => { clearTimeout(t); t = setTimeout(() => { state.page = 1; load(); }, 400); };
    ['#o-payment', '#o-source', '#o-from', '#o-to'].forEach((s) => { $(s).onchange = () => { state.page = 1; load(); }; });
    $('#o-tag').oninput = () => { clearTimeout(t); t = setTimeout(() => { state.page = 1; load(); }, 400); };
    $('#o-clear').onclick = () => { ['#o-search', '#o-tag', '#o-from', '#o-to'].forEach((x) => $(x).value = ''); $('#o-payment').value = ''; $('#o-source').value = ''; state.tab = ''; state.page = 1; load(); };
    $('#o-export').onclick = () => {
      const qs = new URLSearchParams();
      if (state.tab) qs.set('status', state.tab);
      if ($('#o-payment').value) qs.set('payment', $('#o-payment').value);
      if ($('#o-tag').value.trim()) qs.set('tag', $('#o-tag').value.trim());
      if ($('#o-from').value) qs.set('dateFrom', $('#o-from').value);
      if ($('#o-to').value) qs.set('dateTo', $('#o-to').value);
      downloadCsv('/orders/export?' + qs, 'orders.csv');
    };
    $('#o-create').onclick = () => draftOrderForm(load);
    load();
  };

  /* ---------- item picker (draft order + order edit-এ শেয়ারড) ---------- */
  function itemPicker(mount, initial = []) {
    const items = initial.map((i) => ({ ...i }));
    const render = () => {
      mount.innerHTML = `
        <div style="position:relative">
          <input class="ip-search" placeholder="🔍 প্রোডাক্ট খুঁজে যোগ করুন…">
          <div class="search-suggest" hidden></div>
        </div>
        <table style="margin-top:10px"><tr><th>আইটেম</th><th style="width:90px">দাম</th><th style="width:70px">Qty</th><th style="width:90px">মোট</th><th></th></tr>
          ${items.map((it, i) => `<tr>
            <td>${esc(it.title)}${it.variantName && it.variantName !== 'Default' ? ` <small>(${esc(it.variantName)})</small>` : ''}<br><small>${esc(it.sku)} · স্টক ${it.stock}</small></td>
            <td><input type="number" min="0" value="${it.price}" data-ip-price="${i}" style="padding:5px 8px"></td>
            <td><input type="number" min="1" max="${it.stock}" value="${it.qty}" data-ip-qty="${i}" style="padding:5px 8px"></td>
            <td>${bd(it.price * it.qty)}</td>
            <td><button type="button" class="btn btn-danger btn-sm" data-ip-rm="${i}">×</button></td>
          </tr>`).join('') || '<tr><td colspan="5" style="color:var(--ink-soft)">সার্চ করে প্রোডাক্ট যোগ করুন</td></tr>'}
        </table>
        <p style="text-align:right;font-weight:700;margin-top:6px">সাবটোটাল: ${bd(items.reduce((a, i) => a + i.price * i.qty, 0))}</p>`;
      const inp = mount.querySelector('.ip-search'), sug = mount.querySelector('.search-suggest');
      let tm;
      inp.oninput = () => {
        clearTimeout(tm);
        const q = inp.value.trim();
        if (q.length < 2) { sug.hidden = true; return; }
        tm = setTimeout(async () => {
          try {
            const data = await api('/products?q=' + encodeURIComponent(q));
            sug.innerHTML = data.items.slice(0, 8).flatMap((p) => p.variants.map((v) =>
              `<div class="ss-item" data-add='${esc(JSON.stringify({ productId: p._id, variantId: v._id, title: p.title, variantName: v.name, sku: v.sku, price: v.price, stock: v.stock }))}'>
                ${esc(p.title)}${v.name !== 'Default' ? ` (${esc(v.name)})` : ''} — ${bd(v.price)} <small>স্টক ${v.stock}</small></div>`)).join('') || '<div class="ss-item">কিছু পাওয়া যায়নি</div>';
            sug.hidden = false;
          } catch {}
        }, 300);
      };
      sug.onclick = (e) => {
        const d = e.target.closest('[data-add]');
        if (!d) return;
        const v = JSON.parse(d.dataset.add);
        if (v.stock < 1) return toast('স্টক নেই', true);
        const ex = items.find((i) => i.variantId === v.variantId);
        if (ex) ex.qty = Math.min(ex.qty + 1, v.stock);
        else items.push({ ...v, qty: 1 });
        render();
      };
      mount.oninput = (e) => {
        const pi = e.target.closest('[data-ip-price]'); if (pi) items[+pi.dataset.ipPrice].price = +pi.value || 0;
        const qi = e.target.closest('[data-ip-qty]'); if (qi) items[+qi.dataset.ipQty].qty = Math.max(1, +qi.value || 1);
      };
      mount.onclick = (e) => {
        const rm = e.target.closest('[data-ip-rm]'); if (rm) { items.splice(+rm.dataset.ipRm, 1); render(); }
      };
    };
    render();
    return { get: () => items };
  }

  /* ---------- draft order: অ্যাডমিন নিজে অর্ডার তৈরি ---------- */
  function draftOrderForm(refresh) {
    modal.open(`
      <h3>🖊️ নতুন অর্ডার তৈরি (ফোন/দোকান সেল)</h3>
      <div id="do-items"></div>
      <div class="form-2col" style="margin-top:12px">
        <div><label>কাস্টমারের নাম *</label><input id="do-name"></div>
        <div><label>ফোন *</label><input id="do-phone" placeholder="01XXXXXXXXX"></div>
        <div class="full"><label>ঠিকানা * (ইংরেজিতে)</label><input id="do-address" placeholder="House 12, Road 3, Mirpur, Dhaka"></div>
        <div><label>এলাকা</label><select id="do-area"><option value="inside_dhaka">ঢাকার ভেতরে</option><option value="outside_dhaka">ঢাকার বাইরে</option></select></div>
        <div><label>পেমেন্ট পদ্ধতি</label><select id="do-method">
          <option value="manual">ম্যানুয়াল (ক্যাশ/হাতে বিকাশ)</option>
          <option value="cod_advance">COD</option>
          <option value="bkash_full">bKash ফুল</option></select></div>
        <div><label>ডেলিভারি চার্জ (৳)</label><input id="do-delivery" type="number" min="0" value="70"></div>
        <div><label>ডিসকাউন্ট (৳)</label><input id="do-discount" type="number" min="0" value="0"></div>
        <div class="full"><label><input type="checkbox" id="do-paid" style="width:auto" checked> এখনই paid মার্ক করুন (টাকা পেয়ে গেছি)</label></div>
        <div class="full"><label>অ্যাডমিন নোট (কাস্টমার দেখবে না)</label><input id="do-note"></div>
        <div class="full"><label>ট্যাগ (কমা দিয়ে)</label><input id="do-tags" placeholder="phone-sale, vip"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="do-cancel">বাতিল</button>
        <button class="btn btn-primary" id="do-save">অর্ডার তৈরি করুন</button>
      </div>`);
    const picker = itemPicker($('#do-items'));
    $('#do-cancel').onclick = modal.close;
    $('#do-save').onclick = async () => {
      const items = picker.get();
      if (!items.length) return toast('অন্তত একটা প্রোডাক্ট যোগ করুন', true);
      try {
        const o = await api('/orders/create', { method: 'POST', body: {
          items: items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty, price: i.price })),
          customer: { name: $('#do-name').value.trim(), phone: $('#do-phone').value.trim(), address: $('#do-address').value.trim(), area: $('#do-area').value },
          paymentMethod: $('#do-method').value,
          deliveryFee: +$('#do-delivery').value || 0,
          discount: +$('#do-discount').value || 0,
          markPaid: $('#do-paid').checked,
          adminNote: $('#do-note').value.trim(),
          tags: $('#do-tags').value.split(',').map((x) => x.trim()).filter(Boolean),
        }});
        toast(`অর্ডার ${o.orderNo} তৈরি হয়েছে ✓`);
        modal.close(); refresh();
      } catch (e) { toast(e.message, true); }
    };
  }

  /* ---------- order edit: আইটেম/চার্জ বদল ---------- */
  function orderEditForm(o, refresh) {
    modal.open(`
      <h3>✏️ অর্ডার ${esc(o.orderNo)} এডিট</h3>
      <p style="font-size:.85rem;color:var(--ink-soft)">শিপ হওয়ার আগ পর্যন্ত এডিট করা যায়। স্টক অটো-মিলবে। ইতিমধ্যে পেইড ৳${o.payment.amountPaid || 0} — নতুন মোট বেশি হলে বাকিটা codDue-তে যোগ হবে।</p>
      <div id="oe-items"></div>
      <div class="form-2col" style="margin-top:12px">
        <div><label>ডেলিভারি চার্জ (৳)</label><input id="oe-delivery" type="number" min="0" value="${o.deliveryFee}"></div>
        <div><label>ডিসকাউন্ট (৳)</label><input id="oe-discount" type="number" min="0" value="${o.discount}"></div>
        <div class="full"><label>এডিটের নোট</label><input id="oe-note" placeholder="কেন বদলানো হলো"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="oe-cancel">বাতিল</button>
        <button class="btn btn-primary" id="oe-save">সেভ করুন</button>
      </div>`);
    const picker = itemPicker($('#oe-items'), o.items.map((i) => ({
      productId: i.product, variantId: i.variantId, title: i.title, variantName: i.variantName,
      sku: i.sku, price: i.price, qty: i.qty, stock: 9999,
    })));
    $('#oe-cancel').onclick = modal.close;
    $('#oe-save').onclick = async () => {
      const items = picker.get();
      if (!items.length) return toast('অন্তত একটা আইটেম লাগবে', true);
      try {
        await api(`/orders/${o._id}/edit`, { method: 'PUT', body: {
          items: items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty, price: i.price })),
          deliveryFee: +$('#oe-delivery').value || 0,
          discount: +$('#oe-discount').value || 0,
          note: $('#oe-note').value.trim(),
        }});
        toast('অর্ডার আপডেট হয়েছে ✓'); modal.close(); refresh();
      } catch (e) { toast(e.message, true); }
    };
  }

  /* ---------- order detail: রিসিপ্ট + স্ট্যাটাস কন্ট্রোল ---------- */
  function orderDetail(o, refresh) {
    const payLabel = o.paymentMethod === 'bkash_full' ? 'bKash ফুল পেমেন্ট' : 'COD (bKash অগ্রিমসহ)';
    modal.open(`
      <div class="receipt">
        <div class="receipt-head">
          <div><h2>ইনভয়েস — ${esc(o.orderNo)}</h2>
            <small>${dt(o.createdAt)}</small><br>
            <span class="status-badge st-${esc(o.status)}">${ST_LABEL[o.status] || o.status}</span>
            <span class="status-badge st-${esc(o.payment.status)}">${esc(o.payment.status)}</span></div>
          <div style="text-align:right"><strong>NetBazar</strong><br><small>netbazar.com</small></div>
        </div>
        <p><strong>বিল টু:</strong> ${esc(o.customer.name)} · ${esc(o.customer.phone)}<br>
        ${esc(o.customer.address)} <em>(${o.customer.area === 'inside_dhaka' ? 'ঢাকার ভেতরে' : 'ঢাকার বাইরে'})</em>
        ${o.customer.note ? `<br><strong>নোট:</strong> ${esc(o.customer.note)}` : ''}</p>
        <div class="table-wrap"><table>
          <tr><th>আইটেম</th><th>SKU</th><th class="pcol">দাম</th><th>Qty</th><th class="pcol" style="text-align:right">মোট</th></tr>
          ${o.items.map((i) => `<tr>
            <td>${esc(i.title)}${i.variantName && i.variantName !== 'Default' ? ` <small>(${esc(i.variantName)})</small>` : ''}</td>
            <td>${esc(i.sku)}</td><td class="pcol">${bd(i.price)}</td><td>${i.qty}</td>
            <td class="pcol" style="text-align:right">${bd(i.price * i.qty)}</td></tr>`).join('')}
        </table></div>
        <div class="totals pcol">
          <div><span>সাবটোটাল</span><span>${bd(o.subtotal)}</span></div>
          ${o.discount ? `<div><span>ডিসকাউন্ট${o.couponCode ? ` (${esc(o.couponCode)})` : ''}</span><span>−${bd(o.discount)}</span></div>` : ''}
          <div><span>ডেলিভারি</span><span>${bd(o.deliveryFee)}</span></div>
          <div class="grand"><span>মোট</span><span>${bd(o.total)}</span></div>
          ${o.payment.amountPaid ? `<div><span>পেইড</span><span>${bd(o.payment.amountPaid)}</span></div>` : ''}
          ${o.codDue > 0 && o.status !== 'delivered' ? `<div style="color:var(--danger)"><span><strong>ডেলিভারিতে collectible</strong></span><span><strong>${bd(o.codDue)}</strong></span></div>` : ''}
        </div>
        <div class="pay-info">
          <strong>পেমেন্ট:</strong> ${payLabel}
          ${o.payment.trxID ? ` · TrxID: <strong>${esc(o.payment.trxID)}</strong>` : ''}
          ${o.payment.payerNumber ? ` · ${esc(o.payment.payerNumber)}` : ''}
          ${o.courier?.trackingId ? `<br><strong>কুরিয়ার:</strong> ${esc(o.courier.name || '')} · ${esc(o.courier.trackingId)}` : ''}
        </div>
        <details class="no-print" style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">স্ট্যাটাস হিস্ট্রি</summary>
          <ul style="margin:8px 0 0 18px">${o.statusHistory.slice().reverse().map((h) =>
            `<li><strong>${ST_LABEL[h.status] || h.status}</strong>${h.note ? ` — ${esc(h.note)}` : ''} <small>(${dt(h.at)})</small></li>`).join('')}</ul>
        </details>
      </div>
      <hr class="no-print" style="margin:14px 0;border:0;border-top:1px solid var(--line)">
      <div class="form-3col no-print">
        <div><label>📦 অর্ডার স্ট্যাটাস</label><select id="od-status">
          ${['confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'].map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${ST_LABEL[s]}</option>`).join('')}
        </select></div>
        <div><label>কুরিয়ার</label><input id="od-courier" value="${esc(o.courier?.name || '')}" placeholder="Pathao/Steadfast"></div>
        <div><label>ট্র্যাকিং ID</label><input id="od-tracking" value="${esc(o.courier?.trackingId || '')}"></div>
        <div class="full"><label>নোট</label><input id="od-note" placeholder="ঐচ্ছিক — কাস্টমার ট্র্যাকিংয়েও দেখা যাবে"></div>
      </div>
      <hr class="no-print" style="margin:14px 0;border:0;border-top:1px solid var(--line)">
      <div class="no-print">
        <strong>💳 পেমেন্ট কন্ট্রোল</strong>
        <div class="form-3col" style="margin-top:6px">
          <div><label>পেমেন্ট স্ট্যাটাস</label><select id="od-pay-status">
            ${['paid', 'pending', 'failed', 'refunded'].map((st) => `<option value="${st}" ${o.payment.status === st ? 'selected' : ''}>${st}</option>`).join('')}
          </select></div>
          <div><label>পেইড amount (৳)</label><input id="od-pay-amount" type="number" min="0" value="${o.payment.amountPaid || ''}" placeholder="${o.advanceDue}"></div>
          <div><label>TrxID (ম্যানুয়াল হলে)</label><input id="od-pay-trx" value="${esc(o.payment.trxID || '')}" placeholder="যেমন: হাতে বিকাশ নেওয়া"></div>
          <div class="full"><label>পেমেন্ট নোট</label><input id="od-pay-note" placeholder="যেমন: দোকানে ক্যাশে নিয়েছি"></div>
        </div>
        <button class="btn btn-ghost btn-sm" id="od-pay-save" style="margin-top:8px">পেমেন্ট আপডেট করুন</button>
        <span style="font-size:.8rem;color:var(--ink-soft)"> — paid করলে স্টক কাটা হবে ও অর্ডার কনফার্মড হবে</span>
      </div>
      <hr class="no-print" style="margin:14px 0;border:0;border-top:1px solid var(--line)">
      <div class="no-print form-2col">
        <div><label>📝 অ্যাডমিন নোট (কাস্টমার দেখবে না)</label><textarea id="od-anote" rows="2">${esc(o.adminNote || '')}</textarea></div>
        <div><label>🏷️ ট্যাগ (কমা দিয়ে)</label><input id="od-tags" value="${esc((o.tags || []).join(', '))}">
          <button class="btn btn-ghost btn-sm" id="od-meta-save" style="margin-top:8px">নোট/ট্যাগ সেভ</button></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-danger" id="od-delete">🗑️ মুছুন</button>
        ${!o.courier?.consignmentId && !['cancelled', 'returned', 'delivered'].includes(o.status)
          ? '<button class="btn btn-signal" id="od-steadfast" style="background:#f5a623;color:#0b1b2b">📦 Steadfast-এ পাঠান</button>' : ''}
        ${o.courier?.consignmentId ? '<button class="btn btn-ghost" id="od-sync">🔄 কুরিয়ার Sync</button>' : ''}
        <button class="btn btn-ghost" id="od-edit">✏️ আইটেম এডিট</button>
        <label class="btn btn-ghost" style="cursor:pointer"><input type="checkbox" id="od-packing" style="width:auto;margin-right:6px">দাম ছাড়া (প্যাকিং স্লিপ)</label>
        <button class="btn btn-ghost" id="od-print">🖨️ প্রিন্ট</button>
        <button class="btn btn-ghost" id="od-close">বন্ধ</button>
        <button class="btn btn-primary" id="od-save">স্ট্যাটাস আপডেট</button>
      </div>`);
    $('#od-packing').onchange = (e) => $('.receipt').classList.toggle('packing', e.target.checked);
    const sfBtn = $('#od-steadfast');
    if (sfBtn) sfBtn.onclick = async () => {
      if (!await confirmBox(`${o.orderNo} Steadfast-এ বুক হবে — COD amount যাবে ${bd(o.codDue)}। নিশ্চিত?`)) return;
      try {
        const upd = await api(`/orders/${o._id}/ship-steadfast`, { method: 'POST' });
        toast(`✓ বুকড — ট্র্যাকিং ${upd.courier.trackingId}`); modal.close(); refresh();
      } catch (e) { toast(e.message, true); }
    };
    const syncBtn = $('#od-sync');
    if (syncBtn) syncBtn.onclick = async () => {
      try {
        const d = await api(`/orders/${o._id}/sync-courier`, { method: 'POST' });
        toast(`Steadfast স্ট্যাটাস: ${d.courierStatus}`); modal.close(); refresh();
      } catch (e) { toast(e.message, true); }
    };
    $('#od-edit').onclick = () => orderEditForm(o, refresh);
    $('#od-meta-save').onclick = async () => {
      try {
        await api(`/orders/${o._id}/meta`, { method: 'PUT', body: {
          adminNote: $('#od-anote').value.trim(),
          tags: $('#od-tags').value.split(',').map((x) => x.trim()).filter(Boolean),
        }});
        toast('নোট/ট্যাগ সেভ হয়েছে ✓');
      } catch (e) { toast(e.message, true); }
    };
    $('#od-print').onclick = () => {
      // রিসিপ্ট clone করে body-র শেষে #print-area-তে বসাই — লেআউটের কোনো প্রভাব ছাড়া ১ম পেজেই প্রিন্ট হয়
      let area = $('#print-area');
      if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
      const clone = $('.receipt').cloneNode(true);
      clone.querySelectorAll('.no-print').forEach((el) => el.remove());
      area.innerHTML = '';
      area.appendChild(clone);
      window.print();
      setTimeout(() => { area.innerHTML = ''; }, 500);
    };
    $('#od-pay-save').onclick = async () => {
      try {
        const body = { status: $('#od-pay-status').value, note: $('#od-pay-note').value.trim() };
        if ($('#od-pay-amount').value !== '') body.amountPaid = +$('#od-pay-amount').value;
        if ($('#od-pay-trx').value.trim()) body.trxID = $('#od-pay-trx').value.trim();
        await api(`/orders/${o._id}/payment`, { method: 'PUT', body });
        toast('পেমেন্ট আপডেট হয়েছে ✓'); modal.close(); refresh();
      } catch (e) { toast(e.message, true); }
    };
    $('#od-delete').onclick = async () => {
      if (!await confirmBox(`অর্ডার ${o.orderNo} স্থায়ীভাবে মুছে যাবে। ডেলিভার না হওয়া অর্ডারের স্টক ফেরত যাবে। নিশ্চিত?`)) return;
      try {
        await api('/orders/' + o._id, { method: 'DELETE' });
        toast('অর্ডার মুছে গেছে'); modal.close(); refresh();
      } catch (e) { toast(e.message, true); }
    };
    $('#od-close').onclick = modal.close;
    $('#od-save').onclick = async () => {
      try {
        const newStatus = $('#od-status').value;
        await api(`/orders/${o._id}/status`, { method: 'PUT', body: {
          status: newStatus, note: $('#od-note').value.trim(),
          courierName: $('#od-courier').value.trim() || undefined,
          trackingId: $('#od-tracking').value.trim() || undefined,
        }});
        // Shopify-স্টাইল: delivered = টাকাও বুঝে পাওয়া — paid মার্কের প্রস্তাব
        if (newStatus === 'delivered' && o.payment.status !== 'paid') {
          if (await confirmBox(`অর্ডার ডেলিভার্ড ✓ — পেমেন্ট স্ট্যাটাসও paid মার্ক করবেন? (মোট ${bd(o.total)})`)) {
            await api(`/orders/${o._id}/payment`, { method: 'PUT', body: { status: 'paid', amountPaid: o.total, note: 'ডেলিভারিতে সম্পূর্ণ টাকা কালেক্টেড' } });
            toast('পেমেন্ট paid হয়েছে ✓');
          }
        }
        toast('আপডেট হয়েছে ✓'); modal.close(); refresh();
      } catch (e) { toast(e.message, true); }
    };
  }

  /* ================= COLLECTIONS ================= */
  views.collections = async () => {
    main().innerHTML = `<div class="page-head"><h1 class="page-title">কালেকশন</h1>
      <button class="btn btn-primary" id="new-col">+ নতুন</button></div>
      <div class="card"><div class="table-wrap" id="c-table">লোড হচ্ছে…</div></div>`;
    const load = async () => {
      const cols = await api('/collections');
      $('#c-table').innerHTML = `<table><tr><th>নাম</th><th>Slug</th><th>অ্যাক্টিভ</th><th></th></tr>
        ${cols.map((c) => `<tr><td><strong>${esc(c.name)}</strong>${c.smart ? ' <span class="status-badge st-confirmed">⚡ smart</span>' : ''}</td><td>${esc(c.slug)}</td>
          <td>${c.active ? '✅' : '❌'}</td>
          <td><button class="btn btn-ghost btn-sm" data-edit='${esc(JSON.stringify({ _id: c._id, name: c.name, description: c.description, image: c.image, sortOrder: c.sortOrder, active: c.active, smart: c.smart, rules: c.rules }))}'>এডিট</button>
          <button class="btn btn-danger btn-sm" data-del="${c._id}">মুছুন</button></td></tr>`).join('') || '<tr><td colspan="4">খালি</td></tr>'}</table>`;
      $('#c-table').onclick = async (e) => {
        const ed = e.target.closest('[data-edit]'); if (ed) return colForm(JSON.parse(ed.dataset.edit), load);
        const del = e.target.closest('[data-del]');
        if (del && await confirmBox('কালেকশন মুছে যাবে (প্রোডাক্ট থাকবে)।')) { await api('/collections/' + del.dataset.del, { method: 'DELETE' }); toast('মুছে গেছে'); load(); }
      };
    };
    $('#new-col').onclick = () => colForm(null, load);
    load();
  };
  function colForm(c, refresh) {
    modal.open(`<h3>${c ? 'কালেকশন এডিট' : 'নতুন কালেকশন'}</h3>
      <label>নাম *</label><input id="cf-name" value="${esc(c?.name || '')}">
      <label>বিবরণ</label><textarea id="cf-desc" rows="2">${esc(c?.description || '')}</textarea>
      <label>আইকন/ছবি URL</label><input id="cf-img" value="${esc(c?.image || '')}">
      <label>সিরিয়াল</label><input id="cf-sort" type="number" value="${c?.sortOrder || 0}">
      <label><input type="checkbox" id="cf-active" style="width:auto" ${c?.active !== false ? 'checked' : ''}> অ্যাক্টিভ</label>
      <div style="border:2px dashed var(--line);border-radius:10px;padding:12px 14px;margin-top:12px">
        <label style="margin-top:0"><input type="checkbox" id="cf-smart" style="width:auto" ${c?.smart ? 'checked' : ''}> ⚡ স্মার্ট কালেকশন (Shopify-স্টাইল অটো-অ্যাড)</label>
        <p style="font-size:.83rem;color:var(--ink-soft)">নিচের rule-এ মিললে প্রোডাক্ট নিজে থেকেই এই কালেকশনে দেখাবে — আলাদা করে যোগ করা লাগবে না।</p>
        <label>ট্যাগ ম্যাচ (কমা দিয়ে)</label><input id="cf-rtags" placeholder="router, wifi-6, mesh" value="${esc((c?.rules?.tags || []).join(', '))}">
        <label>ব্র্যান্ড ম্যাচ (কমা দিয়ে)</label><input id="cf-rbrands" placeholder="TP-Link, Tenda" value="${esc((c?.rules?.brands || []).join(', '))}">
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" id="cf-cancel">বাতিল</button><button class="btn btn-primary" id="cf-save">সেভ</button></div>`);
    $('#cf-cancel').onclick = modal.close;
    $('#cf-save').onclick = async () => {
      const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
      const body = {
        name: $('#cf-name').value.trim(), description: $('#cf-desc').value.trim(),
        image: $('#cf-img').value.trim(), sortOrder: +$('#cf-sort').value || 0,
        active: $('#cf-active').checked,
        smart: $('#cf-smart').checked,
        rules: { tags: csv($('#cf-rtags').value), brands: csv($('#cf-rbrands').value) },
      };
      try {
        if (c) await api('/collections/' + c._id, { method: 'PUT', body });
        else await api('/collections', { method: 'POST', body });
        toast('সেভ হয়েছে ✓'); modal.close(); refresh();
      } catch (e) { toast(e.message, true); }
    };
  }

  /* ================= COUPONS ================= */
  views.coupons = async () => {
    main().innerHTML = `<div class="page-head"><h1 class="page-title">কুপন</h1>
      <button class="btn btn-primary" id="new-coupon">+ নতুন</button></div>
      <div class="card"><div class="table-wrap" id="cp-table">লোড হচ্ছে…</div></div>`;
    const load = async () => {
      const cps = await api('/coupons');
      $('#cp-table').innerHTML = `<table><tr><th>কোড</th><th>ছাড়</th><th>মিন অর্ডার</th><th>ব্যবহার</th><th>মেয়াদ</th><th></th></tr>
        ${cps.map((c) => `<tr><td><strong>${esc(c.code)}</strong> ${c.active ? '' : '(off)'}</td>
          <td>${c.type === 'percent' ? c.value + '%' : bd(c.value)}</td><td>${bd(c.minOrder)}</td>
          <td>${c.usedCount}${c.usageLimit ? '/' + c.usageLimit : ''}</td>
          <td>${c.expiresAt ? dt(c.expiresAt) : '—'}</td>
          <td><button class="btn btn-danger btn-sm" data-del="${c._id}">মুছুন</button></td></tr>`).join('') || '<tr><td colspan="6">খালি</td></tr>'}</table>`;
      $('#cp-table').onclick = async (e) => {
        const del = e.target.closest('[data-del]');
        if (del && await confirmBox('কুপনটা মুছবেন?')) { await api('/coupons/' + del.dataset.del, { method: 'DELETE' }); load(); }
      };
    };
    $('#new-coupon').onclick = () => {
      modal.open(`<h3>নতুন কুপন</h3>
        <label>কোড *</label><input id="cpf-code" placeholder="EID10" style="text-transform:uppercase">
        <div class="form-2col">
          <div><label>টাইপ</label><select id="cpf-type"><option value="percent">শতাংশ (%)</option><option value="fixed">নির্দিষ্ট টাকা</option></select></div>
          <div><label>মান *</label><input id="cpf-value" type="number" min="0"></div>
          <div><label>মিনিমাম অর্ডার</label><input id="cpf-min" type="number" min="0" value="0"></div>
          <div><label>ম্যাক্স ছাড় (% হলে)</label><input id="cpf-max" type="number" min="0" value="0"></div>
          <div><label>ব্যবহার লিমিট (0=unlimited)</label><input id="cpf-limit" type="number" min="0" value="0"></div>
          <div><label>মেয়াদ</label><input id="cpf-exp" type="datetime-local"></div>
        </div>
        <div class="modal-actions"><button class="btn btn-ghost" id="cpf-cancel">বাতিল</button><button class="btn btn-primary" id="cpf-save">তৈরি করুন</button></div>`);
      $('#cpf-cancel').onclick = modal.close;
      $('#cpf-save').onclick = async () => {
        try {
          await api('/coupons', { method: 'POST', body: {
            code: $('#cpf-code').value.trim().toUpperCase(), type: $('#cpf-type').value,
            value: +$('#cpf-value').value, minOrder: +$('#cpf-min').value || 0,
            maxDiscount: +$('#cpf-max').value || 0, usageLimit: +$('#cpf-limit').value || 0,
            expiresAt: $('#cpf-exp').value ? new Date($('#cpf-exp').value).toISOString() : null,
          }});
          toast('কুপন তৈরি ✓'); modal.close(); load();
        } catch (e) { toast(e.message, true); }
      };
    };
    load();
  };

  /* ================= BLOG & PAGES (shared CMS UI) ================= */
  const cmsView = (kind, label) => async () => {
    main().innerHTML = `<div class="page-head"><h1 class="page-title">${label}</h1>
      <button class="btn btn-primary" id="cms-new">+ নতুন</button></div>
      <div class="card"><div class="table-wrap" id="cms-table">লোড হচ্ছে…</div></div>`;
    const load = async () => {
      const items = await api('/' + kind);
      $('#cms-table').innerHTML = `<table><tr><th>টাইটেল</th><th>Slug</th><th>${kind === 'blog' ? 'পাবলিশড' : 'দৃশ্যমান'}</th><th></th></tr>
        ${items.map((b) => `<tr><td><strong>${esc(b.title)}</strong></td><td>${esc(b.slug)}</td>
          <td>${b.published ? '✅' : '📝 draft'}</td>
          <td><button class="btn btn-ghost btn-sm" data-edit="${b._id}">এডিট</button>
          <button class="btn btn-danger btn-sm" data-del="${b._id}">মুছুন</button></td></tr>`).join('') || '<tr><td colspan="4">খালি</td></tr>'}</table>`;
      $('#cms-table').onclick = async (e) => {
        const ed = e.target.closest('[data-edit]');
        if (ed) { const item = items.find((x) => x._id === ed.dataset.edit); return cmsForm(kind, item, load); }
        const del = e.target.closest('[data-del]');
        if (del && await confirmBox('মুছে ফেলবেন?')) { await api(`/${kind}/` + del.dataset.del, { method: 'DELETE' }); load(); }
      };
    };
    $('#cms-new').onclick = () => cmsForm(kind, null, load);
    load();
  };
  function cmsForm(kind, item, refresh) {
    modal.open(`<h3>${item ? 'এডিট' : 'নতুন'} ${kind === 'blog' ? 'পোস্ট' : 'পেজ'}</h3>
      <label>টাইটেল *</label><input id="cm-title" value="${esc(item?.title || '')}">
      ${kind === 'blog' ? `<label>সারাংশ</label><input id="cm-excerpt" value="${esc(item?.excerpt || '')}">
      <label>কভার ছবি URL</label><input id="cm-cover" value="${esc(item?.coverImage || '')}">` : `<label>Slug</label><input id="cm-slug" value="${esc(item?.slug || '')}" placeholder="about / return-policy">`}
      <label>কনটেন্ট (HTML)</label><textarea id="cm-content" rows="12">${esc(item?.content || '')}</textarea>
      <label><input type="checkbox" id="cm-pub" style="width:auto" ${item?.published ? 'checked' : ''}> পাবলিশ</label>
      <div class="modal-actions"><button class="btn btn-ghost" id="cm-cancel">বাতিল</button><button class="btn btn-primary" id="cm-save">সেভ</button></div>`);
    $('#cm-cancel').onclick = modal.close;
    $('#cm-save').onclick = async () => {
      const body = { title: $('#cm-title').value.trim(), content: $('#cm-content').value, published: $('#cm-pub').checked };
      if (kind === 'blog') { body.excerpt = $('#cm-excerpt').value.trim(); body.coverImage = $('#cm-cover').value.trim(); }
      else if ($('#cm-slug').value.trim()) body.slug = $('#cm-slug').value.trim();
      try {
        if (item) await api(`/${kind}/` + item._id, { method: 'PUT', body });
        else await api('/' + kind, { method: 'POST', body });
        toast('সেভ হয়েছে ✓'); modal.close(); refresh();
      } catch (e) { toast(e.message, true); }
    };
  }
  views.blog = cmsView('blog', 'ব্লগ');
  views.pages = cmsView('pages', 'পেজ');

  /* ================= REVIEWS ================= */
  views.reviews = async () => {
    main().innerHTML = `<div class="page-head"><h1 class="page-title">রিভিউ</h1></div>
      <div class="filter-row"><select id="rv-filter">
        <option value="">সব</option><option value="1">দৃশ্যমান</option><option value="0">লুকানো</option>
      </select></div>
      <div class="card"><div class="table-wrap" id="rv-table">লোড হচ্ছে…</div><div class="pager" id="rv-pager"></div></div>`;
    const load = async (pg = 1) => {
      const qs = new URLSearchParams({ page: pg });
      if ($('#rv-filter').value) qs.set('approved', $('#rv-filter').value);
      try {
        const data = await api('/reviews?' + qs);
        $('#rv-table').innerHTML = `<table>
          <tr><th>প্রোডাক্ট</th><th>রেটিং</th><th>মন্তব্য</th><th>ক্রেতা</th><th>অবস্থা</th><th></th></tr>
          ${data.items.map((r) => `<tr>
            <td>${esc(r.product?.title || '(মুছে গেছে)')}</td>
            <td>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
            <td style="max-width:280px">${esc(r.comment || '—')}</td>
            <td>${esc(r.name)}<br><small>${esc(r.orderNo)} · ${esc(r.phone)}</small></td>
            <td>${r.approved ? '<span class="status-badge st-active">দৃশ্যমান</span>' : '<span class="status-badge st-draft">লুকানো</span>'}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-ghost btn-sm" data-toggle="${r._id}">${r.approved ? 'লুকান' : 'দেখান'}</button>
              <button class="btn btn-danger btn-sm" data-del="${r._id}">মুছুন</button></td>
          </tr>`).join('') || '<tr><td colspan="6">কোনো রিভিউ নেই</td></tr>'}</table>`;
        $('#rv-pager').innerHTML = data.pages > 1 ? Array.from({ length: data.pages }, (_, i) =>
          `<button class="btn btn-sm ${i + 1 === pg ? 'btn-primary' : 'btn-ghost'}" data-pg="${i + 1}">${i + 1}</button>`).join('') : '';
        $('#rv-pager').onclick = (e) => { const b = e.target.closest('[data-pg]'); if (b) load(+b.dataset.pg); };
        $('#rv-table').onclick = async (e) => {
          const tg = e.target.closest('[data-toggle]');
          if (tg) { await api(`/reviews/${tg.dataset.toggle}/toggle`, { method: 'PUT' }); toast('আপডেট হয়েছে ✓'); return load(pg); }
          const del = e.target.closest('[data-del]');
          if (del && await confirmBox('রিভিউটা স্থায়ীভাবে মুছবেন?')) { await api('/reviews/' + del.dataset.del, { method: 'DELETE' }); load(pg); }
        };
      } catch (e) { toast(e.message, true); }
    };
    $('#rv-filter').onchange = () => load(1);
    load(1);
  };

  /* ================= CUSTOMERS ================= */
  views.customers = async () => {
    main().innerHTML = `<div class="page-head"><h1 class="page-title">কাস্টমার</h1>
      <button class="btn btn-ghost" id="cu-export">⬇️ CSV এক্সপোর্ট</button></div>

      <div class="card">
        <h3>👤 রেজিস্টার্ড অ্যাকাউন্ট</h3>
        <div class="filter-row" style="margin:10px 0"><input id="ac-search" placeholder="নাম / ফোন / ইমেইল…"></div>
        <div class="table-wrap" id="ac-table">লোড হচ্ছে…</div><div class="pager" id="ac-pager"></div>
      </div>

      <h3 style="margin:18px 0 10px">🛒 অর্ডার-ভিত্তিক কাস্টমার (গেস্টসহ)</h3>
      <div class="filter-row"><input id="cu-search" placeholder="নাম বা ফোন…"></div>
      <div class="card"><div class="table-wrap" id="cu-table">লোড হচ্ছে…</div><div class="pager" id="cu-pager"></div></div>`;

    /* ---- রেজিস্টার্ড অ্যাকাউন্ট: ban/unban/delete ---- */
    const loadAcc = async (pg = 1) => {
      const qs = new URLSearchParams({ page: pg });
      if ($('#ac-search').value.trim()) qs.set('q', $('#ac-search').value.trim());
      try {
        const data = await api('/accounts?' + qs);
        $('#ac-table').innerHTML = `<table>
          <tr><th>নাম</th><th>ফোন</th><th>ইমেইল</th><th>অর্ডার</th><th>মোট কেনা</th><th>স্ট্যাটাস</th><th></th></tr>
          ${data.items.map((c) => `<tr>
            <td><strong>${esc(c.name)}</strong><br><small>${dt(c.createdAt)}</small></td>
            <td>${esc(c.phone)}</td>
            <td>${esc(c.email || '—')} ${c.emailVerified ? '<span title="ভেরিফায়েড">✅</span>' : '<span title="ভেরিফাই হয়নি">⏳</span>'}</td>
            <td>${c.orders}</td>
            <td>${bd(c.spent)}</td>
            <td>${c.active ? '<span class="status-badge st-active">সক্রিয়</span>' : '<span class="status-badge st-cancelled">ব্যান</span>'}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm ${c.active ? 'btn-danger' : 'btn-primary'}" data-ban="${c._id}" data-active="${c.active}">${c.active ? '🚫 ব্যান' : '✅ আনব্যান'}</button>
              <button class="btn btn-ghost btn-sm" data-acdel="${c._id}">🗑️</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="7">কোনো রেজিস্টার্ড অ্যাকাউন্ট নেই</td></tr>'}</table>`;
        $('#ac-pager').innerHTML = data.pages > 1 ? Array.from({ length: data.pages }, (_, i) =>
          `<button class="btn btn-sm ${i + 1 === data.page ? 'btn-primary' : 'btn-ghost'}" data-acpg="${i + 1}">${i + 1}</button>`).join('') : '';
        $('#ac-table').onclick = async (e) => {
          const ban = e.target.closest('[data-ban]');
          if (ban) {
            const makeActive = ban.dataset.active !== 'true';
            if (!makeActive && !await confirmBox('অ্যাকাউন্টটা ব্যান হবে — লগইন ও নতুন অর্ডার দুটোই বন্ধ। নিশ্চিত?')) return;
            try {
              await api(`/accounts/${ban.dataset.ban}/status`, { method: 'PUT', body: { active: makeActive } });
              toast(makeActive ? 'আনব্যান হয়েছে ✓' : 'ব্যান হয়েছে ✓');
              loadAcc(pg);
            } catch (err) { toast(err.message, true); }
            return;
          }
          const del = e.target.closest('[data-acdel]');
          if (del) {
            if (!await confirmBox('অ্যাকাউন্টটা স্থায়ীভাবে মুছে যাবে (অর্ডার হিস্টোরি থাকবে)। নিশ্চিত?')) return;
            try {
              await api('/accounts/' + del.dataset.acdel, { method: 'DELETE' });
              toast('অ্যাকাউন্ট মুছে গেছে');
              loadAcc(pg);
            } catch (err) { toast(err.message, true); }
          }
        };
        $('#ac-pager').onclick = (e) => { const b = e.target.closest('[data-acpg]'); if (b) loadAcc(+b.dataset.acpg); };
      } catch (e) { toast(e.message, true); }
    };
    let acT;
    $('#ac-search').oninput = () => { clearTimeout(acT); acT = setTimeout(() => loadAcc(1), 400); };
    loadAcc(1);
    const load = async (pg = 1) => {
      const qs = new URLSearchParams({ page: pg });
      if ($('#cu-search').value.trim()) qs.set('q', $('#cu-search').value.trim());
      try {
        const data = await api('/customers?' + qs);
        $('#cu-table').innerHTML = `<table>
          <tr><th>কাস্টমার</th><th>ঠিকানা</th><th>অর্ডার</th><th>ডেলিভার্ড</th><th>বাতিল</th><th>মোট কেনাকাটা</th><th>শেষ অর্ডার</th></tr>
          ${data.items.map((c) => `<tr style="cursor:pointer" data-cu="${esc(c._id)}" data-cuname="${esc(c.name)}">
            <td><strong>${esc(c.name)}</strong><br><small>${esc(c._id)}</small></td>
            <td style="max-width:220px"><small>${esc(c.address || '')}</small></td>
            <td>${c.orders}</td><td>${c.delivered}</td>
            <td>${c.cancelled ? `<span style="color:var(--danger)">${c.cancelled}</span>` : '0'}</td>
            <td><strong>${bd(c.totalSpent)}</strong></td>
            <td><small>${dt(c.lastOrderAt)}</small></td>
          </tr>`).join('') || '<tr><td colspan="7">কোনো কাস্টমার নেই</td></tr>'}</table>`;
        $('#cu-pager').innerHTML = data.pages > 1 ? Array.from({ length: data.pages }, (_, i) =>
          `<button class="btn btn-sm ${i + 1 === pg ? 'btn-primary' : 'btn-ghost'}" data-pg="${i + 1}">${i + 1}</button>`).join('') : '';
        $('#cu-pager').onclick = (e) => { const b = e.target.closest('[data-pg]'); if (b) load(+b.dataset.pg); };
        $('#cu-table').onclick = async (e) => {
          const row = e.target.closest('[data-cu]');
          if (!row) return;
          const orders = await api('/customers/' + encodeURIComponent(row.dataset.cu) + '/orders');
          modal.open(`<h3>👤 ${esc(row.dataset.cuname)} <small>(${esc(row.dataset.cu)})</small></h3>
            <div class="table-wrap"><table><tr><th>অর্ডার</th><th>আইটেম</th><th>মোট</th><th>পেমেন্ট</th><th>স্ট্যাটাস</th><th>তারিখ</th></tr>
            ${orders.map((o) => `<tr><td><strong>${esc(o.orderNo)}</strong></td>
              <td style="max-width:220px"><small>${o.items.map((i) => esc(i.title) + ' ×' + i.qty).join(', ')}</small></td>
              <td>${bd(o.total)}</td>
              <td><span class="status-badge st-${esc(o.payment.status)}">${esc(o.payment.status)}</span></td>
              <td><span class="status-badge st-${esc(o.status)}">${ST_LABEL[o.status] || o.status}</span></td>
              <td><small>${dt(o.createdAt)}</small></td></tr>`).join('') || '<tr><td colspan="6">নেই</td></tr>'}</table></div>
            <div class="modal-actions"><button class="btn btn-ghost" id="cud-close">বন্ধ</button></div>`);
          $('#cud-close').onclick = modal.close;
        };
      } catch (e) { toast(e.message, true); }
    };
    $('#cu-export').onclick = () => downloadCsv('/customers/export', 'customers.csv');
    let t; $('#cu-search').oninput = () => { clearTimeout(t); t = setTimeout(() => load(1), 400); };
    load(1);
  };

  /* ================= PAYMENT GATEWAYS ================= */
  views.payments = async () => {
    main().innerHTML = '<div class="page-head"><h1 class="page-title">পেমেন্ট গেটওয়ে</h1></div><p>লোড হচ্ছে…</p>';
    try {
      const gws = await api('/gateways');
      const FIELD_LABEL = { appKey: 'App Key', appSecret: 'App Secret', username: 'Username', password: 'Password', storeId: 'Store ID', storePassword: 'Store Password', signatureKey: 'Signature Key', prefix: 'Prefix (২-৫ অক্ষর)', merchantId: 'Merchant ID', merchantNumber: 'Merchant Number', publicKey: 'Public Key', privateKey: 'Private Key', secretKey: 'Secret Key' };
      main().innerHTML = `
        <div class="page-head"><h1 class="page-title">পেমেন্ট গেটওয়ে</h1></div>
        <p style="color:var(--ink-soft);margin-bottom:16px">যেটা চালু করবেন সেটাই চেকআউটে কাস্টমার দেখবে। Sandbox টিক থাকলে টেস্ট মোডে চলবে — লাইভে যাওয়ার সময় টিক তুলে production credentials দিন। Secret ফিল্ড ফাঁকা রাখলে আগের সেভ করা মানই থাকবে।</p>
        ${Object.entries(gws).map(([id, g]) => `
          <form class="card gw-card" data-gw="${id}">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
              <h3>${esc(g.name)} ${g.enabled ? '<span class="status-badge st-active">চালু</span>' : '<span class="status-badge st-draft">বন্ধ</span>'}</h3>
              <div style="display:flex;gap:16px;align-items:center">
                <label style="margin:0"><input type="checkbox" class="gw-sandbox" style="width:auto" ${g.sandbox ? 'checked' : ''}> Sandbox</label>
                <label style="margin:0"><input type="checkbox" class="gw-enabled" style="width:auto" ${g.enabled ? 'checked' : ''} ${g.unsupported ? 'disabled' : ''}> চালু</label>
              </div>
            </div>
            ${g.unsupported ? `<p style="font-size:.87rem;color:var(--ink-soft);background:var(--bg);border-radius:8px;padding:10px 12px;margin-top:8px">ℹ️ ${esc(g.unsupported)}</p>` : `
            <div class="form-2col" style="margin-top:8px">
              ${Object.entries(g.fields).map(([f, v]) => `
                <div><label>${FIELD_LABEL[f] || f}</label>
                <input class="gw-field" data-f="${f}" value="${esc(v.value)}" placeholder="${v.saved ? '•••• সেভ আছে — বদলাতে নতুনটা দিন' : ''}" autocomplete="off"></div>`).join('')}
            </div>
            <div class="modal-actions"><button class="btn btn-primary" type="submit">সেভ করুন</button></div>`}
          </form>`).join('')}
        <form class="card" id="courier-card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
            <h3>🚚 Steadfast কুরিয়ার <span id="cr-badge"></span></h3>
            <div style="display:flex;gap:12px;align-items:center">
              <button type="button" class="btn btn-ghost btn-sm" id="cr-balance">💰 ব্যালেন্স দেখুন</button>
              <label style="margin:0"><input type="checkbox" id="cr-enabled" style="width:auto"> চালু</label>
            </div>
          </div>
          <p style="font-size:.87rem;color:var(--ink-soft);margin-top:6px">চালু করলে অর্ডার detail-এ "Steadfast-এ পাঠান" বাটন আসবে — নাম, ফোন, ঠিকানা, COD amount অটো যাবে। API key পাবেন steadfast.com.bd → Developer API থেকে।</p>
          <div class="form-2col" style="margin-top:8px">
            <div><label>API Key</label><input id="cr-api" autocomplete="off"></div>
            <div><label>Secret Key</label><input id="cr-secret" autocomplete="off"></div>
          </div>
          <div class="modal-actions"><button class="btn btn-primary" type="submit">সেভ করুন</button></div>
        </form>`;

      /* courier card */
      try {
        const cr = await api('/courier');
        $('#cr-enabled').checked = cr.enabled;
        $('#cr-badge').innerHTML = cr.enabled ? '<span class="status-badge st-active">চালু</span>' : '<span class="status-badge st-draft">বন্ধ</span>';
        $('#cr-api').placeholder = cr.apiKeySaved ? '•••• সেভ আছে — বদলাতে নতুনটা দিন' : '';
        $('#cr-secret').placeholder = cr.secretKeySaved ? '•••• সেভ আছে — বদলাতে নতুনটা দিন' : '';
      } catch {}
      $('#courier-card').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/courier', { method: 'PUT', body: {
            enabled: $('#cr-enabled').checked,
            apiKey: $('#cr-api').value.trim(),
            secretKey: $('#cr-secret').value.trim(),
          }});
          toast('কুরিয়ার সেটিংস সেভ হয়েছে ✓');
          views.payments();
        } catch (err) { toast(err.message, true); }
      });
      $('#cr-balance').onclick = async () => {
        try {
          const d = await api('/courier/balance');
          toast(`Steadfast ব্যালেন্স: ৳${d.balance}`);
        } catch (err) { toast(err.message, true); }
      };

      $$('.gw-card').forEach((form) => form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fields = {};
        form.querySelectorAll('.gw-field').forEach((i) => { if (i.value.trim()) fields[i.dataset.f] = i.value.trim(); });
        try {
          await api('/gateways', { method: 'PUT', body: {
            id: form.dataset.gw,
            enabled: form.querySelector('.gw-enabled').checked,
            sandbox: form.querySelector('.gw-sandbox').checked,
            fields,
          }});
          toast('সেভ হয়েছে ✓');
          views.payments();
        } catch (err) { toast(err.message, true); }
      }));
    } catch (e) { toast(e.message, true); }
  };

  /* ================= SETTINGS ================= */
  views.settings = async () => {
    const s = await api('/settings');
    main().innerHTML = `
      <div class="page-head"><h1 class="page-title">সেটিংস</h1></div>
      <form class="card" id="settings-form">
        <div class="form-2col">
          <div><label>সাইটের নাম</label><input id="s-name" value="${esc(s.siteName || '')}"></div>
          <div><label>লোগো (দিলে নামের বদলে লোগো দেখাবে)</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input id="s-logo" value="${esc(s.logo || '')}" placeholder="/uploads/logo.png">
              <input type="file" id="s-logo-file" accept="image/png,image/jpeg,image/webp" hidden>
              <button type="button" class="btn btn-ghost btn-sm" id="s-logo-up">আপলোড</button>
            </div>
            ${s.logo ? `<img src="${esc(s.logo)}" style="max-height:40px;margin-top:8px">` : ''}</div>
          <div><label>ফোন</label><input id="s-phone" value="${esc(s.phone || '')}"></div>
          <div class="full"><label>ঠিকানা</label><input id="s-address" value="${esc(s.address || '')}"></div>
          <div class="full"><label>ফেসবুক পেজ লিংক</label><input id="s-fb" value="${esc(s.facebook || '')}"></div>
          <div><label>COD অগ্রিম (৳)</label><input id="s-cod" type="number" min="0" value="${s.codAdvance ?? 200}"></div>
          <div><label>ফ্রি ডেলিভারি থ্রেশহোল্ড (৳, 0=off)</label><input id="s-free" type="number" min="0" value="${s.freeDeliveryThreshold ?? 0}"></div>
          <div><label>ডেলিভারি: ঢাকার ভেতরে (৳)</label><input id="s-din" type="number" min="0" value="${s.deliveryInside ?? 70}"></div>
          <div><label>ডেলিভারি: ঢাকার বাইরে (৳)</label><input id="s-dout" type="number" min="0" value="${s.deliveryOutside ?? 130}"></div>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" type="submit">সেভ করুন</button></div>
      </form>
      <div class="card">
        <h3>✉️ ইমেইল নোটিফিকেশন</h3>
        <p style="font-size:.87rem;color:var(--ink-soft)">প্রতিটা অর্ডারে আপনার কাছে আর (কাস্টমার ইমেইল দিলে) কাস্টমারের কাছে মেইল যায়। চালু করতে <code>.env</code>-এ Gmail App Password দিন:<br>
        <code>SMTP_USER=yourshop@gmail.com</code> · <code>SMTP_APP_PASSWORD=xxxxxxxxxxxxxxxx</code><br>
        App Password পাবেন: Google Account → Security → 2-Step Verification অন → App passwords। সেট করে সার্ভার restart দিয়ে নিচের বাটনে টেস্ট করুন।</p>
        <button type="button" class="btn btn-ghost" id="test-mail">📧 টেস্ট মেইল পাঠান</button>
      </div>
      <form class="card" id="pass-form">
        <h3>🔐 পাসওয়ার্ড বদলান</h3>
        <p style="font-size:.85rem;color:var(--ink-soft)">Production-এ যাওয়ার আগে .env-এর ডিফল্ট পাসওয়ার্ড অবশ্যই বদলে নিন। বদলের পর .env থেকে ADMIN_PASSWORD মুছে দিলেও চলবে (ওটা শুধু প্রথম bootstrap-এ লাগে)।</p>
        <div class="form-2col">
          <div><label>বর্তমান পাসওয়ার্ড</label><input id="pw-cur" type="password" required autocomplete="current-password"></div>
          <div><label>নতুন পাসওয়ার্ড (কমপক্ষে ৮)</label><input id="pw-new" type="password" required minlength="8" autocomplete="new-password"></div>
        </div>
        <div class="modal-actions"><button class="btn btn-primary" type="submit">পাসওয়ার্ড আপডেট</button></div>
      </form>`;
    $('#test-mail').onclick = async () => {
      const b = $('#test-mail');
      b.disabled = true; b.textContent = 'পাঠাচ্ছি…';
      try {
        const d = await api('/test-mail', { method: 'POST' });
        toast(`✅ টেস্ট মেইল গেছে: ${d.to} — inbox চেক করুন`);
      } catch (e) { toast('❌ ' + e.message, true); }
      b.disabled = false; b.textContent = '📧 টেস্ট মেইল পাঠান';
    };
    $('#s-logo-up').onclick = () => $('#s-logo-file').click();
    $('#s-logo-file').onchange = async (e) => {
      if (!e.target.files.length) return;
      const fd = new FormData();
      fd.append('images', e.target.files[0]);
      try {
        const d = await api('/upload', { method: 'POST', body: fd, isForm: true });
        $('#s-logo').value = d.files[0];
        toast('লোগো আপলোড হয়েছে — সেভ করতে ভুলবেন না');
      } catch (err) { toast(err.message, true); }
    };
    $('#pass-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/change-password', { method: 'PUT', body: { current: $('#pw-cur').value, next: $('#pw-new').value } });
        toast('পাসওয়ার্ড বদলে গেছে ✓ — নতুনটা দিয়ে পরেরবার লগইন করবেন');
        e.target.reset();
      } catch (err) { toast(err.message, true); }
    });
    $('#settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/settings', { method: 'PUT', body: {
          siteName: $('#s-name').value.trim(), logo: $('#s-logo').value.trim(), phone: $('#s-phone').value.trim(),
          address: $('#s-address').value.trim(), facebook: $('#s-fb').value.trim(),
          codAdvance: +$('#s-cod').value, freeDeliveryThreshold: +$('#s-free').value,
          deliveryInside: +$('#s-din').value, deliveryOutside: +$('#s-dout').value,
        }});
        toast('সেটিংস সেভ হয়েছে ✓');
      } catch (err) { toast(err.message, true); }
    });
  };

  /* ================= BOOT ================= */
  document.addEventListener('DOMContentLoaded', async () => {
    if (!getToken()) return showLogin();
    try { await api('/me'); showApp(); } catch { showLogin(); }
  });
})();
