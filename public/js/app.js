/* ============ NetBazar Storefront ============ */
(() => {
  'use strict';

  /* ---------- utils ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bd = (n) => '৳' + Number(n || 0).toLocaleString('bn-BD');
  const api = async (path, opts = {}) => {
    // ...opts আগে, headers পরে — নাহলে opts.headers (যেমন Auth.api-র Authorization)
    // পুরো headers replace করে Content-Type হারিয়ে ফেলত → সার্ভারে body ভুল পার্স হতো
    const res = await fetch('/api' + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'সার্ভারে সমস্যা হয়েছে');
      err.data = data;
      throw err;
    }
    return data;
  };

  /* মোবাইল header: টপে ফুল, স্ক্রল শুরু হলেই compact (লোগো + hamburger),
     hamburger চাপলে সার্চ+মেনু+লগইন dropdown হিসেবে নামে। fixed + body padding —
     তাই কোনো ফাঁকা/লাফ তৈরি হয় না। ডেস্কটপ অপরিবর্তিত। */
  function initMobileHeader() {
    const hdr = document.querySelector('.site-header');
    if (!hdr) return;
    const mq = window.matchMedia('(max-width: 768px)');
    const setH = () => {
      if (!mq.matches) { document.documentElement.style.removeProperty('--hdr-h'); return; }
      const compact = hdr.classList.contains('hdr-compact');
      hdr.classList.remove('hdr-compact');
      document.documentElement.style.setProperty('--hdr-h', hdr.offsetHeight + 'px');
      if (compact) hdr.classList.add('hdr-compact');
    };
    setH();
    window.addEventListener('resize', setH);
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking || !mq.matches) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y > 30 && !hdr.classList.contains('menu-open')) hdr.classList.add('hdr-compact');
        else if (y <= 10) hdr.classList.remove('hdr-compact', 'menu-open');
        ticking = false;
      });
    }, { passive: true });
    const btn = document.getElementById('mob-menu');
    if (btn) btn.addEventListener('click', () => hdr.classList.toggle('menu-open'));
    // মেনু থেকে কোথাও ক্লিক করলে dropdown বন্ধ
    hdr.addEventListener('click', (e) => {
      if (hdr.classList.contains('menu-open') && e.target.closest('a')) hdr.classList.remove('menu-open');
    });
  }

  let toastEl;
  const toast = (msg, err = false) => {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', err);
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
  };

  /* ---------- customer auth store ---------- */
  const Auth = {
    key: 'nb_customer',
    get() {
      try {
        const d = JSON.parse(localStorage.getItem(this.key)) || null;
        if (d && !d.token) { localStorage.removeItem(this.key); return null; } // করাপ্ট state পরিষ্কার
        return d;
      } catch { return null; }
    },
    set(d) { localStorage.setItem(this.key, JSON.stringify(d)); },
    clear() { localStorage.removeItem(this.key); },
    token() { return this.get()?.token || null; },
    async api(path, opts = {}) {
      return api(path, { ...opts, headers: { ...(opts.headers || {}), ...(this.token() ? { Authorization: 'Bearer ' + this.token() } : {}) } });
    },
  };

  /* ---------- cart store ---------- */
  const Cart = {
    key: 'nb_cart',
    get() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } },
    save(items) { localStorage.setItem(this.key, JSON.stringify(items)); this.renderCount(); },
    add(item) {
      const items = this.get();
      const ex = items.find((i) => i.variantId === item.variantId);
      if (ex) ex.qty = Math.min(ex.qty + item.qty, item.stock ?? 99);
      else items.push(item);
      this.save(items);
      toast('কার্টে যোগ হয়েছে ✓');
    },
    remove(variantId) { this.save(this.get().filter((i) => i.variantId !== variantId)); },
    setQty(variantId, qty) {
      const items = this.get();
      const it = items.find((i) => i.variantId === variantId);
      if (it) { it.qty = Math.max(1, qty); this.save(items); }
    },
    clear() { this.save([]); },
    subtotal() { return this.get().reduce((s, i) => s + i.price * i.qty, 0); },
    renderCount() {
      const n = this.get().reduce((s, i) => s + i.qty, 0);
      $$('.cart-count').forEach((el) => (el.textContent = n));
    },
  };

  /* ---------- shared header/footer ---------- */
  async function renderChrome() {
    let settings = {};
    try { settings = await api('/settings'); } catch {}
    const name = settings.siteName || 'NetBazar';
    document.title = document.title.replace('NetBazar', name);

    $('#site-header').innerHTML = `
      <div class="container header-inner">
        <a href="/" class="logo">${settings.logo ? `<img src="${esc(settings.logo)}" alt="${esc(name)}">` : esc(name)}</a>
        <div class="search-wrap">
          <form class="search-form" action="/collection.html" method="get" role="search" autocomplete="off">
            <input type="search" name="q" id="global-search" placeholder="রাউটার, সুইচ, ক্যাবল খুঁজুন…" aria-label="সার্চ">
            <button type="submit">খুঁজুন</button>
          </form>
          <div class="search-drop" id="search-drop" role="listbox"></div>
        </div>
        <div class="header-actions">
          <a class="btn btn-ghost login-link icon-btn" href="/account.html" aria-label="${Auth.get() ? 'আমার অ্যাকাউন্ট' : 'লগইন'}" title="${Auth.get() ? esc(Auth.get().name.split(' ')[0]) : 'লগইন'}" style="padding:9px 12px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>
          </a>
          <a class="cart-btn icon-btn" href="/cart.html" aria-label="কার্ট" style="gap:6px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 3h2.5l2.2 11.2a2 2 0 0 0 2 1.6h6.8a2 2 0 0 0 2-1.6L20 7H6"/></svg>
            <span class="cart-count">0</span>
          </a>
          <button class="hamburger" id="mob-menu" aria-label="মেনু" type="button">☰</button>
        </div>
      </div>
      <nav class="nav-strip"><div class="container" id="nav-collections">
        <a href="/">হোম</a>
      </div></nav>`;

    $('#site-footer').innerHTML = `
      <div class="container">
        <div class="footer-grid">
          <div><h4>${esc(name)}</h4><p style="font-size:.92rem;opacity:.85">নেটওয়ার্কিং ডিভাইসের নির্ভরযোগ্য অনলাইন শপ। রাউটার, সুইচ, LAN — সব আসল পণ্য, ওয়ারেন্টিসহ।</p></div>
          <div><h4>লিংক</h4><a href="/collection.html">সব প্রোডাক্ট</a><a href="/blog.html">ব্লগ</a><a href="/track.html">অর্ডার ট্র্যাক</a></div>
          <div><h4>তথ্য</h4><a href="/page/about">আমাদের সম্পর্কে</a><a href="/page/return-policy">রিটার্ন পলিসি</a><a href="/page/warranty">ওয়ারেন্টি নীতি</a></div>
          <div><h4>যোগাযোগ</h4>
            ${settings.phone ? `<a href="tel:${esc(settings.phone)}">📞 ${esc(settings.phone)}</a>` : ''}
            ${settings.facebook ? `<a href="${esc(settings.facebook)}" rel="noopener" target="_blank">ফেসবুক পেজ</a>` : ''}
            ${settings.address ? `<p style="font-size:.9rem;opacity:.85;margin-top:6px">${esc(settings.address)}</p>` : ''}
          </div>
        </div>
        <div class="footer-bottom"><span>© ${new Date().getFullYear()} ${esc(name)}</span><span style="opacity:.55">client v17</span></div>
      </div>`;

    try {
      const cols = await api('/collections');
      $('#nav-collections').insertAdjacentHTML('beforeend',
        cols.map((c) => `<a href="/c/${esc(c.slug)}">${esc(c.name)}</a>`).join('') +
        `<a href="/blog.html">ব্লগ</a><a href="/track.html">ট্র্যাক</a>`);
    } catch {}
    Cart.renderCount();
    window.__settings = settings;
    initLiveSearch();
  }

  /* ---------- live search (typo-tolerant, server-side fuzzy) ---------- */
  function initLiveSearch() {
    const input = $('#global-search'), drop = $('#search-drop');
    if (!input || !drop) return;
    let timer, ctrl, sel = -1, items = [];

    const close = () => { drop.classList.remove('open'); sel = -1; };
    const render = (list, q) => {
      items = list;
      if (!list.length) {
        drop.innerHTML = `<div class="sd-empty">"${esc(q)}" — কিছু পাওয়া যায়নি</div>`;
      } else {
        drop.innerHTML = list.map((p, i) => `
          <a href="/p/${esc(p.slug)}" data-i="${i}">
            <img src="${esc(p.image || '/img-placeholder.svg')}" alt="" loading="lazy">
            <span><span class="sd-t">${esc(p.title)}</span><br><span class="sd-b">${esc(p.brand || '')}${p.inStock ? '' : ' · স্টক নেই'}</span></span>
            <span class="sd-p">${bd(p.price)}</span>
          </a>`).join('') +
          `<a class="sd-all" href="/collection.html?q=${encodeURIComponent(q)}">সব ফলাফল দেখুন →</a>`;
      }
      drop.classList.add('open');
    };

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(timer);
      if (q.length < 2) return close();
      timer = setTimeout(async () => {
        try {
          if (ctrl) ctrl.abort();
          ctrl = new AbortController();
          const res = await fetch('/api/search/suggest?q=' + encodeURIComponent(q), { signal: ctrl.signal });
          if (res.ok) render(await res.json(), q);
        } catch (e) { if (e.name !== 'AbortError') close(); }
      }, 220);
    });

    input.addEventListener('keydown', (e) => {
      const links = $$('#search-drop a[data-i]');
      if (!drop.classList.contains('open') || !links.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = e.key === 'ArrowDown' ? (sel + 1) % links.length : (sel - 1 + links.length) % links.length;
        links.forEach((l, i) => l.classList.toggle('sel', i === sel));
        links[sel].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && sel >= 0) {
        e.preventDefault();
        location.href = links[sel].href;
      } else if (e.key === 'Escape') close();
    });

    document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) close(); });
    input.addEventListener('focus', () => { if (items.length && input.value.trim().length >= 2) drop.classList.add('open'); });
  }

  /* ---------- reveal on scroll ---------- */
  function observeReveals(root = document) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.08 });
    $$('.reveal', root).forEach((el) => io.observe(el));
  }

  /* ---------- product card ---------- */
  function stockLed(v) {
    const total = v.reduce((s, x) => s + (x.stock || 0), 0);
    if (total <= 0) return `<span class="stock-led"><span class="dot out"></span>স্টক নেই</span>`;
    if (total <= 3) return `<span class="stock-led"><span class="dot low"></span>মাত্র ${total}টা বাকি</span>`;
    return `<span class="stock-led"><span class="dot in"></span>স্টকে আছে</span>`;
  }
  function productCard(p) {
    const v = p.variants?.[0] || {};
    const off = v.comparePrice > v.price ? Math.round(((v.comparePrice - v.price) / v.comparePrice) * 100) : 0;
    return `<a class="product-card reveal" href="/p/${esc(p.slug)}">
      <div class="product-thumb">
        ${off ? `<span class="badge-off">-${off}%</span>` : ''}
        <img src="${esc(p.images?.[0] || '/img-placeholder.svg')}" alt="${esc(p.title)}" loading="lazy">
      </div>
      <div class="product-body">
        ${p.brand ? `<span class="product-brand">${esc(p.brand)}</span>` : ''}
        <span class="product-title">${esc(p.title)}</span>
        ${stockLed(p.variants || [])}
        <div class="product-price">
          <span class="price-now">${bd(v.price)}</span>
          ${off ? `<span class="price-was">${bd(v.comparePrice)}</span>` : ''}
        </div>
      </div>
    </a>`;
  }

  const skelCards = (n = 8) => Array.from({ length: n }, () =>
    '<div class="skel-card"><div class="skel si"></div><div class="skel sl"></div><div class="skel sl short"></div></div>').join('');

  /* ================= PAGES ================= */
  const pages = {
    /* ----- home ----- */
    async home() {
      // পুরনো cached index.html-এ ক্যাটাগরি সেকশন থেকে গেলে সেটা DOM থেকেই মুছে দিই —
      // কোনো ভিজিটরের stale cache-এও "যা খুঁজছেন" আর দেখাবে না
      const legacy = document.getElementById('home-collections');
      if (legacy) {
        const sec = legacy.closest('section');
        if (sec) sec.remove(); else legacy.remove();
      }
      $('#home-featured').innerHTML = skelCards(8);
      $('#home-latest').innerHTML = skelCards(8);
      try {
        const feat = await api('/products?featured=1&limit=8');
        $('#home-featured').innerHTML = feat.items.map(productCard).join('') || '<p class="empty-state">ফিচারড প্রোডাক্ট নেই</p>';
        const latest = await api('/products?sort=newest&limit=8');
        $('#home-latest').innerHTML = latest.items.map(productCard).join('');
      } catch (e) { toast(e.message, true); }
      observeReveals();
    },

    /* ----- collection / search ----- */
    async collection() {
      const slugMatch = location.pathname.match(/^\/c\/([^/]+)/);
      const params = new URLSearchParams(location.search);
      const q = params.get('q') || '';
      const state = { page: 1, sort: params.get('sort') || 'newest' };

      const load = async () => {
        $('#col-grid').innerHTML = skelCards(8);
        const qs = new URLSearchParams({ page: state.page, sort: state.sort, limit: 24 });
        if (slugMatch) qs.set('collection', decodeURIComponent(slugMatch[1]));
        if (q) qs.set('q', q);
        try {
          const data = await api('/products?' + qs);
          $('#col-title').textContent = q ? `"${q}" এর ফলাফল (${data.total})` : ($('#col-title').dataset.name || 'সব প্রোডাক্ট');
          $('#col-grid').innerHTML = data.items.map(productCard).join('') ||
            `<div class="empty-state" style="grid-column:1/-1"><span class="led"><i></i><i></i><i></i><i></i></span><p>কিছু পাওয়া যায়নি</p></div>`;
          $('#col-pager').innerHTML = data.pages > 1
            ? Array.from({ length: data.pages }, (_, i) => `<button class="btn ${i + 1 === state.page ? 'btn-primary' : 'btn-ghost'}" data-pg="${i + 1}">${i + 1}</button>`).join(' ')
            : '';
          observeReveals();
        } catch (e) { toast(e.message, true); }
      };
      if (slugMatch) {
        try {
          const cols = await api('/collections');
          const c = cols.find((x) => x.slug === decodeURIComponent(slugMatch[1]));
          if (c) { $('#col-title').dataset.name = c.name; $('#col-title').textContent = c.name; if (c.description) $('#col-desc').textContent = c.description; }
        } catch {}
      }
      $('#col-sort').value = state.sort;
      $('#col-sort').addEventListener('change', (e) => { state.sort = e.target.value; state.page = 1; load(); });
      $('#col-pager').addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (b) { state.page = +b.dataset.pg; load(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
      load();
    },

    /* ----- product detail ----- */
    async product() {
      const slug = location.pathname.split('/p/')[1];
      // ডাটা আসার আগে skeleton — layout লাফাবে না
      $('#pd-root').innerHTML = `
        <div class="pd-grid">
          <div class="skel" style="aspect-ratio:1;border-radius:14px"></div>
          <div>
            <div class="skel skel-line" style="width:85%"></div>
            <div class="skel skel-line" style="width:60%"></div>
            <div class="skel skel-line" style="width:40%;height:28px;margin-top:16px"></div>
            <div class="skel skel-line" style="width:100%;height:46px;margin-top:22px;border-radius:12px"></div>
          </div>
        </div>`;
      let data;
      try { data = await api('/products/' + encodeURIComponent(slug)); }
      catch (e) { $('#pd-root').innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`; return; }
      const p = data.product;
      const stars = (n) => Array.from({ length: 5 }, (_, i) => `<span class="${i < Math.round(n) ? '' : 'off'}">★</span>`).join('');
      let variant = p.variants.find((v) => v.stock > 0) || p.variants[0];
      let qty = 1;

      document.title = p.seoTitle || p.title;
      const imgs = p.images.length ? p.images : ['/img-placeholder.svg'];

      $('#pd-root').innerHTML = `
        <div class="pd-grid">
          <div class="pd-gallery">
            <div class="pd-main-img"><img id="pd-img" src="${esc(imgs[0])}" alt="${esc(p.title)}"></div>
            ${imgs.length > 1 ? `<div class="pd-thumbs">${imgs.map((im, i) => `<button data-i="${i}" class="${i === 0 ? 'active' : ''}"><img src="${esc(im)}" alt=""></button>`).join('')}</div>` : ''}
          </div>
          <div class="pd-info">
            ${p.brand ? `<span class="eyebrow">${esc(p.brand)}${p.model ? ' · ' + esc(p.model) : ''}</span>` : ''}
            <h1>${esc(p.title)}</h1>
            ${data.rating.count ? `<div style="display:flex;align-items:center;gap:8px;margin-top:6px"><span class="stars">${stars(data.rating.avg)}</span><small style="color:var(--ink-soft)">${data.rating.avg} (${data.rating.count}টা রিভিউ)</small></div>` : ''}
            ${p.shortDescription ? `<p style="color:var(--ink-soft);margin-top:8px">${esc(p.shortDescription)}</p>` : ''}
            <div class="pd-price" id="pd-price"></div>
            ${p.variants.length > 1 ? `<div><strong>ভ্যারিয়েন্ট:</strong><div class="variant-select" id="pd-variants"></div></div>` : ''}
            <div id="pd-stock"></div>
            <div class="qty-row">
              <div class="qty-box">
                <button type="button" id="qty-minus" aria-label="কমান">−</button>
                <input id="qty-input" value="1" inputmode="numeric" aria-label="পরিমাণ">
                <button type="button" id="qty-plus" aria-label="বাড়ান">+</button>
              </div>
            </div>
            <div class="pd-actions">
              <button class="btn btn-primary" id="add-to-cart">কার্টে যোগ করুন</button>
              <button class="btn btn-signal" id="buy-now">এখনই কিনুন</button>
            </div>
            <div class="pd-meta">
              ${p.warranty ? `<div>🛡️ ওয়ারেন্টি: ${esc(p.warranty)}</div>` : ''}
              <div>🚚 ঢাকার ভেতরে ${bd(window.__settings?.deliveryInside ?? 70)}, বাইরে ${bd(window.__settings?.deliveryOutside ?? 130)} ডেলিভারি চার্জ</div>
              <div>💳 বিকাশে ফুল পেমেন্ট, অথবা ${bd(window.__settings?.codAdvance ?? 200)} অগ্রিম দিয়ে ক্যাশ অন ডেলিভারি</div>
            </div>
          </div>
        </div>
        <div class="section">
          <div class="tabs" role="tablist">
            <button class="active" data-tab="desc">বিবরণ</button>
            ${p.specs?.length ? '<button data-tab="specs">স্পেসিফিকেশন</button>' : ''}
            ${p.faqs?.length ? '<button data-tab="faq">সচরাচর প্রশ্ন</button>' : ''}
          </div>
          <div class="tab-panel active" id="tab-desc">${p.description || '<p>বিবরণ যোগ হয়নি।</p>'}</div>
          ${p.specs?.length ? `<div class="tab-panel" id="tab-specs"><table class="spec-table">${p.specs.map((s) => `<tr><td>${esc(s.label)}</td><td>${esc(s.value)}</td></tr>`).join('')}</table></div>` : ''}
          ${p.faqs?.length ? `<div class="tab-panel" id="tab-faq">${p.faqs.map((f) => `<details class="faq-item"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>` : ''}
        </div>
        ${p.aplusHtml ? `<div class="section"><div class="section-head"><div><span class="eyebrow">প্রোডাক্ট স্টোরি</span><h2>বিস্তারিত জানুন</h2></div></div><div class="aplus">${p.aplusHtml}</div></div>` : ''}
        <div class="section" id="reviews-section">
          <div class="section-head"><div><span class="eyebrow">ভ্যারিফাইড কাস্টমার</span><h2>রিভিউ</h2></div></div>
          <div class="card">
            ${data.rating.count ? `<div class="rating-summary"><span class="big">${data.rating.avg}</span><div><span class="stars">${stars(data.rating.avg)}</span><br><small style="color:var(--ink-soft)">${data.rating.count}টা ভ্যারিফাইড রিভিউ</small></div></div>` : ''}
            <div id="review-list">
              ${(data.reviews || []).map((r) => `
                <div class="review-item">
                  <div class="review-head"><span class="rn">${esc(r.name)}</span>
                    ${r.verified ? '<span class="verified-badge">✓ ভ্যারিফাইড ক্রেতা</span>' : ''}
                    <span class="stars">${stars(r.rating)}</span></div>
                  ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
                  <time>${new Date(r.createdAt).toLocaleDateString('bn-BD')}</time>
                </div>`).join('') || '<p class="empty-state" style="padding:20px">এখনো কোনো রিভিউ নেই — প্রথম রিভিউটা আপনার হোক!</p>'}
            </div>
            <details style="margin-top:16px">
              <summary style="cursor:pointer;font-weight:700;color:var(--brand)">✍️ রিভিউ লিখুন (ডেলিভার্ড অর্ডার লাগবে)</summary>
              <form id="review-form" class="review-form-grid" style="margin-top:14px">
                <div><label style="font-weight:600;font-size:.9rem">অর্ডার নম্বর *</label><input id="rv-order" required placeholder="NB1001" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:10px 14px"></div>
                <div><label style="font-weight:600;font-size:.9rem">অর্ডারের ফোন নম্বর *</label><input id="rv-phone" required pattern="(\+8801[3-9][0-9]{8}|01[3-9][0-9]{8})" placeholder="01XXXXXXXXX" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:10px 14px"></div>
                <div><label style="font-weight:600;font-size:.9rem">আপনার নাম *</label><input id="rv-name" required minlength="2" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:10px 14px"></div>
                <div><label style="font-weight:600;font-size:.9rem">রেটিং *</label><div class="star-input" id="rv-stars">${'<span data-s="1">★</span><span data-s="2">★</span><span data-s="3">★</span><span data-s="4">★</span><span data-s="5">★</span>'}</div></div>
                <div class="full"><label style="font-weight:600;font-size:.9rem">মন্তব্য</label><textarea id="rv-comment" rows="3" maxlength="2000" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:10px 14px"></textarea></div>
                <div class="full"><button class="btn btn-primary" type="submit">রিভিউ জমা দিন</button></div>
              </form>
            </details>
          </div>
        </div>
        ${data.related?.length ? `<div class="section"><div class="section-head"><div><span class="eyebrow">আরো দেখুন</span><h2>সম্পর্কিত প্রোডাক্ট</h2></div></div><div class="product-grid">${data.related.map(productCard).join('')}</div></div>` : ''}`;

      const renderVariant = () => {
        const off = variant.comparePrice > variant.price;
        $('#pd-price').innerHTML = `<span class="price-now">${bd(variant.price)}</span>${off ? `<span class="price-was">${bd(variant.comparePrice)}</span>` : ''}`;
        $('#pd-stock').innerHTML = stockLed([variant]);
        $('#add-to-cart').disabled = $('#buy-now').disabled = variant.stock <= 0;
        $$('#pd-variants button').forEach((b) => b.classList.toggle('active', b.dataset.vid === variant._id));
      };
      if (p.variants.length > 1) {
        $('#pd-variants').innerHTML = p.variants.map((v) =>
          `<button data-vid="${v._id}" ${v.stock <= 0 ? 'disabled' : ''}>${esc(v.name)}</button>`).join('');
        $('#pd-variants').addEventListener('click', (e) => {
          const b = e.target.closest('[data-vid]');
          if (b) { variant = p.variants.find((v) => v._id === b.dataset.vid); qty = 1; $('#qty-input').value = 1; renderVariant(); }
        });
      }
      renderVariant();

      const setQty = (n) => { qty = Math.min(Math.max(1, n), Math.max(variant.stock, 1)); $('#qty-input').value = qty; };
      $('#qty-minus').addEventListener('click', () => setQty(qty - 1));
      $('#qty-plus').addEventListener('click', () => setQty(qty + 1));
      $('#qty-input').addEventListener('change', (e) => setQty(parseInt(e.target.value) || 1));

      const cartItem = () => ({
        productId: p._id, variantId: variant._id, qty,
        title: p.title, variantName: variant.name, price: variant.price,
        image: imgs[0], slug: p.slug, stock: variant.stock,
      });
      $('#add-to-cart').addEventListener('click', () => Cart.add(cartItem()));
      $('#buy-now').addEventListener('click', () => { Cart.add(cartItem()); location.href = '/checkout.html'; });

      $('.tabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
        $$('.tab-panel').forEach((x) => x.classList.toggle('active', x.id === 'tab-' + b.dataset.tab));
      });
      if (imgs.length > 1) $('.pd-thumbs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]');
        if (b) { $('#pd-img').src = imgs[+b.dataset.i]; $$('.pd-thumbs button').forEach((x) => x.classList.toggle('active', x === b)); }
      });

      /* review form */
      let rvRating = 0;
      $('#rv-stars').addEventListener('click', (e) => {
        const sp = e.target.closest('[data-s]');
        if (!sp) return;
        rvRating = +sp.dataset.s;
        $$('#rv-stars span').forEach((x) => x.classList.toggle('on', +x.dataset.s <= rvRating));
      });
      $('#review-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!rvRating) return toast('রেটিং দিন (স্টারে ক্লিক করুন)', true);
        try {
          const r = await api('/reviews', { method: 'POST', body: {
            productId: p._id,
            orderNo: $('#rv-order').value.trim(),
            phone: $('#rv-phone').value.trim(),
            name: $('#rv-name').value.trim(),
            rating: rvRating,
            comment: $('#rv-comment').value.trim(),
          }});
          toast('রিভিউ যোগ হয়েছে — ধন্যবাদ! ✓');
          const rv = r.review;
          const html = `<div class="review-item"><div class="review-head"><span class="rn">${esc(rv.name)}</span><span class="verified-badge">✓ ভ্যারিফাইড ক্রেতা</span><span class="stars">${stars(rv.rating)}</span></div>${rv.comment ? `<p>${esc(rv.comment)}</p>` : ''}<time>এইমাত্র</time></div>`;
          const list = $('#review-list');
          if (list.querySelector('.empty-state')) list.innerHTML = html;
          else list.insertAdjacentHTML('afterbegin', html);
          e.target.reset(); rvRating = 0;
          $$('#rv-stars span').forEach((x) => x.classList.remove('on'));
        } catch (err) { toast(err.message, true); }
      });
      observeReveals();
    },

    /* ----- cart ----- */
    cart() {
      const render = () => {
        const items = Cart.get();
        if (!items.length) {
          $('#cart-root').innerHTML = `<div class="empty-state card"><span class="led"><i></i><i></i><i></i><i></i></span><p>কার্ট খালি</p><a class="btn btn-primary" href="/collection.html" style="margin-top:14px">শপিং শুরু করুন</a></div>`;
          return;
        }
        $('#cart-root').innerHTML = `
          <div class="cart-layout">
            <div class="card">
              <h2 style="font-family:var(--font-display);margin-bottom:8px">কার্ট (${items.length})</h2>
              ${items.map((i) => `
                <div class="cart-item">
                  <img src="${esc(i.image || '/img-placeholder.svg')}" alt="">
                  <div>
                    <div class="t"><a href="/p/${esc(i.slug)}">${esc(i.title)}</a></div>
                    ${i.variantName && i.variantName !== 'Default' ? `<div class="v">${esc(i.variantName)}</div>` : ''}
                    <div class="v">${bd(i.price)} × ${i.qty}</div>
                    <button class="remove-btn" data-rm="${esc(i.variantId)}">মুছুন</button>
                  </div>
                  <div class="qty-box">
                    <button data-dec="${esc(i.variantId)}">−</button>
                    <input value="${i.qty}" readonly>
                    <button data-inc="${esc(i.variantId)}">+</button>
                  </div>
                </div>`).join('')}
            </div>
            <div class="card">
              <div class="summary-row"><span>সাবটোটাল</span><strong>${bd(Cart.subtotal())}</strong></div>
              <div class="summary-row"><span>ডেলিভারি</span><span>চেকআউটে হিসাব হবে</span></div>
              <div class="summary-row total"><span>মোট</span><span>${bd(Cart.subtotal())}</span></div>
              <a href="/checkout.html" class="btn btn-primary" style="width:100%;margin-top:16px">চেকআউট করুন</a>
            </div>
          </div>`;
      };
      $('#cart-root').addEventListener('click', (e) => {
        const co = e.target.closest('a[href="/checkout.html"]');
        if (co && !Auth.get()) {
          e.preventDefault();
          toast('🔒 অর্ডারের নিরাপত্তার জন্য আগে লগইন করুন — আপনার কার্ট save থাকবে');
          setTimeout(() => { location.href = '/account.html?next=' + encodeURIComponent('/checkout.html'); }, 1100);
          return;
        }
        const rm = e.target.closest('[data-rm]'); if (rm) { Cart.remove(rm.dataset.rm); render(); return; }
        const inc = e.target.closest('[data-inc]'); if (inc) { const it = Cart.get().find((x) => x.variantId === inc.dataset.inc); Cart.setQty(inc.dataset.inc, it.qty + 1); render(); return; }
        const dec = e.target.closest('[data-dec]'); if (dec) { const it = Cart.get().find((x) => x.variantId === dec.dataset.dec); Cart.setQty(dec.dataset.dec, it.qty - 1); render(); }
      });
      render();
    },

    /* ----- checkout ----- */
    checkout() {
      // অর্ডারে অ্যাকাউন্ট বাধ্যতামূলক — লগইন/রেজিস্ট্রেশনের পর ঠিক এখানেই ফেরত আসবে (কার্ট save থাকে)
      if (!Auth.get()) {
        location.href = '/account.html?next=' + encodeURIComponent('/checkout.html');
        return;
      }
      const params = new URLSearchParams(location.search);
      if (params.get('payment') === 'failed') toast('পেমেন্ট সম্পন্ন হয়নি — আবার চেষ্টা করুন', true);

      const items = Cart.get();
      if (!items.length) { location.href = '/cart.html'; return; }
      const s = window.__settings || {};
      let coupon = null;

      // লগইন থাকলে prefill
      const me = Auth.get();
      if (me) {
        $('#f-name').value = me.name || '';
        $('#f-phone').value = me.phone || '';
        Auth.api('/me').then((prof) => {
          if (prof.address && !$('#f-address').value) $('#f-address').value = prof.address;
          if (prof.name && !$('#f-name').value) $('#f-name').value = prof.name;
          if (prof.email && !$('#f-email').value) $('#f-email').value = prof.email;
        }).catch(() => {});
      }

      const calc = () => {
        const subtotal = Cart.subtotal();
        const area = $('input[name="area"]:checked')?.value || 'inside_dhaka';
        let delivery = area === 'inside_dhaka' ? (s.deliveryInside ?? 70) : (s.deliveryOutside ?? 130);
        if (s.freeDeliveryThreshold > 0 && subtotal >= s.freeDeliveryThreshold) delivery = 0;
        let discount = 0;
        if (coupon) {
          discount = coupon.type === 'percent' ? Math.floor((subtotal * coupon.value) / 100) : coupon.value;
          if (coupon.type === 'percent' && coupon.maxDiscount > 0) discount = Math.min(discount, coupon.maxDiscount);
          discount = Math.min(discount, subtotal);
        }
        const total = subtotal - discount + delivery;
        const method = $('input[name="pay"]:checked')?.value || 'bkash_full';
        const advance = method === 'bkash_full' ? total : Math.min(s.codAdvance ?? 200, total);
        $('#sum-sub').textContent = bd(subtotal);
        $('#sum-del').textContent = delivery === 0 ? 'ফ্রি' : bd(delivery);
        $('#sum-disc-row').style.display = discount ? 'flex' : 'none';
        $('#sum-disc').textContent = '−' + bd(discount);
        $('#sum-total').textContent = bd(total);
        const gwsOn = (s.gateways || []).length > 0;
        const noPayNow = !gwsOn || (method === 'cod_advance' && advance === 0);
        $('#gw-wrap').style.display = noPayNow ? 'none' : '';
        if (method === 'cod_advance' && advance === 0) {
          $('#pay-note').innerHTML = `কোনো অগ্রিম লাগবে না — পুরো <strong>${bd(total)}</strong> পণ্য হাতে পেয়ে দেবেন ✓`;
        } else if (!gwsOn) {
          $('#pay-note').innerHTML = `অর্ডার কনফার্ম হবে — <strong>${bd(total)}</strong> ডেলিভারিতে/আমাদের সাথে কথা বলে দেবেন`;
        } else if (method === 'bkash_full') {
          $('#pay-note').innerHTML = `এখন অনলাইনে দেবেন: <strong>${bd(advance)}</strong>`;
        } else {
          $('#pay-note').innerHTML = `অনলাইনে অগ্রিম: <strong>${bd(advance)}</strong> · ডেলিভারিতে: <strong>${bd(total - advance)}</strong>`;
        }
      };

      // enabled gateway গুলো দেখাও
      const gws = s.gateways || [];
      $('#gw-list').innerHTML = gws.map((g, i) => `
        <label class="gw-option"><input type="radio" name="gw" value="${esc(g.id)}" ${i === 0 ? 'checked' : ''}>${esc(g.name)}</label>`).join('');
      // কোনো gateway চালু না থাকলে "অনলাইনে ফুল পেমেন্ট" অপশনই দেখাবে না — শুধু COD
      if (!gws.length) {
        const fullOpt = document.querySelector('input[name="pay"][value="bkash_full"]');
        if (fullOpt) {
          fullOpt.closest('label').style.display = 'none';
          const cod = document.querySelector('input[name="pay"][value="cod_advance"]');
          if (cod) { cod.checked = true; cod.dispatchEvent(new Event('change', { bubbles: true })); }
        }
      }

      $('#co-items').innerHTML = items.map((i) => `
        <div class="cart-item">
          <img src="${esc(i.image || '/img-placeholder.svg')}" alt="">
          <div><div class="t">${esc(i.title)}</div><div class="v">${i.variantName !== 'Default' ? esc(i.variantName) + ' · ' : ''}${bd(i.price)} × ${i.qty}</div></div>
          <strong>${bd(i.price * i.qty)}</strong>
        </div>`).join('');

      $$('input[name="area"], input[name="pay"]').forEach((el) => el.addEventListener('change', calc));

      $('#coupon-apply').addEventListener('click', async () => {
        const code = $('#coupon-input').value.trim();
        if (!code) return;
        try {
          coupon = await api('/coupon/check', { method: 'POST', body: { code, subtotal: Cart.subtotal() } });
          toast(`কুপন "${coupon.code}" প্রয়োগ হয়েছে ✓`);
          calc();
        } catch (e) { coupon = null; calc(); toast(e.message, true); }
      });

      $('#checkout-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const addr = $('#f-address').value.trim();
        if (!/^[A-Za-z0-9\s,;:]+$/.test(addr)) {
          return toast('ঠিকানা ইংরেজিতে লিখুন — শুধু অক্ষর, সংখ্যা, কমা(,) সেমিকোলন(;) কোলন(:) চলবে', true);
        }
        const btn = $('#place-order');
        btn.disabled = true; btn.textContent = 'অর্ডার হচ্ছে…';
        try {
          const order = await Auth.api('/checkout', {
            method: 'POST',
            body: {
              items: items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })),
              customer: {
                name: $('#f-name').value.trim(),
                phone: $('#f-phone').value.trim(),
                email: $('#f-email').value.trim(),
                address: $('#f-address').value.trim(),
                area: $('input[name="area"]:checked').value,
                note: $('#f-note').value.trim(),
              },
              paymentMethod: $('input[name="pay"]:checked').value,
              couponCode: coupon?.code,
              website: $('#f-website').value, // honeypot
            },
          });
          if (order.noPayment) {
            // অগ্রিম ০ বা gateway নেই — অর্ডার কনফার্মড, পেমেন্ট পেজ লাগবে না
            Cart.clear();
            location.href = `/order-success.html?orderNo=${order.orderNo}&phone=${encodeURIComponent($('#f-phone').value.trim().replace(/^\+88/, ''))}`;
            return;
          }
          btn.textContent = 'পেমেন্ট পেজে নিয়ে যাচ্ছি…';
          const gw = $('input[name="gw"]:checked')?.value || 'bkash';
          const pay = await api('/payment/create', { method: 'POST', body: { orderId: order.orderId, gateway: gw } });
          Cart.clear();
          location.href = pay.url;
        } catch (err) {
          if (err.data && (err.data.error || '').includes('লগইন')) {
            toast('🔒 অর্ডারের নিরাপত্তার জন্য আগে লগইন করুন');
            setTimeout(() => { location.href = '/account.html?next=' + encodeURIComponent('/checkout.html'); }, 1000);
            return;
          }
          toast(err.message, true);
          btn.disabled = false; btn.textContent = 'অর্ডার কনফার্ম করুন';
        }
      });
      calc();
    },

    /* ----- order success ----- */
    async success() {
      const p = new URLSearchParams(location.search);
      const orderNo = p.get('orderNo'), phone = p.get('phone');
      const denied = () => {
        document.querySelector('main').innerHTML = `
          <div class="card" style="max-width:520px;margin:40px auto;text-align:center;padding:36px 26px">
            <h1 style="font-family:var(--font-display);margin-bottom:8px">⛔ অ্যাক্সেস নেই</h1>
            <p style="color:var(--ink-soft)">এই অর্ডারটা পাওয়া যায়নি অথবা এটা দেখার অনুমতি আপনার নেই। নিজের অর্ডার দেখতে অর্ডার নম্বর আর যে ফোন নম্বরে অর্ডার করেছেন সেটা দিয়ে ট্র্যাক করুন।</p>
            <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap">
              <a href="/track.html" class="btn btn-primary">অর্ডার ট্র্যাক করুন</a>
              <a href="/" class="btn btn-ghost">হোমে ফিরুন</a>
            </div>
          </div>`;
      };
      if (!orderNo || !phone) return denied();
      try {
        const o = await api('/orders/track', { method: 'POST', body: { orderNo, phone } });
        $('#suc-details').innerHTML = `
          <div class="summary-row"><span>অর্ডার নম্বর</span><strong>${esc(o.orderNo)}</strong></div>
          <div class="summary-row"><span>পেমেন্ট</span><strong>${o.payment.status === 'paid' ? '✅ পেইড' : o.payment.status}${o.payment.trxID ? ` (TrxID: ${esc(o.payment.trxID)})` : ''}</strong></div>
          ${o.codDue > 0 ? `<div class="summary-row"><span>ডেলিভারিতে দিতে হবে</span><strong>${bd(o.codDue)}</strong></div>` : ''}
          <div class="summary-row total"><span>মোট</span><span>${bd(o.total)}</span></div>`;
      } catch (e) { denied(); }
    },

    /* ----- tracking ----- */
    track() {
      $('#track-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const o = await api('/orders/track', {
            method: 'POST',
            body: { orderNo: $('#t-order').value.trim(), phone: $('#t-phone').value.trim() },
          });
          const labels = { awaiting_payment: 'পেমেন্টের অপেক্ষায়', confirmed: 'কনফার্মড', processing: 'প্রসেসিং', shipped: 'কুরিয়ারে', delivered: 'ডেলিভার্ড', cancelled: 'বাতিল', returned: 'রিটার্নড' };
          $('#track-result').innerHTML = `
            <div class="card" style="margin-top:20px">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                <h3 style="font-family:var(--font-display)">অর্ডার ${esc(o.orderNo)}</h3>
                <span class="status-badge st-${esc(o.status)}">${labels[o.status] || o.status}</span>
              </div>
              ${o.courier?.trackingId ? `<p style="margin-top:8px">কুরিয়ার: ${esc(o.courier.name || '')} · ট্র্যাকিং: <strong>${esc(o.courier.trackingId)}</strong></p>` : ''}
              ${o.codDue > 0 && o.status !== 'delivered' ? `<p style="margin-top:6px">ডেলিভারিতে দিতে হবে: <strong>${bd(o.codDue)}</strong></p>` : ''}
              <ul class="timeline">
                ${o.statusHistory.slice().reverse().map((h) => `<li><strong>${labels[h.status] || h.status}</strong>${h.note ? ` — ${esc(h.note)}` : ''}<br><small style="color:var(--ink-soft)">${new Date(h.at).toLocaleString('bn-BD')}</small></li>`).join('')}
              </ul>
            </div>`;
        } catch (err) { $('#track-result').innerHTML = `<p class="empty-state">${esc(err.message)}</p>`; }
      });
    },

    /* ----- blog list / post / cms page ----- */
    async blog() {
      $('#blog-grid').innerHTML = skelCards(6);
      try {
        const posts = await api('/blog');
        $('#blog-grid').innerHTML = posts.map((b) => `
          <a class="blog-card reveal" href="/blog/${esc(b.slug)}">
            ${b.coverImage ? `<img src="${esc(b.coverImage)}" alt="" loading="lazy">` : ''}
            <div class="bb"><h3>${esc(b.title)}</h3><p>${esc(b.excerpt || '')}</p></div>
          </a>`).join('') || '<p class="empty-state">কোনো পোস্ট নেই</p>';
        observeReveals();
      } catch (e) { toast(e.message, true); }
    },
    async blogpost() {
      const slug = location.pathname.split('/blog/')[1];
      try {
        const b = await api('/blog/' + encodeURIComponent(slug));
        document.title = b.title;
        $('#post-root').innerHTML = `<h1>${esc(b.title)}</h1>${b.coverImage ? `<img src="${esc(b.coverImage)}" alt="">` : ''}${b.content}`;
      } catch (e) { $('#post-root').innerHTML = `<p>${esc(e.message)}</p>`; }
    },
    async cmspage() {
      const slug = location.pathname.split('/page/')[1];
      try {
        const pg = await api('/pages/' + encodeURIComponent(slug));
        document.title = pg.title;
        $('#page-root').innerHTML = `<h1>${esc(pg.title)}</h1>${pg.content}`;
      } catch (e) { $('#page-root').innerHTML = `<p>${esc(e.message)}</p>`; }
    },
    /* ----- account (login/register/profile/orders) ----- */
    account() {
      const root = $('#account-root');
      const ST = { awaiting_payment: 'পেমেন্টের অপেক্ষায়', confirmed: 'কনফার্মড', processing: 'প্রসেসিং', shipped: 'কুরিয়ারে', delivered: 'ডেলিভার্ড', cancelled: 'বাতিল', returned: 'রিটার্নড' };
      // ?next= sanitize — শুধু নিজের সাইটের path (open redirect ব্লক)
      const rawNext = new URLSearchParams(location.search).get('next') || '';
      const nextUrl = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '';
      const done = (d) => {
        Auth.set(d);
        location.href = nextUrl || '/account.html';
      };
      if (Auth.get() && nextUrl) { location.href = nextUrl; return; }

      /* ---- OTP ভিউ (mode: 'verify' | 'reset') — কাউন্টডাউন + resend cooldown ---- */
      const renderOtp = (email, mode = 'verify') => {
        root.innerHTML = `
          <div class="card" style="max-width:460px;margin:auto">
            <h2 style="font-family:var(--font-display);margin-bottom:6px">📧 ${mode === 'reset' ? 'পাসওয়ার্ড রিসেট' : 'ইমেইল ভেরিফাই করুন'}</h2>
            <p style="color:var(--ink-soft);font-size:.92rem"><strong>${esc(email)}</strong>-এ ৬ ডিজিটের কোড পাঠানো হয়েছে। Spam ফোল্ডারও দেখুন।
              <span id="otp-timer" style="font-weight:700;color:var(--brand)"></span></p>
            <form id="otp-form" class="form-grid" style="margin-top:14px">
              <div><label>ভেরিফিকেশন কোড</label>
                <input id="otp-code" required pattern="[0-9]{6}" maxlength="6" inputmode="numeric" autocomplete="one-time-code"
                  style="letter-spacing:10px;font-size:1.4rem;text-align:center;font-weight:700"></div>
              ${mode === 'reset' ? '<div><label>নতুন পাসওয়ার্ড (কমপক্ষে ৮)</label><input id="otp-newpass" type="password" required minlength="8"></div>' : ''}
              <button class="btn btn-primary" type="submit">${mode === 'reset' ? 'পাসওয়ার্ড বদলান' : 'ভেরিফাই করুন'}</button>
            </form>
            <p style="margin-top:14px;font-size:.9rem">কোড আসেনি?
              <button type="button" id="otp-resend" class="btn btn-ghost btn-sm" style="padding:5px 12px">কোড আবার পাঠান</button></p>
          </div>`;
        // ১০ মিনিটের মেয়াদ কাউন্টডাউন
        let left = 10 * 60;
        const timerEl = $('#otp-timer');
        const tick = () => {
          if (!document.body.contains(timerEl)) return;
          const m = String(Math.floor(left / 60)).padStart(2, '0'), sec = String(left % 60).padStart(2, '0');
          timerEl.textContent = left > 0 ? `⏳ ${m}:${sec}` : '— কোডের মেয়াদ শেষ, নতুন কোড নিন';
          if (left-- > 0) setTimeout(tick, 1000);
        };
        tick();
        // resend: ৬০ সেকেন্ড cooldown (সার্ভারেও একই নিয়ম আছে)
        const rs = $('#otp-resend');
        const cooldown = () => {
          let c = 60;
          rs.disabled = true;
          const iv = setInterval(() => {
            if (!document.body.contains(rs)) return clearInterval(iv);
            rs.textContent = `আবার পাঠান (${c}s)`;
            if (c-- <= 0) { clearInterval(iv); rs.disabled = false; rs.textContent = 'কোড আবার পাঠান'; }
          }, 1000);
        };
        cooldown();
        rs.addEventListener('click', async () => {
          try {
            await api(mode === 'reset' ? '/auth/forgot' : '/auth/resend-otp', { method: 'POST', body: { email } });
            toast('নতুন কোড পাঠানো হয়েছে');
            left = 10 * 60;
            cooldown();
          } catch (err) { toast(err.message, true); }
        });
        $('#otp-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            const body = { email, otp: $('#otp-code').value.trim() };
            let d;
            if (mode === 'reset') {
              body.newPassword = $('#otp-newpass').value;
              d = await api('/auth/reset', { method: 'POST', body });
              toast('পাসওয়ার্ড বদলে গেছে ✓');
            } else {
              d = await api('/auth/verify-otp', { method: 'POST', body });
              toast('অ্যাকাউন্ট ভেরিফায়েড ✓');
            }
            done(d); // টোকেন এসেছে — অটো লগইন + next-এ ফেরত
          } catch (err) { toast(err.message, true); }
        });
      };

      /* ---- লগইন/রেজিস্টার ---- */
      const renderAuth = () => {
        root.innerHTML = `
          ${nextUrl ? '<p style="text-align:center;background:#fff8e8;border:1px solid #f3dfae;border-radius:10px;padding:10px 14px;margin-bottom:14px">🛒 অর্ডার কনফার্ম করতে লগইন বা অ্যাকাউন্ট লাগবে — আপনার কার্ট save করা আছে, শেষ করেই চেকআউটে ফিরবেন।</p>' : ''}
          <div class="card">
            <div class="tabs" style="margin-bottom:18px">
              <button class="active" data-t="login" type="button">লগইন</button>
              <button data-t="register" type="button">নতুন অ্যাকাউন্ট</button>
            </div>
            <form id="auth-login" class="form-grid">
              <div><label>ইমেইল</label><input id="lg-email" type="email" required maxlength="120" placeholder="you@gmail.com" autocomplete="email"></div>
              <div><label>পাসওয়ার্ড</label><input id="lg-pass" type="password" required autocomplete="current-password"></div>
              <button class="btn btn-primary" type="submit">লগইন করুন</button>
              <p style="text-align:right;margin-top:-4px"><a href="#" id="lg-forgot" style="font-size:.88rem;color:var(--brand);font-weight:600">পাসওয়ার্ড ভুলে গেছেন?</a></p>
            </form>
            <form id="auth-register" class="form-grid" hidden>
              <div><label>আপনার নাম</label><input id="rg-name" required minlength="2"></div>
              <div><label>ফোন নম্বর</label><input id="rg-phone" required pattern="(\+8801[3-9][0-9]{8}|01[3-9][0-9]{8})" placeholder="01XXXXXXXXX" inputmode="tel"></div>
              <div><label>ইমেইল (ভেরিফিকেশন কোড যাবে)</label><input id="rg-email" type="email" required maxlength="120" placeholder="you@gmail.com"></div>
              <div><label>পাসওয়ার্ড (কমপক্ষে ৮ ক্যারেক্টার)</label><input id="rg-pass" type="password" required minlength="8"></div>
              <button class="btn btn-primary" type="submit">অ্যাকাউন্ট খুলুন</button>
            </form>
            <p style="font-size:.85rem;color:var(--ink-soft);margin-top:14px">অর্ডার করতে ভেরিফায়েড অ্যাকাউন্ট লাগে — এতে আপনার অর্ডার হিস্টোরি সুরক্ষিত থাকে আর চেকআউটে তথ্য অটো-ফিল হয়।</p>
          </div>`;
        root.querySelector('.tabs').addEventListener('click', (e) => {
          const b = e.target.closest('[data-t]');
          if (!b) return;
          root.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
          $('#auth-login').hidden = b.dataset.t !== 'login';
          $('#auth-register').hidden = b.dataset.t !== 'register';
        });
        $('#auth-login').addEventListener('submit', async (e) => {
          e.preventDefault();
          const email = $('#lg-email').value.trim().toLowerCase();
          try {
            const d = await api('/auth/login', { method: 'POST', body: { email, password: $('#lg-pass').value } });
            done(d);
          } catch (err) {
            if (err.data?.needVerify) {
              toast('আগে ইমেইল ভেরিফাই করুন', true);
              try { await api('/auth/resend-otp', { method: 'POST', body: { email } }); } catch {}
              renderOtp(email, 'verify');
            } else toast(err.message, true);
          }
        });
        $('#lg-forgot').addEventListener('click', async (e) => {
          e.preventDefault();
          const email = ($('#lg-email').value.trim() || prompt('আপনার অ্যাকাউন্টের ইমেইল দিন:') || '').toLowerCase();
          if (!email) return;
          try {
            await api('/auth/forgot', { method: 'POST', body: { email } });
            toast('এই ইমেইলে অ্যাকাউন্ট থাকলে কোড গেছে');
            renderOtp(email, 'reset');
          } catch (err) { toast(err.message, true); }
        });
        $('#auth-register').addEventListener('submit', async (e) => {
          e.preventDefault();
          const phone = $('#rg-phone').value.trim();
          try {
            const d = await api('/auth/register', { method: 'POST', body: {
              name: $('#rg-name').value.trim(),
              phone,
              email: $('#rg-email').value.trim(),
              password: $('#rg-pass').value,
            }});
            toast('কোড পাঠানো হয়েছে — ইমেইল চেক করুন');
            renderOtp(d.email, 'verify');
          } catch (err) {
            if (err.data?.pendingVerify) renderOtp($('#rg-email').value.trim().toLowerCase(), 'verify');
            toast(err.message, true);
          }
        });
      };

      const renderAccount = async () => {
        let prof, orders;
        try {
          [prof, orders] = await Promise.all([Auth.api('/me'), Auth.api('/me/orders')]);
        } catch (e) { Auth.clear(); return renderAuth(); }
        root.innerHTML = `
          <div class="card" style="margin-bottom:18px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
              <div><span class="eyebrow">আমার অ্যাকাউন্ট</span>
              <h2 style="font-family:var(--font-display)">${esc(prof.name)}</h2>
              <p style="color:var(--ink-soft)">${esc(prof.phone)}</p></div>
              <button class="btn btn-ghost" id="ac-logout">লগআউট</button>
            </div>
            <details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700;color:var(--brand)">প্রোফাইল এডিট করুন</summary>
              <form id="ac-form" class="form-grid" style="margin-top:12px">
                <div><label>নাম</label><input id="ac-name" value="${esc(prof.name)}" minlength="2"></div>
                <div><label>ঠিকানা (ইংরেজিতে — চেকআউটে অটো-ফিল হবে)</label><textarea id="ac-address" rows="2" pattern="[A-Za-z0-9\\s,;:]+">${esc(prof.address || '')}</textarea></div>
                <div><label>নতুন পাসওয়ার্ড (বদলাতে চাইলে)</label><input id="ac-pass" type="password" minlength="6" placeholder="ফাঁকা রাখলে আগেরটাই থাকবে"></div>
                <button class="btn btn-primary" type="submit">সেভ করুন</button>
              </form>
            </details>
          </div>
          <div class="card">
            <h3 style="font-family:var(--font-display);margin-bottom:12px">অর্ডার হিস্টোরি (${orders.length})</h3>
            ${orders.map((o) => `
              <div class="cart-item" style="grid-template-columns:64px 1fr auto">
                <img src="${esc(o.items[0]?.image || '/img-placeholder.svg')}" alt="">
                <div>
                  <div class="t">${esc(o.orderNo)} <span class="status-badge st-${esc(o.status)}">${ST[o.status] || o.status}</span></div>
                  <div class="v">${o.items.map((i) => esc(i.title) + ' ×' + i.qty).join(', ')}</div>
                  <div class="v">${new Date(o.createdAt).toLocaleDateString('bn-BD')} · পেমেন্ট: ${esc(o.payment.status)}${o.codDue > 0 && o.status !== 'delivered' ? ' · ডেলিভারিতে ' + bd(o.codDue) : ''}</div>
                  ${o.courier?.trackingId ? `<div class="v">কুরিয়ার: ${esc(o.courier.name || '')} · ${esc(o.courier.trackingId)}</div>` : ''}
                </div>
                <strong>${bd(o.total)}</strong>
              </div>`).join('') || '<p class="empty-state">এখনো কোনো অর্ডার নেই</p>'}
          </div>`;
        $('#ac-logout').onclick = () => { Auth.clear(); location.reload(); };
        $('#ac-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            const body = { name: $('#ac-name').value.trim(), address: $('#ac-address').value.trim() };
            if ($('#ac-pass').value) body.password = $('#ac-pass').value;
            const d = await Auth.api('/me', { method: 'PUT', body });
            const cur = Auth.get(); Auth.set({ ...cur, name: d.name });
            toast('প্রোফাইল সেভ হয়েছে ✓');
          } catch (err) { toast(err.message, true); }
        });
      };

      if (Auth.get()) renderAccount(); else renderAuth();
    },

  };

  /* ---------- boot ---------- */
  console.log('NetBazar client v17');
  document.addEventListener('DOMContentLoaded', async () => {
    // visit beacon — session-প্রতি একবার
    try {
      if (!sessionStorage.getItem('nb_v')) {
        sessionStorage.setItem('nb_v', '1');
        fetch('/api/t', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      }
    } catch {}
    await renderChrome();
    initMobileHeader();
    const page = document.body.dataset.page;
    if (pages[page]) {
      try { await pages[page](); } catch (e) {
        console.error('page init error:', e);
        const mainEl = document.querySelector('main');
        if (mainEl && !mainEl.innerHTML.trim()) {
          mainEl.innerHTML = `<div class="card" style="max-width:520px;margin:40px auto;text-align:center;padding:30px">
            <p style="font-weight:700;margin-bottom:8px">পেজ লোডে সমস্যা হয়েছে</p>
            <p style="color:var(--ink-soft);font-size:.9rem">${esc(e.message)}</p>
            <a href="/" class="btn btn-primary" style="margin-top:14px">হোমে ফিরুন</a></div>`;
        }
      }
    }
  });
})();
