/* PIZZAKY.AJA — admin dashboard (vanilla JS, server-backed). */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const compact = (n) => {
    const v = Number(n || 0);
    if (v >= 1e9) return (v / 1e9).toFixed(1).replace('.0', '') + 'M';
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace('.0', '') + 'jt';
    if (v >= 1e3) return Math.round(v / 1e3) + 'rb';
    return String(v);
  };
  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isoDaysAgo = (days) => isoDate(new Date(Date.now() - days * 86400000));
  const formatDate = (iso, withTime = true) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('id-ID', withTime
      ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const STATUS_FALLBACK = {
    new: 'Pesanan Baru', processing: 'Diproses', making: 'Sedang Dibuat', ready: 'Siap Diambil',
    shipping: 'Dalam Pengiriman', done: 'Selesai', cancelled: 'Dibatalkan',
  };
  let statusMap = { ...STATUS_FALLBACK };

  const state = {
    admin: null,
    page: 'dashboard',
    products: [],
    categories: [],
    settings: null,
    editingProduct: null,
    editingCategory: null,
    stockProduct: null,
    orderId: null,
    sessions: [],
  };
  const filters = { product: '', productCat: '', productStatus: '' };
  const orderFilters = { q: '', status: '', from: '', to: '' };
  const reportRange = { from: isoDaysAgo(29), to: isoDate() };
  const PIE_COLORS = ['#c8102e', '#ffbd08', '#8f0a1c', '#f97316', '#0ea5e9', '#12a150', '#7c3aed'];

  /* ------------------------------------------------------------- utilities */

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    const noAuthRedirect = Boolean(opts.noAuthRedirect);
    delete opts.noAuthRedirect;
    if (opts.json !== undefined) {
      opts.body = JSON.stringify(opts.json);
      opts.headers = { 'Content-Type': 'application/json' };
      delete opts.json;
    }
    let res;
    try {
      res = await fetch('/api/admin' + path, opts);
    } catch {
      throw new Error('Tidak bisa menghubungi server. Periksa koneksi.');
    }
    if (res.status === 401 && !noAuthRedirect) {
      showLogin();
      throw new Error('Sesi berakhir. Silakan login kembali.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan pada server.');
    return data;
  }

  let toastTimer = null;
  function toast(message, isError = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('err', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  function openModal(selector) {
    const modal = $(selector);
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModalElement(modal) {
    modal.classList.remove('open');
    if (!$$('.modal.open').length) document.body.style.overflow = '';
    if (modal.id === 'confirmModal' && pendingConfirm) {
      const resolve = pendingConfirm;
      pendingConfirm = null;
      resolve(false);
    }
  }
  const closeModal = (selector) => closeModalElement($(selector));

  let pendingConfirm = null;
  function askConfirm(title, message, confirmLabel = 'Ya, lanjutkan') {
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    $('#confirmYes').textContent = confirmLabel;
    openModal('#confirmModal');
    return new Promise((resolve) => { pendingConfirm = resolve; });
  }

  function showLogin() {
    state.admin = null;
    $('#appShell').hidden = true;
    $('#loginScreen').hidden = false;
    $('#loginPass').value = '';
    $('#loginUser').focus();
  }

  function showApp(admin) {
    state.admin = admin;
    $('#loginScreen').hidden = true;
    $('#appShell').hidden = false;
    $('#adminName').textContent = admin.username;
    $('#adminAvatar').textContent = admin.username.slice(0, 1).toUpperCase();
  }

  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sbBackdrop').classList.remove('open');
  }

  function showPageError(err) {
    if (!state.admin) return;
    $('#page').innerHTML = `<div class="panel"><div class="panel-body">
      <h3 style="font-size:16px;margin-bottom:6px">Halaman gagal dimuat</h3>
      <p class="form-note">${escapeHtml(err.message)}</p>
      <button class="btn btn-red btn-sm" style="margin-top:12px" data-retry>Muat ulang</button>
    </div></div>`;
    $('[data-retry]').addEventListener('click', () => route(true));
  }

  const skeleton = () => `
    <div class="skel" style="height:110px"></div>
    <div class="skel" style="height:280px"></div>`;

  /* ---------------------------------------------------------------- charts */

  function lineChart(rows, valueKey = 'revenue') {
    const w = 660, h = 240, pl = 52, pr = 16, pt = 16, pb = 34;
    const n = rows.length;
    const maxRaw = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
    const max = maxRaw * 1.15;
    const innerW = w - pl - pr, innerH = h - pt - pb;
    const x = (i) => pl + (n > 1 ? (innerW * i) / (n - 1) : innerW / 2);
    const y = (v) => pt + innerH * (1 - v / max);
    const pts = rows.map((r, i) => [x(i), y(Number(r[valueKey]) || 0)]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${x(n - 1).toFixed(1)} ${h - pb} L${x(0).toFixed(1)} ${h - pb} Z`;
    const gridCount = 4;
    let grid = '';
    for (let i = 0; i <= gridCount; i++) {
      const gy = pt + (innerH * i) / gridCount;
      const val = max - (max * i) / gridCount;
      grid += `<line x1="${pl}" y1="${gy.toFixed(1)}" x2="${w - pr}" y2="${gy.toFixed(1)}" stroke="#f2e5da" stroke-dasharray="3 4"/>
        <text x="${pl - 8}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#9b8780">${compact(val)}</text>`;
    }
    const every = Math.max(1, Math.ceil(n / 7));
    let labels = '';
    rows.forEach((r, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      labels += `<text x="${x(i).toFixed(1)}" y="${h - 12}" text-anchor="middle" font-size="9" fill="#9b8780">${escapeHtml(String(r.date || r.month || '').slice(5))}</text>`;
    });
    let dots = '';
    rows.forEach((r, i) => {
      if (Number(r[valueKey]) <= 0) return;
      dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(Number(r[valueKey])).toFixed(1)}" r="3.2" fill="#fff" stroke="#c8102e" stroke-width="2"><title>${escapeHtml(r.date || r.month)}: ${rupiah(r[valueKey])}</title></circle>`;
    });
    return `<div class="chart-box"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Grafik penjualan">
      <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c8102e" stop-opacity=".28"/>
        <stop offset="100%" stop-color="#c8102e" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <path d="${area}" fill="url(#areaGrad)"/>
      <path d="${line}" fill="none" stroke="#c8102e" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${labels}
    </svg></div>`;
  }

  function barChart(rows, valueKey = 'revenue') {
    const w = 660, h = 240, pl = 52, pr = 16, pt = 16, pb = 34;
    const n = rows.length;
    const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0)) * 1.15;
    const innerW = w - pl - pr, innerH = h - pt - pb;
    const step = innerW / n;
    const barW = Math.max(6, step * 0.55);
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const gy = pt + (innerH * i) / 4;
      const val = max - (max * i) / 4;
      grid += `<line x1="${pl}" y1="${gy.toFixed(1)}" x2="${w - pr}" y2="${gy.toFixed(1)}" stroke="#f2e5da" stroke-dasharray="3 4"/>
        <text x="${pl - 8}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#9b8780">${compact(val)}</text>`;
    }
    let bars = '';
    rows.forEach((r, i) => {
      const v = Number(r[valueKey]) || 0;
      const bh = innerH * (v / max);
      const bx = pl + step * i + (step - barW) / 2;
      const by = pt + innerH - bh;
      bars += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}"
          rx="4" fill="${i === n - 1 ? '#c8102e' : '#f0a8ad'}"><title>${escapeHtml(r.month)}: ${rupiah(v)}</title></rect>
        <text x="${(bx + barW / 2).toFixed(1)}" y="${h - 14}" text-anchor="middle" font-size="8.5" fill="#9b8780">${escapeHtml(String(r.month || '').slice(2))}</text>`;
    });
    return `<div class="chart-box"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Grafik penjualan bulanan">${grid}${bars}</svg></div>`;
  }

  function donutChart(items) {
    const total = items.reduce((s, i) => s + Number(i.revenue || 0), 0);
    const r = 58;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    const arcs = items.map((item, i) => {
      const share = total ? Number(item.revenue || 0) / total : 0;
      const seg = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${PIE_COLORS[i % PIE_COLORS.length]}"
        stroke-width="22" stroke-dasharray="${(share * circ).toFixed(2)} ${circ.toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 70 70)">
        <title>${escapeHtml(item.category_name)}: ${rupiah(item.revenue)}</title></circle>`;
      offset += share * circ;
      return seg;
    }).join('');
    const legend = items.map((item, i) => `<li><span class="dot" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>
      ${escapeHtml(item.category_name)} · <b>${total ? Math.round((item.revenue / total) * 100) : 0}%</b></li>`).join('');
    return `<div class="donut-wrap">
      <svg viewBox="0 0 140 140" role="img" aria-label="Distribusi kategori">
        <circle cx="70" cy="70" r="${r}" fill="none" stroke="#f7ece3" stroke-width="22"/>
        ${arcs}
        <text x="70" y="68" text-anchor="middle" class="donut-center">${compact(total)}</text>
        <text x="70" y="83" text-anchor="middle" class="donut-sub">total rupiah</text>
      </svg>
      <ul class="legend" style="flex-direction:column;align-items:flex-start;gap:8px">${legend || '<li>Belum ada penjualan.</li>'}</ul>
    </div>`;
  }

  function hbars(items) {
    if (!items.length) return '<p class="form-note">Belum ada data penjualan.</p>';
    const max = Math.max(1, ...items.map((i) => i.qty));
    return items.map((item, i) => `
      <div class="hbar">
        <div class="hbar-top"><b>${i + 1}. ${escapeHtml(item.name)}</b><span>${item.qty} terjual · ${rupiah(item.revenue)}</span></div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(4, (item.qty / max) * 100)}%"></div></div>
      </div>`).join('');
  }

  function statCard(label, value, sub, icon, tone = '') {
    return `<div class="stat">
      <div class="ico ${tone}">${icon}</div>
      <span class="lbl">${label}</span>
      <b>${value}</b>
      <small>${sub}</small>
    </div>`;
  }

  const ICONS = {
    product: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/></svg>',
    order: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/></svg>',
    money: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/></svg>',
    bell: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
    warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l9.5 17H2.5z"/><path d="M12 9v5M12 17h.01"/></svg>',
    empty: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
  };

  /* ------------------------------------------------------------- dashboard */

  async function loadDashboard() {
    const page = $('#page');
    page.innerHTML = skeleton();
    const d = await api('/dashboard');
    statusMap = Object.fromEntries(d.statuses.map((s) => [s.key, s.label]));
    updateOrderBadge(d.stats.newOrders);
    const dailyRevenue = d.daily.reduce((s, x) => s + x.revenue, 0);
    const dailyOrders = d.daily.reduce((s, x) => s + x.orders, 0);

    page.innerHTML = `
      <div class="stat-grid">
        ${statCard('Total Produk', d.stats.products, `${d.stats.activeProducts} produk aktif`, ICONS.product)}
        ${statCard('Total Pesanan', d.stats.orders, `${d.stats.todayOrders} pesanan hari ini`, ICONS.order, 'blue')}
        ${statCard('Total Pendapatan', rupiah(d.stats.revenue), `Rata-rata ${rupiah(d.stats.avgOrder)}/pesanan`, ICONS.money, 'green')}
        ${statCard('Pesanan Baru', d.stats.newOrders, 'Menunggu diproses', ICONS.bell, 'red')}
        ${statCard('Stok Menipis', d.stats.lowStock, 'Stok ≤ 5 unit', ICONS.warn)}
        ${statCard('Produk Habis', d.stats.outOfStock, 'Stok 0 unit', ICONS.empty, 'gray')}
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head">
            <div><h3>Penjualan 14 Hari Terakhir</h3><p>${rupiah(dailyRevenue)} dari ${dailyOrders} pesanan selesai</p></div>
            <a class="btn btn-ghost btn-sm" href="#laporan">Laporan →</a>
          </div>
          <div class="panel-body">${lineChart(d.daily)}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Produk Terlaris</h3><p>30 hari terakhir</p></div></div>
          <div class="panel-body">${hbars(d.topProducts)}</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><div><h3>Penjualan Bulanan</h3><p>12 bulan terakhir</p></div></div>
          <div class="panel-body">${barChart(d.monthly)}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Distribusi Kategori</h3><p>Berdasarkan pendapatan 30 hari</p></div></div>
          <div class="panel-body">${donutChart(d.categories)}</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head">
            <div><h3>Pesanan Terbaru</h3><p>6 transaksi terakhir</p></div>
            <a class="btn btn-ghost btn-sm" href="#pesanan">Semua pesanan →</a>
          </div>
          <div class="panel-body flush table-wrap">
            <table style="min-width:480px">
              <thead><tr><th>Kode</th><th>Pelanggan</th><th>Total</th><th>Status</th><th>Waktu</th></tr></thead>
              <tbody>
                ${d.recentOrders.length ? d.recentOrders.map((o) => `
                  <tr>
                    <td class="cell-strong">${escapeHtml(o.code)}</td>
                    <td>${escapeHtml(o.customer_name)}<div class="cell-sub">${o.items} item</div></td>
                    <td class="price-cell">${rupiah(o.total)}</td>
                    <td><span class="pill ${o.status}">${escapeHtml(statusMap[o.status] || o.status)}</span></td>
                    <td class="cell-sub">${formatDate(o.created_at)}</td>
                  </tr>`).join('') : '<tr><td colspan="5" class="table-empty"><b>Belum ada pesanan</b>Pesanan pelanggan akan muncul di sini.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <div><h3>Perlu Restock</h3><p>Produk dengan stok ≤ 5</p></div>
            <a class="btn btn-ghost btn-sm" href="#stok">Kelola stok →</a>
          </div>
          <div class="panel-body flush table-wrap">
            <table style="min-width:360px">
              <thead><tr><th>Produk</th><th>Stok</th><th>Status</th></tr></thead>
              <tbody>
                ${d.lowStockProducts.length ? d.lowStockProducts.map((p) => `
                  <tr><td class="cell-strong">${escapeHtml(p.name)}</td><td>${p.stock}</td>
                  <td><span class="pill ${p.stock <= 0 ? 'danger' : 'warn'}">${p.stock <= 0 ? 'Habis' : 'Menipis'}</span></td></tr>`).join('')
        : '<tr><td colspan="3" class="table-empty"><b>Semua stok aman</b>Tidak ada produk yang perlu restock.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  function updateOrderBadge(count) {
    const badge = $('#navOrderBadge');
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }

  /* -------------------------------------------------------------- products */

  async function loadProducts() {
    const page = $('#page');
    page.innerHTML = skeleton();
    const data = await api('/products');
    state.products = data.products;
    state.categories = data.categories;
    page.innerHTML = `
      <div class="page-head">
        <div><h2>Manajemen Produk</h2><p>${state.products.length} produk terdaftar · perubahan langsung tampil di website.</p></div>
        <div class="page-actions">
          <button class="btn btn-red" data-new-product>+ Tambah Produk</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-body">
          <div class="filters-bar">
            <div class="field grow">
              <label for="prodSearch">Cari produk</label>
              <input id="prodSearch" type="search" placeholder="Nama produk…" value="${escapeHtml(filters.product)}">
            </div>
            <div class="field">
              <label for="prodCat">Kategori</label>
              <select id="prodCat">
                <option value="">Semua kategori</option>
                ${state.categories.map((c) => `<option value="${c.id}"${String(filters.productCat) === String(c.id) ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="prodStatus">Status</label>
              <select id="prodStatus">
                <option value="">Semua status</option>
                <option value="active"${filters.productStatus === 'active' ? ' selected' : ''}>Aktif</option>
                <option value="inactive"${filters.productStatus === 'inactive' ? ' selected' : ''}>Nonaktif</option>
                <option value="out"${filters.productStatus === 'out' ? ' selected' : ''}>Stok habis</option>
              </select>
            </div>
            <button class="btn btn-ghost btn-sm" data-reset-product>Reset</button>
          </div>
        </div>
        <div class="panel-body flush table-wrap" id="productTableWrap">${productsTable()}</div>
      </div>`;

    $('#prodSearch').addEventListener('input', (e) => {
      filters.product = e.target.value.trim().toLowerCase();
      $('#productTableWrap').innerHTML = productsTable();
    });
    $('#prodCat').addEventListener('change', (e) => {
      filters.productCat = e.target.value;
      $('#productTableWrap').innerHTML = productsTable();
    });
    $('#prodStatus').addEventListener('change', (e) => {
      filters.productStatus = e.target.value;
      $('#productTableWrap').innerHTML = productsTable();
    });
    $('[data-reset-product]').addEventListener('click', () => {
      filters.product = ''; filters.productCat = ''; filters.productStatus = '';
      loadProducts();
    });
    $('[data-new-product]').addEventListener('click', () => openProductModal(null));
    bindProductTable();
  }

  function filteredProducts() {
    return state.products.filter((p) => {
      if (filters.product && !p.name.toLowerCase().includes(filters.product)) return false;
      if (filters.productCat && String(p.category_id) !== String(filters.productCat)) return false;
      if (filters.productStatus === 'active' && !p.active) return false;
      if (filters.productStatus === 'inactive' && p.active) return false;
      if (filters.productStatus === 'out' && p.stock > 0) return false;
      return true;
    });
  }

  function productsTable() {
    const list = filteredProducts();
    if (!list.length) {
      return `<div class="table-empty"><b>Tidak ada produk</b>Ubah filter atau tambahkan produk baru.</div>`;
    }
    return `<table>
      <thead><tr><th>Produk</th><th>Kategori</th><th>Level</th><th>Ukuran</th><th>Harga</th><th>Stok</th><th>Terjual</th><th>Status</th><th style="text-align:right">Aksi</th></tr></thead>
      <tbody>${list.map((p) => `
        <tr>
          <td><div class="cell-product">
            <img class="thumb" src="${escapeHtml(p.image || '/images/logo.svg')}" alt="" onerror="this.onerror=null;this.src='/images/logo.svg'">
            <div><div class="cell-strong">${escapeHtml(p.name)}</div><div class="cell-sub">${escapeHtml((p.description || '').slice(0, 46))}${(p.description || '').length > 46 ? '…' : ''}</div></div>
          </div></td>
          <td>${escapeHtml(p.category || '—')}</td>
          <td>${p.spice_level ? '<span class="pill warn">Lv ' + p.spice_level + '</span>' : '<span class="cell-sub">Tidak pedas</span>'}</td>
          <td>${escapeHtml(p.size)}</td>
          <td class="price-cell">${rupiah(p.price)}</td>
          <td><span class="pill ${p.stock <= 0 ? 'danger' : p.stock <= 5 ? 'warn' : 'on'}">${p.stock} unit</span></td>
          <td>${p.sold}</td>
          <td><span class="pill ${p.active ? 'on' : 'off'}">${p.active ? 'Aktif' : 'Nonaktif'}</span></td>
          <td><div class="row-actions">
            <button class="btn btn-ghost btn-sm" data-edit-product="${p.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-del-product="${p.id}">Hapus</button>
          </div></td>
        </tr>`).join('')}</tbody>
    </table>`;
  }

  function bindProductTable() {
    const wrap = $('#productTableWrap');
    if (!wrap) return;
    wrap.addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit-product]');
      const del = e.target.closest('[data-del-product]');
      if (edit) {
        const product = state.products.find((p) => p.id === Number(edit.dataset.editProduct));
        if (product) openProductModal(product);
      }
      if (del) {
        const product = state.products.find((p) => p.id === Number(del.dataset.delProduct));
        if (!product) return;
        const ok = await askConfirm('Hapus produk?', `"${product.name}" akan dihapus permanen dari website dan database.`, 'Ya, hapus');
        if (!ok) return;
        try {
          await api('/products/' + product.id, { method: 'DELETE' });
          toast('Produk dihapus.');
          loadProducts();
        } catch (err) { toast(err.message, true); }
      }
    });
  }

  function openProductModal(product) {
    state.editingProduct = product;
    $('#productModalTitle').textContent = product ? 'Edit Produk' : 'Tambah Produk';
    $('#productError').hidden = true;
    $('#pName').value = product ? product.name : '';
    $('#pCategory').innerHTML = '<option value="">Tanpa kategori</option>' + state.categories.map((c) =>
      `<option value="${c.id}"${product && product.category_id === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    $('#pSpice').value = String(product ? product.spice_level : 1);
    $('#pPrice').value = product ? product.price : '';
    $('#pStock').value = product ? product.stock : 0;
    $('#pSize').value = product ? product.size : '30 cm';
    $('#pDesc').value = product ? product.description : '';
    $('#pImage').value = product ? product.image : '';
    $('#pActive').checked = product ? !!product.active : true;
    $('#pImageFile').value = '';
    setPreview(product ? product.image : '');
    openModal('#productModal');
    setTimeout(() => $('#pName').focus(), 120);
  }

  function setPreview(url) {
    const el = $('#pPreview');
    el.style.backgroundImage = url ? `url("${String(url).replace(/"/g, '%22')}")` : 'none';
  }

  async function uploadImage(file) {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/api/admin/upload', { method: 'POST', body: fd, credentials: 'same-origin' });
    if (res.status === 401) { showLogin(); throw new Error('Sesi berakhir.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload gagal.');
    return data.url;
  }

  async function submitProduct(event) {
    event.preventDefault();
    const errorBox = $('#productError');
    errorBox.hidden = true;
    const body = {
      name: $('#pName').value.trim(),
      description: $('#pDesc').value.trim(),
      category_id: $('#pCategory').value ? Number($('#pCategory').value) : null,
      spice_level: Number($('#pSpice').value),
      size: $('#pSize').value.trim() || '30 cm',
      price: Number($('#pPrice').value),
      stock: Number($('#pStock').value),
      image: $('#pImage').value.trim(),
      active: $('#pActive').checked,
    };
    if (body.name.length < 2) { errorBox.textContent = 'Nama produk minimal 2 karakter.'; errorBox.hidden = false; return; }
    if (!Number.isFinite(body.price) || body.price < 0) { errorBox.textContent = 'Harga tidak valid.'; errorBox.hidden = false; return; }
    if (!Number.isFinite(body.stock) || body.stock < 0) { errorBox.textContent = 'Stok tidak valid.'; errorBox.hidden = false; return; }
    const btn = $('#productSubmit');
    btn.disabled = true;
    try {
      if (state.editingProduct) {
        await api('/products/' + state.editingProduct.id, { method: 'PUT', json: body });
        toast('Produk diperbarui.');
      } else {
        await api('/products', { method: 'POST', json: body });
        toast('Produk ditambahkan.');
      }
      closeModal('#productModal');
      loadProducts();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  /* ------------------------------------------------------------ categories */

  async function loadCategories() {
    const page = $('#page');
    page.innerHTML = skeleton();
    const data = await api('/categories');
    state.categories = data.categories;
    page.innerHTML = `
      <div class="page-head">
        <div><h2>Kategori Produk</h2><p>Kategori dipakai sebagai filter di halaman pelanggan.</p></div>
        <div class="page-actions"><button class="btn btn-red" data-new-category>+ Tambah Kategori</button></div>
      </div>
      <div class="panel">
        <div class="panel-body flush table-wrap">
          <table>
            <thead><tr><th>Nama</th><th>Deskripsi</th><th>Urutan</th><th>Jumlah produk</th><th style="text-align:right">Aksi</th></tr></thead>
            <tbody>${data.categories.length ? data.categories.map((c) => `
              <tr>
                <td class="cell-strong">${escapeHtml(c.name)}</td>
                <td class="cell-sub">${escapeHtml(c.description || '—')}</td>
                <td>${c.sort_order}</td>
                <td><span class="pill">${c.products} produk</span></td>
                <td><div class="row-actions">
                  <button class="btn btn-ghost btn-sm" data-edit-cat="${c.id}">Edit</button>
                  <button class="btn btn-danger btn-sm" data-del-cat="${c.id}"${c.products ? ' disabled title="Masih dipakai produk"' : ''}>Hapus</button>
                </div></td>
              </tr>`).join('') : '<tr><td colspan="5" class="table-empty"><b>Belum ada kategori</b>Tambahkan kategori pertama.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    $('[data-new-category]').addEventListener('click', () => openCategoryModal(null));
    page.onclick = async (e) => {
      const edit = e.target.closest('[data-edit-cat]');
      const del = e.target.closest('[data-del-cat]');
      if (edit) {
        const cat = state.categories.find((c) => c.id === Number(edit.dataset.editCat));
        if (cat) openCategoryModal(cat);
      }
      if (del) {
        const cat = state.categories.find((c) => c.id === Number(del.dataset.delCat));
        if (!cat) return;
        const ok = await askConfirm('Hapus kategori?', `Kategori "${cat.name}" akan dihapus.`, 'Ya, hapus');
        if (!ok) return;
        try {
          await api('/categories/' + cat.id, { method: 'DELETE' });
          toast('Kategori dihapus.');
          loadCategories();
        } catch (err) { toast(err.message, true); }
      }
    };
  }

  function openCategoryModal(category) {
    state.editingCategory = category;
    $('#categoryModalTitle').textContent = category ? 'Edit Kategori' : 'Tambah Kategori';
    $('#categoryError').hidden = true;
    $('#cName').value = category ? category.name : '';
    $('#cDesc').value = category ? category.description : '';
    $('#cSort').value = category ? category.sort_order : 99;
    openModal('#categoryModal');
    setTimeout(() => $('#cName').focus(), 120);
  }

  async function submitCategory(event) {
    event.preventDefault();
    const errorBox = $('#categoryError');
    errorBox.hidden = true;
    const body = {
      name: $('#cName').value.trim(),
      description: $('#cDesc').value.trim(),
      sort_order: Number($('#cSort').value) || 0,
    };
    if (body.name.length < 2) {
      errorBox.textContent = 'Nama kategori minimal 2 karakter.';
      errorBox.hidden = false;
      return;
    }
    try {
      if (state.editingCategory) {
        await api('/categories/' + state.editingCategory.id, { method: 'PUT', json: body });
        toast('Kategori diperbarui.');
      } else {
        await api('/categories', { method: 'POST', json: body });
        toast('Kategori ditambahkan.');
      }
      closeModal('#categoryModal');
      loadCategories();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    }
  }

  /* ---------------------------------------------------------------- orders */

  async function loadOrders() {
    const page = $('#page');
    page.innerHTML = skeleton();
    const params = new URLSearchParams();
    if (orderFilters.q) params.set('q', orderFilters.q);
    if (orderFilters.status) params.set('status', orderFilters.status);
    if (orderFilters.from) params.set('from', orderFilters.from);
    if (orderFilters.to) params.set('to', orderFilters.to);
    const data = await api('/orders?' + params.toString());
    statusMap = Object.fromEntries(data.statuses.map((s) => [s.key, s.label]));
    const newCount = data.orders.filter((o) => o.status === 'new').length;
    updateOrderBadge(newCount);

    page.innerHTML = `
      <div class="page-head">
        <div><h2>Manajemen Pesanan</h2><p>${data.orders.length} pesanan ditampilkan · total ${rupiah(data.summary.revenue)} (tanpa yang dibatalkan).</p></div>
        <div class="page-actions"><button class="btn btn-ghost" data-refresh-orders>↻ Muat ulang</button></div>
      </div>
      <div class="panel">
        <div class="panel-body">
          <div class="filters-bar">
            <div class="field grow">
              <label for="ordQ">Cari</label>
              <input id="ordQ" type="search" placeholder="Kode, nama, atau nomor WhatsApp" value="${escapeHtml(orderFilters.q)}">
            </div>
            <div class="field">
              <label for="ordStatus">Status</label>
              <select id="ordStatus">
                <option value="">Semua status</option>
                ${Object.entries(statusMap).map(([k, v]) => `<option value="${k}"${orderFilters.status === k ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="ordFrom">Dari tanggal</label>
              <input id="ordFrom" type="date" value="${escapeHtml(orderFilters.from)}">
            </div>
            <div class="field">
              <label for="ordTo">Sampai</label>
              <input id="ordTo" type="date" value="${escapeHtml(orderFilters.to)}">
            </div>
            <button class="btn btn-red btn-sm" data-apply-orders>Terapkan</button>
            <button class="btn btn-ghost btn-sm" data-reset-orders>Reset</button>
          </div>
        </div>
        <div class="panel-body flush table-wrap">
          <table>
            <thead><tr><th>Kode / Tanggal</th><th>Pelanggan</th><th>Produk</th><th>Total</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>${data.orders.length ? data.orders.map((o) => `
              <tr>
                <td><div class="cell-strong">${escapeHtml(o.code)}</div><div class="cell-sub">${formatDate(o.created_at)}</div></td>
                <td><div class="cell-strong">${escapeHtml(o.customer_name)}</div><div class="cell-sub">+${escapeHtml(o.whatsapp)}</div></td>
                <td><div class="cell-sub" style="max-width:230px">${escapeHtml(o.items.map((i) => `${i.product_name} ×${i.qty}`).join(', '))}</div><div class="cell-sub">${o.items_count} item</div></td>
                <td class="price-cell">${rupiah(o.total)}</td>
                <td>
                  <select class="status-select" data-order-status="${o.id}" style="min-width:148px" aria-label="Ubah status ${escapeHtml(o.code)}">
                    ${Object.entries(statusMap).map(([k, v]) => `<option value="${k}"${o.status === k ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}
                  </select>
                </td>
                <td><div class="row-actions">
                  <button class="btn btn-ghost btn-sm" data-order-detail="${o.id}">Detail</button>
                  <button class="btn btn-danger btn-sm" data-order-del="${o.id}">Hapus</button>
                </div></td>
              </tr>`).join('') : '<tr><td colspan="6" class="table-empty"><b>Tidak ada pesanan</b>Pesanan baru dari pelanggan akan muncul di sini.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    const apply = () => {
      orderFilters.q = $('#ordQ').value.trim();
      orderFilters.status = $('#ordStatus').value;
      orderFilters.from = $('#ordFrom').value;
      orderFilters.to = $('#ordTo').value;
      loadOrders().catch(showPageError);
    };
    $('[data-apply-orders]').addEventListener('click', apply);
    $('#ordQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    $('[data-refresh-orders]').addEventListener('click', () => loadOrders().catch(showPageError));
    $('[data-reset-orders]').addEventListener('click', () => {
      orderFilters.q = ''; orderFilters.status = ''; orderFilters.from = ''; orderFilters.to = '';
      loadOrders().catch(showPageError);
    });

    page.onchange = async (e) => {
      const select = e.target.closest('[data-order-status]');
      if (!select) return;
      select.disabled = true;
      try {
        await api(`/orders/${select.dataset.orderStatus}/status`, { method: 'PATCH', json: { status: select.value } });
        toast('Status pesanan diperbarui.');
        loadOrders().catch(showPageError);
      } catch (err) {
        toast(err.message, true);
        loadOrders().catch(showPageError);
      }
    };

    page.onclick = async (e) => {
      const detail = e.target.closest('[data-order-detail]');
      const del = e.target.closest('[data-order-del]');
      if (detail) {
        openOrderDetail(Number(detail.dataset.orderDetail));
      }
      if (del) {
        const id = Number(del.dataset.orderDel);
        const ok = await askConfirm('Hapus pesanan?', 'Pesanan akan dihapus permanen dan stok produk dikembalikan.', 'Ya, hapus');
        if (!ok) return;
        try {
          await api('/orders/' + id, { method: 'DELETE' });
          toast('Pesanan dihapus. Stok dikembalikan.');
          loadOrders().catch(showPageError);
        } catch (err) { toast(err.message, true); }
      }
    };
  }

  async function openOrderDetail(id) {
    try {
      const { order } = await api('/orders/' + id);
      const waText = encodeURIComponent(
        `Halo ${order.customer_name}, pesanan ${order.code} di PIZZAKY.AJA berstatus: ${statusMap[order.status] || order.status}. Terima kasih!`
      );
      $('#orderModalSub').textContent = order.code + ' · ' + formatDate(order.created_at);
      $('#orderDetail').innerHTML = `
        <div class="detail-grid">
          <div><b>Kode pesanan</b><span>${escapeHtml(order.code)}</span></div>
          <div><b>Status</b><span class="pill ${order.status}">${escapeHtml(statusMap[order.status] || order.status)}</span></div>
          <div><b>Nama pelanggan</b><span>${escapeHtml(order.customer_name)}</span></div>
          <div><b>WhatsApp</b><span>+${escapeHtml(order.whatsapp)}</span></div>
          <div class="full"><b>Alamat</b><span>${escapeHtml(order.address)}</span></div>
          ${order.notes ? `<div class="full"><b>Catatan</b><span>${escapeHtml(order.notes)}</span></div>` : ''}
          <div><b>Dibuat</b><span>${formatDate(order.created_at)}</span></div>
          <div><b>Diperbarui</b><span>${formatDate(order.updated_at)}</span></div>
        </div>
        <div class="item-list">
          ${order.items.map((i) => `<div class="item-row">
            <span>${escapeHtml(i.product_name)}<br><small>${rupiah(i.price)} × ${i.qty}</small></span>
            <span>${rupiah(i.subtotal)}</span>
          </div>`).join('')}
          <div class="item-row total"><span>Total pembayaran</span><span>${rupiah(order.total)}</span></div>
        </div>
        <div class="field" style="margin-top:16px">
          <label for="detailStatus">Ubah status pesanan</label>
          <select class="status-select" id="detailStatus">
            ${Object.entries(statusMap).map(([k, v]) => `<option value="${k}"${order.status === k ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}
          </select>
          <p class="hint">Membatalkan pesanan otomatis mengembalikan stok. Menghapus pesanan juga mengembalikan stok.</p>
        </div>
        <div class="modal-foot" style="padding:6px 0 0;justify-content:space-between">
          <a class="btn btn-ghost" href="https://wa.me/${escapeHtml(order.whatsapp)}?text=${waText}" target="_blank" rel="noopener">Chat pelanggan ↗</a>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost" type="button" data-close>Tutup</button>
            <button class="btn btn-red" id="saveOrderStatus" type="button">Simpan Status</button>
          </div>
        </div>`;
      openModal('#orderModal');
      $('#saveOrderStatus').addEventListener('click', async () => {
        const btn = $('#saveOrderStatus');
        btn.disabled = true;
        try {
          await api(`/orders/${order.id}/status`, { method: 'PATCH', json: { status: $('#detailStatus').value } });
          toast('Status pesanan diperbarui.');
          closeModal('#orderModal');
          loadOrders().catch(showPageError);
        } catch (err) {
          toast(err.message, true);
        } finally {
          btn.disabled = false;
        }
      });
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ----------------------------------------------------------------- stock */

  async function loadStock() {
    const page = $('#page');
    page.innerHTML = skeleton();
    const data = await api('/products');
    state.products = data.products;
    state.categories = data.categories;
    const out = state.products.filter((p) => p.stock <= 0).length;
    const low = state.products.filter((p) => p.stock > 0 && p.stock <= 5).length;
    const ok = state.products.length - out - low;

    page.innerHTML = `
      <div class="page-head">
        <div><h2>Manajemen Stok</h2><p>Stok berkurang otomatis saat pelanggan checkout, dan kembali saat pesanan dibatalkan.</p></div>
      </div>
      <div class="stat-grid">
        ${statCard('Stok Tersedia', ok, 'Lebih dari 5 unit', ICONS.product, 'green')}
        ${statCard('Stok Menipis', low, '1–5 unit tersisa', ICONS.warn)}
        ${statCard('Stok Habis', out, 'Perlu restock segera', ICONS.empty, 'red')}
        ${statCard('Total Produk', state.products.length, 'Semua produk terdaftar', ICONS.order, 'blue')}
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Daftar Stok Produk</h3><p>Gunakan tombol +/− untuk penyesuaian cepat, atau "Atur" untuk nilai pasti.</p></div></div>
        <div class="panel-body flush table-wrap">
          <table>
            <thead><tr><th>Produk</th><th>Kategori</th><th>Harga</th><th>Stok</th><th>Status</th><th style="text-align:right">Aksi</th></tr></thead>
            <tbody>${state.products.map((p) => `
              <tr>
                <td><div class="cell-product">
                  <img class="thumb" src="${escapeHtml(p.image || '/images/logo.svg')}" alt="" onerror="this.onerror=null;this.src='/images/logo.svg'">
                  <div><div class="cell-strong">${escapeHtml(p.name)}</div><div class="cell-sub">${escapeHtml(p.size)}</div></div>
                </div></td>
                <td>${escapeHtml(p.category || '—')}</td>
                <td class="price-cell">${rupiah(p.price)}</td>
                <td><b>${p.stock}</b> unit</td>
                <td><span class="pill ${p.stock <= 0 ? 'danger' : p.stock <= 5 ? 'warn' : 'on'}">
                  ${p.stock <= 0 ? 'Habis' : p.stock <= 5 ? 'Menipis' : 'Tersedia'}</span></td>
                <td><div class="row-actions">
                  <button class="btn btn-ghost btn-sm" data-stock-dec="${p.id}" aria-label="Kurangi stok ${escapeHtml(p.name)}">−1</button>
                  <button class="btn btn-ghost btn-sm" data-stock-inc="${p.id}" aria-label="Tambah stok ${escapeHtml(p.name)}">+1</button>
                  <button class="btn btn-dark btn-sm" data-stock-set="${p.id}">Atur</button>
                </div></td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;

    page.onclick = async (e) => {
      const inc = e.target.closest('[data-stock-inc]');
      const dec = e.target.closest('[data-stock-dec]');
      const set = e.target.closest('[data-stock-set]');
      if (inc || dec) {
        const id = Number((inc || dec).dataset[inc ? 'stockInc' : 'stockDec']);
        try {
          await api(`/products/${id}/stock`, { method: 'POST', json: { mode: inc ? 'add' : 'remove', value: 1 } });
          toast('Stok diperbarui.');
          loadStock().catch(showPageError);
        } catch (err) { toast(err.message, true); }
      }
      if (set) {
        const product = state.products.find((p) => p.id === Number(set.dataset.stockSet));
        if (!product) return;
        state.stockProduct = product;
        $('#stockModalSub').textContent = `${product.name} · stok saat ini ${product.stock}`;
        $('#stockMode').value = 'set';
        $('#stockValue').value = product.stock;
        $('#stockError').hidden = true;
        openModal('#stockModal');
        setTimeout(() => $('#stockValue').select(), 120);
      }
    };
  }

  async function submitStock(event) {
    event.preventDefault();
    if (!state.stockProduct) return;
    const errorBox = $('#stockError');
    errorBox.hidden = true;
    const mode = $('#stockMode').value;
    const value = Number($('#stockValue').value);
    if (!Number.isFinite(value) || value < 0) {
      errorBox.textContent = 'Jumlah stok tidak valid.';
      errorBox.hidden = false;
      return;
    }
    try {
      await api(`/products/${state.stockProduct.id}/stock`, { method: 'POST', json: { mode, value } });
      closeModal('#stockModal');
      toast('Stok berhasil diperbarui.');
      if (state.page === 'stok') loadStock().catch(showPageError);
      else loadProducts().catch(showPageError);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    }
  }

  /* --------------------------------------------------------------- reports */

  async function loadReports() {
    const page = $('#page');
    page.innerHTML = skeleton();
    const data = await api(`/reports?from=${reportRange.from}&to=${reportRange.to}`);
    statusMap = Object.fromEntries(data.statuses.map((s) => [s.key, s.label]));
    const totalStatus = data.statusCounts.reduce((s, x) => s + x.count, 0);

    page.innerHTML = `
      <div class="page-head">
        <div><h2>Laporan Penjualan</h2><p>Periode ${formatDate(data.from, false)} – ${formatDate(data.to, false)}</p></div>
        <div class="page-actions">
          <button class="btn btn-ghost" data-export-csv>↓ Ekspor CSV</button>
          <button class="btn btn-ghost" data-print-report>Cetak</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-body">
          <div class="filters-bar">
            <div class="field"><label for="repFrom">Dari tanggal</label><input id="repFrom" type="date" value="${data.from}"></div>
            <div class="field"><label for="repTo">Sampai tanggal</label><input id="repTo" type="date" value="${data.to}"></div>
            <button class="btn btn-red btn-sm" data-apply-report>Terapkan</button>
            <button class="btn btn-ghost btn-sm" data-preset="7">7 hari</button>
            <button class="btn btn-ghost btn-sm" data-preset="30">30 hari</button>
            <button class="btn btn-ghost btn-sm" data-preset="90">90 hari</button>
          </div>
        </div>
      </div>
      <div class="stat-grid">
        ${statCard('Total Pendapatan', rupiah(data.totals.revenue), 'Tanpa pesanan dibatalkan', ICONS.money, 'green')}
        ${statCard('Total Transaksi', data.totals.orders, 'Pesanan tercatat', ICONS.order, 'blue')}
        ${statCard('Produk Terjual', data.totals.items, 'Total item keluar', ICONS.product)}
        ${statCard('Rata-rata / Pesanan', rupiah(data.totals.avgOrder), 'Nilai keranjang', ICONS.bell, 'red')}
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><div><h3>Penjualan Harian</h3><p>Pendapatan per hari pada periode ini</p></div></div>
          <div class="panel-body">${lineChart(data.daily)}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Penjualan per Kategori</h3><p>Kontribusi pendapatan</p></div></div>
          <div class="panel-body">${donutChart(data.categories)}</div>
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><div><h3>Produk Terlaris</h3><p>10 produk teratas</p></div></div>
          <div class="panel-body flush table-wrap">
            <table style="min-width:420px">
              <thead><tr><th>#</th><th>Produk</th><th>Terjual</th><th>Pendapatan</th></tr></thead>
              <tbody>${data.topProducts.length ? data.topProducts.map((p, i) => `
                <tr><td>${i + 1}</td><td class="cell-strong">${escapeHtml(p.name)}</td><td>${p.qty}</td>
                <td class="price-cell">${rupiah(p.revenue)}</td></tr>`).join('')
        : '<tr><td colspan="4" class="table-empty"><b>Belum ada penjualan</b>Pada periode ini.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Status Pesanan</h3><p>${totalStatus} pesanan pada periode ini</p></div></div>
          <div class="panel-body">
            ${data.statusCounts.length ? data.statusCounts.map((s) => `
              <div class="hbar">
                <div class="hbar-top"><b>${escapeHtml(statusMap[s.status] || s.status)}</b><span>${s.count} pesanan</span></div>
                <div class="hbar-track"><div class="hbar-fill" style="width:${totalStatus ? Math.max(3, (s.count / totalStatus) * 100) : 0}%"></div></div>
              </div>`).join('') : '<p class="form-note">Belum ada pesanan pada periode ini.</p>'}
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>Penjualan Bulanan (12 bulan)</h3><p>Gambaran performa jangka panjang</p></div></div>
        <div class="panel-body">${barChart(data.monthly)}</div>
      </div>`;

    const apply = () => {
      const from = $('#repFrom').value;
      const to = $('#repTo').value;
      if (!from || !to) return toast('Isi tanggal dengan benar.', true);
      if (from > to) return toast('Tanggal awal harus sebelum tanggal akhir.', true);
      reportRange.from = from;
      reportRange.to = to;
      loadReports().catch(showPageError);
    };
    $('[data-apply-report]').addEventListener('click', apply);
    $$('[data-preset]').forEach((btn) => btn.addEventListener('click', () => {
      reportRange.to = isoDate();
      reportRange.from = isoDaysAgo(Number(btn.dataset.preset) - 1);
      loadReports().catch(showPageError);
    }));
    $('[data-export-csv]').addEventListener('click', () => {
      window.location.href = `/api/admin/reports/export.csv?from=${reportRange.from}&to=${reportRange.to}`;
    });
    $('[data-print-report]').addEventListener('click', () => window.print());
  }

  /* -------------------------------------------------------------- settings */

  async function loadSettings() {
    const page = $('#page');
    page.innerHTML = skeleton();
    const { settings } = await api('/settings');
    state.settings = settings;
    page.innerHTML = `
      <div class="page-head">
        <div><h2>Pengaturan Website</h2><p>Perubahan langsung dipakai website pelanggan.</p></div>
      </div>
      <form id="settingsForm" class="panel">
        <div class="panel-head"><div><h3>Identitas &amp; Kontak Toko</h3><p>Nama, nomor WhatsApp, alamat, dan jam buka.</p></div></div>
        <div class="panel-body">
          <div class="form-error" id="settingsError" hidden></div>
          <div class="form-row">
            <div class="field"><label for="sName">Nama toko</label><input id="sName" value="${escapeHtml(settings.store_name)}" maxlength="60" required></div>
            <div class="field"><label for="sWa">Nomor WhatsApp admin</label><input id="sWa" value="${escapeHtml(settings.whatsapp)}" placeholder="6281234567890" required>
              <p class="hint">Format 62… tanpa + atau spasi.</p></div>
          </div>
          <div class="field"><label for="sTagline">Tagline / slogan</label><input id="sTagline" value="${escapeHtml(settings.tagline)}" maxlength="160"></div>
          <div class="field"><label for="sAddress">Alamat outlet</label><textarea id="sAddress" maxlength="300">${escapeHtml(settings.address)}</textarea></div>
          <div class="form-row">
            <div class="field"><label for="sHours">Jam operasional</label><input id="sHours" value="${escapeHtml(settings.hours)}" maxlength="120"></div>
            <div class="field"><label for="sMaps">Link Google Maps</label><input id="sMaps" value="${escapeHtml(settings.maps_url)}" maxlength="500" placeholder="https://maps.google.com/…"></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="sEmail">Email kontak</label><input id="sEmail" type="email" value="${escapeHtml(settings.contact_email)}" maxlength="120"></div>
            <div class="field"><label for="sIg">Instagram</label><input id="sIg" value="${escapeHtml(settings.instagram)}" maxlength="80" placeholder="@pizzaky.aja"></div>
          </div>
        </div>
        <div class="panel-head" style="border-top:1px solid var(--line)"><div><h3>Logo &amp; Banner</h3><p>Logo tampil di header; banner menggantikan latar hero.</p></div></div>
        <div class="panel-body">
          <div class="form-row">
            <div class="field">
              <label>Logo toko</label>
              <div class="upload-row">
                <div class="upload-preview" id="sLogoPreview"></div>
                <div style="flex:1">
                  <label class="file-btn">Unggah logo<input type="file" id="sLogoFile" accept="image/png,image/jpeg,image/webp,image/gif"></label>
                  <input id="sLogo" value="${escapeHtml(settings.logo)}" placeholder="/images/logo.svg" style="margin-top:8px">
                </div>
              </div>
            </div>
            <div class="field">
              <label>Banner homepage <span style="font-weight:500;color:var(--muted)">(opsional)</span></label>
              <div class="upload-row">
                <div class="upload-preview" id="sBannerPreview"></div>
                <div style="flex:1">
                  <label class="file-btn">Unggah banner<input type="file" id="sBannerFile" accept="image/png,image/jpeg,image/webp,image/gif"></label>
                  <input id="sBanner" value="${escapeHtml(settings.banner)}" placeholder="Kosongkan untuk latar bawaan" style="margin-top:8px">
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="panel-body" style="border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-ghost" type="button" data-reset-settings>Muat ulang</button>
          <button class="btn btn-red" type="submit">Simpan Pengaturan</button>
        </div>
      </form>`;

    const preview = (id, url) => {
      const el = $(id);
      el.style.backgroundImage = url ? `url("${String(url).replace(/"/g, '%22')}")` : 'none';
    };
    preview('#sLogoPreview', settings.logo);
    preview('#sBannerPreview', settings.banner);
    $('#sLogo').addEventListener('input', (e) => preview('#sLogoPreview', e.target.value.trim()));
    $('#sBanner').addEventListener('input', (e) => preview('#sBannerPreview', e.target.value.trim()));
    $('#sLogoFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        toast('Mengunggah logo…');
        const url = await uploadImage(file);
        $('#sLogo').value = url;
        preview('#sLogoPreview', url);
        toast('Logo terunggah. Jangan lupa simpan.');
      } catch (err) { toast(err.message, true); }
    });
    $('#sBannerFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        toast('Mengunggah banner…');
        const url = await uploadImage(file);
        $('#sBanner').value = url;
        preview('#sBannerPreview', url);
        toast('Banner terunggah. Jangan lupa simpan.');
      } catch (err) { toast(err.message, true); }
    });
    $('[data-reset-settings]').addEventListener('click', () => loadSettings().catch(showPageError));

    $('#settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = $('#settingsError');
      errorBox.hidden = true;
      const body = {
        store_name: $('#sName').value.trim(),
        tagline: $('#sTagline').value.trim(),
        whatsapp: $('#sWa').value.trim(),
        address: $('#sAddress').value.trim(),
        maps_url: $('#sMaps').value.trim(),
        hours: $('#sHours').value.trim(),
        contact_email: $('#sEmail').value.trim(),
        instagram: $('#sIg').value.trim(),
        logo: $('#sLogo').value.trim(),
        banner: $('#sBanner').value.trim(),
      };
      try {
        await api('/settings', { method: 'PUT', json: body });
        toast('Pengaturan disimpan.');
        loadSettings().catch(showPageError);
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      }
    });
  }

  /* --------------------------------------------------------------- account */

  async function loadAccount() {
    const page = $('#page');
    page.innerHTML = skeleton();
    const data = await api('/account/sessions');
    state.sessions = data.sessions;
    page.innerHTML = `
      <div class="page-head">
        <div><h2>Akun Admin</h2><p>Kelola username, password, dan sesi login.</p></div>
      </div>
      <div class="grid-2-even">
        <div class="panel">
          <div class="panel-head"><div><h3>Ganti Username</h3><p>Username dipakai untuk login.</p></div></div>
          <form class="panel-body" id="usernameForm">
            <div class="form-error" id="usernameError" hidden></div>
            <div class="field"><label for="accUser">Username baru</label><input id="accUser" value="${escapeHtml(state.admin.username)}" maxlength="40" pattern="[a-zA-Z0-9_.-]{3,40}" required></div>
            <button class="btn btn-red" type="submit">Simpan Username</button>
          </form>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h3>Ganti Password</h3><p>Minimal 6 karakter. Disimpan sebagai hash scrypt.</p></div></div>
          <form class="panel-body" id="passwordForm">
            <div class="form-error" id="passwordError" hidden></div>
            <div class="field"><label for="accCurrent">Password saat ini</label><input id="accCurrent" type="password" autocomplete="current-password" required></div>
            <div class="field"><label for="accNext">Password baru</label><input id="accNext" type="password" autocomplete="new-password" minlength="6" required></div>
            <div class="field"><label for="accConfirm">Ulangi password baru</label><input id="accConfirm" type="password" autocomplete="new-password" minlength="6" required></div>
            <button class="btn btn-red" type="submit">Perbarui Password</button>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div><h3>Sesi Login</h3><p>${data.sessions.length} sesi aktif untuk akun ini.</p></div>
          <button class="btn btn-danger btn-sm" id="logoutOthers">Keluar dari semua perangkat lain</button>
        </div>
        <div class="panel-body flush table-wrap">
          <table style="min-width:520px">
            <thead><tr><th>Perangkat</th><th>Dibuat</th><th>Kedaluwarsa</th><th>Status</th></tr></thead>
            <tbody>${data.sessions.map((s) => `
              <tr>
                <td class="cell-sub" style="max-width:320px">${escapeHtml(s.user_agent || 'Tidak diketahui')}</td>
                <td>${formatDate(s.created_at)}</td>
                <td>${formatDate(s.expires_at)}</td>
                <td>${s.current ? '<span class="pill on">Sesi ini</span>' : '<span class="pill">Aktif</span>'}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-body" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
          <div><b style="font-size:14px">Logout dari dashboard</b><div class="form-note">Akhiri sesi ini dan kembali ke halaman login.</div></div>
          <button class="btn btn-dark" id="accountLogout">Logout</button>
        </div>
      </div>`;

    $('#usernameForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = $('#usernameError');
      errorBox.hidden = true;
      const username = $('#accUser').value.trim();
      try {
        const res = await api('/account/username', { method: 'PUT', json: { username } });
        state.admin.username = res.username;
        $('#adminName').textContent = res.username;
        $('#adminAvatar').textContent = res.username.slice(0, 1).toUpperCase();
        toast('Username diperbarui.');
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      }
    });

    $('#passwordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = $('#passwordError');
      errorBox.hidden = true;
      const current = $('#accCurrent').value;
      const next = $('#accNext').value;
      const confirm = $('#accConfirm').value;
      if (next !== confirm) {
        errorBox.textContent = 'Konfirmasi password tidak sama.';
        errorBox.hidden = false;
        return;
      }
      try {
        await api('/account/password', { method: 'PUT', json: { current, next } });
        $('#passwordForm').reset();
        toast('Password berhasil diperbarui.');
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      }
    });

    $('#logoutOthers').addEventListener('click', async () => {
      const ok = await askConfirm('Keluar dari perangkat lain?', 'Semua sesi selain sesi ini akan diakhiri.', 'Ya, lanjutkan');
      if (!ok) return;
      try {
        await api('/account/sessions', { method: 'DELETE' });
        toast('Sesi lain telah diakhiri.');
        loadAccount().catch(showPageError);
      } catch (err) { toast(err.message, true); }
    });

    $('#accountLogout').addEventListener('click', logout);
  }

  /* --------------------------------------------------------------- routing */

  const PAGES = {
    dashboard: { title: 'Dashboard', sub: 'Ringkasan toko hari ini', load: loadDashboard },
    produk: { title: 'Produk', sub: 'Kelola katalog pizza', load: loadProducts },
    kategori: { title: 'Kategori', sub: 'Kelompokkan menu pizza', load: loadCategories },
    pesanan: { title: 'Pesanan', sub: 'Pantau dan ubah status pesanan', load: loadOrders },
    stok: { title: 'Stok', sub: 'Ketersediaan produk', load: loadStock },
    laporan: { title: 'Laporan Penjualan', sub: 'Analisis performa toko', load: loadReports },
    pengaturan: { title: 'Pengaturan Website', sub: 'Identitas toko dan kontak', load: loadSettings },
    akun: { title: 'Akun Admin', sub: 'Keamanan dan sesi login', load: loadAccount },
  };

  function route(force = false) {
    if (!state.admin) return;
    const key = location.hash.replace('#', '') || 'dashboard';
    const pageKey = PAGES[key] ? key : 'dashboard';
    if (!force && state.page === pageKey && $('#page').dataset.loaded === pageKey) return;
    state.page = pageKey;
    $('#page').dataset.loaded = pageKey;
    $$('.sidebar .sb-nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === pageKey));
    $('#pageTitle').textContent = PAGES[pageKey].title;
    $('#pageSub').textContent = PAGES[pageKey].sub;
    $('#page').onclick = null;
    $('#page').onchange = null;
    closeSidebar();
    window.scrollTo({ top: 0 });
    PAGES[pageKey].load().catch(showPageError);
  }

  async function logout() {
    try { await api('/logout', { method: 'POST' }); } catch { /* ignore */ }
    showLogin();
    history.replaceState(null, '', '/admin');
  }

  async function boot() {
    bindGlobalEvents();
    try {
      const res = await fetch('/api/admin/session', { credentials: 'same-origin' });
      if (!res.ok) return showLogin();
      const data = await res.json();
      showApp(data.admin);
      route(true);
    } catch {
      showLogin();
    }
  }

  function bindGlobalEvents() {
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = $('#loginError');
      const btn = $('#loginBtn');
      errorBox.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Memeriksa…';
      try {
        const data = await api('/login', {
          method: 'POST',
          noAuthRedirect: true,
          json: { username: $('#loginUser').value.trim(), password: $('#loginPass').value },
        });
        showApp(data.admin);
        state.page = '';
        if (!location.hash) history.replaceState(null, '', '#dashboard');
        route(true);
        toast(`Selamat datang, ${data.admin.username}!`);
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Masuk Dashboard';
      }
    });

    $('#logoutBtn').addEventListener('click', logout);
    $('#accountLogout')?.addEventListener('click', logout);
    $('#productForm').addEventListener('submit', submitProduct);
    $('#categoryForm').addEventListener('submit', submitCategory);
    $('#stockForm').addEventListener('submit', submitStock);
    $('#confirmYes').addEventListener('click', () => {
      const resolve = pendingConfirm;
      pendingConfirm = null;
      closeModalElement($('#confirmModal'));
      if (resolve) resolve(true);
    });

    $('#pImageFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        toast('Mengunggah gambar…');
        const url = await uploadImage(file);
        $('#pImage').value = url;
        setPreview(url);
        toast('Gambar terunggah.');
      } catch (err) { toast(err.message, true); }
    });
    $('#pImage').addEventListener('input', (e) => setPreview(e.target.value.trim()));

    $('#hambAdmin').addEventListener('click', () => {
      $('#sidebar').classList.add('open');
      $('#sbBackdrop').classList.add('open');
    });
    $('#sbBackdrop').addEventListener('click', closeSidebar);

    document.addEventListener('click', (e) => {
      const closer = e.target.closest('[data-close]');
      if (closer) {
        const modal = closer.closest('.modal');
        if (modal) closeModalElement(modal);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = $$('.modal.open').pop();
      if (open) closeModalElement(open);
      else closeSidebar();
    });

    window.addEventListener('hashchange', () => route(true));
  }

  boot();
})();
