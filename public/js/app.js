/* PIZZAKY.AJA storefront — products, cart and WhatsApp checkout. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const CART_KEY = 'pizzaky_cart_v1';

  const state = {
    settings: {},
    categories: [],
    products: [],
    cart: loadCart(),
    category: 'Semua',
    search: '',
    spice: '',
    size: '',
    sort: 'default',
    lastOrder: null,
  };
  let searchTimer = null;

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((it) => it && Number.isFinite(Number(it.id)) && Number(it.qty) > 0)
        .map((it) => ({ id: Number(it.id), qty: Math.min(20, Math.floor(Number(it.qty))) }));
    } catch {
      return [];
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    } catch { /* storage may be disabled */ }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  let toastTimer = null;
  function toast(message, isError = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('err', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  /* ------------------------------------------------------------- store data */

  async function loadStore() {
    try {
      const res = await fetch('/api/store');
      if (!res.ok) throw new Error('Gagal memuat data toko.');
      const data = await res.json();
      state.settings = data.settings || {};
      state.categories = data.categories || [];
      state.products = data.products || [];
      renderSettings();
      renderCategoryChips();
      renderSizeOptions();
      renderProducts();
      renderCart();
    } catch (err) {
      $('#productGrid').innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <h3>Menu belum bisa dimuat</h3><p>${escapeHtml(err.message)} Periksa koneksi lalu muat ulang halaman.</p></div>`;
    }
  }

  function waLink(text) {
    const num = String(state.settings.whatsapp || '').replace(/\D/g, '');
    return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  }

  function renderSettings() {
    const s = state.settings;
    const name = s.store_name || 'PIZZAKY.AJA';
    document.title = `${name} — Taste The Happiness`;
    $('#brandName').firstChild.textContent = name;
    $('#brandSub').textContent = (s.tagline || 'Taste The Happiness').split('—')[0].trim();
    if (s.logo) $('#brandLogo').src = s.logo;
    $('#footerTagline').textContent = s.tagline || '';
    $('#storeAddress').textContent = s.address || '—';
    $('#storeHours').textContent = s.hours || '—';
    $('#contactHours').textContent = s.hours || '—';
    $('#footerAddress').textContent = s.address || '—';
    $('#mapCaption').textContent = name + ' — outlet utama';
    $('#year').textContent = new Date().getFullYear();

    const phoneText = '+' + String(s.whatsapp || '').replace(/\D/g, '');
    const phone = $('#storePhone');
    phone.textContent = phoneText;
    phone.href = waLink(`Halo ${name}, saya mau tanya menu.`);
    $('#waHead').href = waLink(`Halo ${name}, saya mau pesan pizza.`);
    $('#contactWa').href = waLink(`Halo ${name}, saya mau pesan pizza.`);
    $('#contactWaText').textContent = phoneText;
    $('#footerWa').href = waLink(`Halo ${name}, saya mau pesan pizza.`);

    if (s.contact_email) {
      $('#contactEmail').href = 'mailto:' + s.contact_email;
      $('#contactEmailText').textContent = s.contact_email;
      $('#footerEmail').href = 'mailto:' + s.contact_email;
      $('#footerEmail').textContent = s.contact_email;
    }
    if (s.instagram) {
      const handle = String(s.instagram).replace(/^@/, '');
      $('#contactIg').href = 'https://instagram.com/' + encodeURIComponent(handle);
      $('#contactIgText').textContent = '@' + handle;
    }

    const mapsQuery = encodeURIComponent(s.address || name);
    $('#mapFrame').src = `https://maps.google.com/maps?q=${mapsQuery}&z=15&output=embed`;
    $('#mapsLink').href = s.maps_url || `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

    const prices = state.products.map((p) => p.price);
    if (prices.length) $('#heroPrice').textContent = rupiah(Math.min(...prices));
    if (s.banner) {
      const art = $('.hero');
      if (art) art.style.backgroundImage = `linear-gradient(120deg,#53020be6,#a30d1fe0 55%,#6d0410e6), url("${s.banner}")`;
    }
  }

  /* ------------------------------------------------------------ menu render */

  function renderCategoryChips() {
    const items = ['Semua', ...state.categories.map((c) => c.name)];
    $('#categoryChips').innerHTML = items.map((name) => `
      <button class="chip${name === state.category ? ' active' : ''}" type="button" data-category="${escapeHtml(name)}">
        ${escapeHtml(name)}
      </button>`).join('');
  }

  function renderSizeOptions() {
    const sizes = [...new Set(state.products.map((p) => p.size).filter(Boolean))]
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    $('#sizeFilter').innerHTML = '<option value="">Semua ukuran</option>' +
      sizes.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    $('#sizeFilter').value = state.size;
  }

  function spiceLabel(level) {
    if (!level) return 'Tidak pedas';
    return '🌶 ' + 'Lv ' + level;
  }

  function filteredProducts() {
    let list = state.products.slice();
    if (state.category !== 'Semua') list = list.filter((p) => p.category === state.category);
    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    if (state.spice !== '') list = list.filter((p) => p.spice_level === Number(state.spice));
    if (state.size) list = list.filter((p) => p.size === state.size);
    if (state.sort === 'cheap') list.sort((a, b) => a.price - b.price);
    else if (state.sort === 'expensive') list.sort((a, b) => b.price - a.price);
    else if (state.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'id'));
    return list;
  }

  function cartQty(id) {
    const line = state.cart.find((l) => l.id === id);
    return line ? line.qty : 0;
  }

  function renderProducts() {
    const list = filteredProducts();
    const grid = $('#productGrid');
    $('#resultCount').textContent = `${list.length} menu`;
    if (!list.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <h3>Tidak ada menu yang cocok</h3>
        <p>Coba kata kunci lain atau reset filter untuk melihat semua pizza.</p></div>`;
      return;
    }
    grid.innerHTML = list.map((p) => {
      const qty = cartQty(p.id);
      const out = p.stock <= 0;
      const low = !out && p.stock <= 5;
      const stockTag = out ? '<span class="stock-tag out">Habis</span>'
        : low ? `<span class="stock-tag low">Sisa ${p.stock}</span>`
          : `<span class="stock-tag">Tersedia</span>`;
      return `<article class="card">
        <div class="card-media">
          <span class="badge${p.spice_level >= 5 ? ' hot' : ''}">${escapeHtml(p.category || 'Pizza')}</span>
          ${stockTag}
          <img src="${escapeHtml(p.image || '/images/logo.svg')}" alt="${escapeHtml(p.name)}" loading="lazy"
               onerror="this.onerror=null;this.src='/images/logo.svg'">
          <span class="spice">${spiceLabel(p.spice_level)}</span>
        </div>
        <div class="card-body">
          <h3>${escapeHtml(p.name)}</h3>
          <p class="card-desc">${escapeHtml(p.description)}</p>
          <div class="card-meta"><span>${escapeHtml(p.size)}</span><span>Stok ${p.stock}</span></div>
          <div class="card-foot">
            <div class="price">${rupiah(p.price)}<small>per loyang</small></div>
            ${out ? '<button class="add-btn" disabled type="button">Habis</button>'
              : qty > 0
                ? `<div class="stepper">
                    <button type="button" data-dec="${p.id}" aria-label="Kurangi ${escapeHtml(p.name)}">−</button>
                    <span>${qty}</span>
                    <button type="button" data-inc="${p.id}" aria-label="Tambah ${escapeHtml(p.name)}">+</button>
                  </div>`
                : `<button class="add-btn" type="button" data-add="${p.id}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                    Tambah
                  </button>`}
          </div>
        </div>
      </article>`;
    }).join('');
  }

  /* ---------------------------------------------------------------- cart */

  function cartLines() {
    return state.cart.map((line) => {
      const product = state.products.find((p) => p.id === line.id);
      if (!product) return null;
      return { ...line, product, subtotal: product.price * line.qty };
    }).filter(Boolean);
  }

  function cartTotals() {
    const lines = cartLines();
    return { lines, total: lines.reduce((s, l) => s + l.subtotal, 0) };
  }

  function syncCart() {
    // Drop products that no longer exist and clamp to available stock.
    state.cart = state.cart.filter((line) => {
      const product = state.products.find((p) => p.id === line.id);
      if (!product) return false;
      line.qty = Math.min(line.qty, Math.max(0, product.stock), 20);
      return line.qty > 0;
    });
    saveCart();
    renderProducts();
    renderCart();
  }

  function renderCart() {
    const { lines, total } = cartTotals();
    const count = lines.reduce((s, l) => s + l.qty, 0);
    $('#cartCount').textContent = count;
    $('#cartHeadNote').textContent = `${count} item dipilih`;
    $('#cartSubtotal').textContent = rupiah(total);
    $('#cartTotal').textContent = rupiah(total);
    $('#checkoutBtn').disabled = count === 0;

    const body = $('#cartBody');
    if (!lines.length) {
      body.innerHTML = `<div class="cart-empty">
        <img src="/images/hero-pizza.svg" alt="">
        <b>Keranjang masih kosong</b>
        <p>Yuk pilih pizza favoritmu di menu.</p>
      </div>`;
      return;
    }
    body.innerHTML = lines.map((line) => `
      <div class="cart-line">
        <img src="${escapeHtml(line.product.image || '/images/logo.svg')}" alt="" onerror="this.onerror=null;this.src='/images/logo.svg'">
        <div>
          <h4>${escapeHtml(line.product.name)}</h4>
          <div class="line-meta">${escapeHtml(line.product.size)} · ${rupiah(line.product.price)}</div>
          <div class="line-price">${rupiah(line.subtotal)}</div>
          <div class="qty-row">
            <button class="qty-btn" type="button" data-dec="${line.id}" aria-label="Kurangi">−</button>
            <span>${line.qty}</span>
            <button class="qty-btn" type="button" data-inc="${line.id}" aria-label="Tambah">+</button>
            <button class="remove-line" type="button" data-remove="${line.id}">Hapus</button>
          </div>
        </div>
        <div style="font-size:11px;color:var(--muted);align-self:start">stok ${line.product.stock}</div>
      </div>`).join('');
  }

  function openDrawer() {
    $('#cartDrawer').classList.add('open');
    $('#overlay').classList.add('open');
    $('#cartDrawer').setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    $('#cartDrawer').classList.remove('open');
    $('#overlay').classList.remove('open');
    $('#cartDrawer').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function changeQty(id, delta) {
    const product = state.products.find((p) => p.id === id);
    if (!product) return;
    const line = state.cart.find((l) => l.id === id);
    if (!line) {
      if (delta > 0) addToCart(id);
      return;
    }
    if (delta > 0 && line.qty >= product.stock) {
      toast(`Stok ${product.name} tinggal ${product.stock}.`, true);
      return;
    }
    line.qty += delta;
    if (line.qty <= 0) state.cart = state.cart.filter((l) => l.id !== id);
    syncCart();
  }

  function addToCart(id) {
    const product = state.products.find((p) => p.id === id);
    if (!product) return;
    if (product.stock <= 0) return toast('Produk ini sedang habis.', true);
    const line = state.cart.find((l) => l.id === id);
    if (line) return changeQty(id, 1);
    state.cart.push({ id, qty: 1 });
    syncCart();
    toast(`${product.name} masuk keranjang 🍕`);
  }

  function removeFromCart(id) {
    state.cart = state.cart.filter((l) => l.id !== id);
    syncCart();
  }

  /* ------------------------------------------------------------ checkout */

  function openCheckout() {
    const { lines, total } = cartTotals();
    if (!lines.length) return;
    $('#orderRecap').innerHTML = lines.map((l) =>
      `<div><span>${escapeHtml(l.product.name)} × ${l.qty}</span><b>${rupiah(l.subtotal)}</b></div>`
    ).join('') + `<div style="border-top:1px dashed #f0cfb4;margin-top:8px;padding-top:8px">
      <span style="font-weight:800;color:var(--ink)">Total</span><b style="color:var(--red)">${rupiah(total)}</b></div>`;
    $('#formError').hidden = true;
    $('#checkoutForm').hidden = false;
    $('#successView').hidden = true;
    $('#checkoutForm').reset();
    $$('.field', $('#checkoutForm')).forEach((f) => f.classList.remove('invalid'));
    $('#checkoutModal').classList.add('open');
    $('#checkoutModal').setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#custName').focus(), 150);
  }

  function closeCheckout() {
    $('#checkoutModal').classList.remove('open');
    $('#checkoutModal').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function validateCheckout(data) {
    const errors = [];
    if (data.name.length < 2) errors.push(['custName', 'Nama minimal 2 karakter.']);
    const digits = data.whatsapp.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) errors.push(['custWa', 'Nomor WhatsApp tidak valid.']);
    if (data.address.length < 8) errors.push(['custAddress', 'Alamat minimal 8 karakter.']);
    return errors;
  }

  async function submitOrder(event) {
    event.preventDefault();
    const form = $('#checkoutForm');
    const errorBox = $('#formError');
    const btn = $('#submitOrder');
    $$('.field', form).forEach((f) => f.classList.remove('invalid'));
    errorBox.hidden = true;

    const data = {
      name: $('#custName').value.trim(),
      whatsapp: $('#custWa').value.trim(),
      address: $('#custAddress').value.trim(),
      notes: $('#custNotes').value.trim(),
    };
    const errors = validateCheckout(data);
    if (errors.length) {
      errors.forEach(([id]) => $('#' + id).closest('.field').classList.add('invalid'));
      errorBox.textContent = errors[0][1];
      errorBox.hidden = false;
      $('#' + errors[0][0]).focus();
      return;
    }

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Memproses pesanan…';
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          items: state.cart.map((l) => ({ productId: l.id, qty: l.qty })),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Pesanan gagal dibuat.');

      state.lastOrder = payload;
      state.cart = [];
      saveCart();
      await loadStore();

      $('#successName').textContent = data.name.split(' ')[0];
      $('#orderCode').textContent = payload.order.code;
      $('#orderTotal').textContent = rupiah(payload.order.total);
      $('#waLinkBtn').href = payload.waLink;
      form.hidden = true;
      $('#successView').hidden = false;
      closeDrawer();
      toast('Pesanan berhasil dicatat!');
      window.open(payload.waLink, '_blank', 'noopener');
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  /* ---------------------------------------------------------------- wiring */

  function bindEvents() {
    $('#cartBtn').addEventListener('click', openDrawer);
    $('#closeCart').addEventListener('click', closeDrawer);
    $('#overlay').addEventListener('click', closeDrawer);
    $('#checkoutBtn').addEventListener('click', () => { closeDrawer(); openCheckout(); });
    $('#clearCart').addEventListener('click', () => {
      if (!state.cart.length) return;
      state.cart = [];
      syncCart();
      toast('Keranjang dikosongkan.');
    });

    // Any add / increment / decrement button, in the grid or in the drawer.
    document.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-add],[data-inc],[data-dec],[data-remove],[data-category]');
      if (!btn) return;
      if (btn.dataset.add) addToCart(Number(btn.dataset.add));
      else if (btn.dataset.inc) changeQty(Number(btn.dataset.inc), 1);
      else if (btn.dataset.dec) changeQty(Number(btn.dataset.dec), -1);
      else if (btn.dataset.remove) removeFromCart(Number(btn.dataset.remove));
      else if (btn.dataset.category) {
        state.category = btn.dataset.category;
        renderCategoryChips();
        renderProducts();
      }
    });

    $('#searchInput').addEventListener('input', (event) => {
      clearTimeout(searchTimer);
      const value = event.target.value;
      searchTimer = setTimeout(() => {
        state.search = value.trim();
        renderProducts();
      }, 180);
    });
    $('#spiceFilter').addEventListener('change', (e) => { state.spice = e.target.value; renderProducts(); });
    $('#sizeFilter').addEventListener('change', (e) => { state.size = e.target.value; renderProducts(); });
    $('#sortFilter').addEventListener('change', (e) => { state.sort = e.target.value; renderProducts(); });
    $('#resetFilters').addEventListener('click', () => {
      state.category = 'Semua';
      state.search = '';
      state.spice = '';
      state.size = '';
      state.sort = 'default';
      $('#searchInput').value = '';
      $('#spiceFilter').value = '';
      $('#sizeFilter').value = '';
      $('#sortFilter').value = 'default';
      renderCategoryChips();
      renderProducts();
    });

    $('#checkoutForm').addEventListener('submit', submitOrder);
    $$('[data-close-modal]').forEach((el) => el.addEventListener('click', closeCheckout));
    $('#finishBtn').addEventListener('click', () => {
      closeCheckout();
      document.getElementById('menu').scrollIntoView({ behavior: 'smooth' });
    });

    $('#hamb').addEventListener('click', () => {
      const nav = $('#nav');
      const open = nav.classList.toggle('open');
      $('#hamb').setAttribute('aria-expanded', String(open));
    });
    $$('#nav a').forEach((link) => link.addEventListener('click', () => {
      $('#nav').classList.remove('open');
      $('#hamb').setAttribute('aria-expanded', 'false');
    }));

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if ($('#checkoutModal').classList.contains('open')) closeCheckout();
      else if ($('#cartDrawer').classList.contains('open')) closeDrawer();
    });

    // Scroll spy for the header navigation.
    const sections = ['beranda', 'menu', 'lokasi', 'tentang', 'kontak']
      .map((id) => document.getElementById(id)).filter(Boolean);
    const links = $$('#nav a');
    const spy = () => {
      const y = window.scrollY + 120;
      let current = sections[0];
      for (const section of sections) if (section.offsetTop <= y) current = section;
      links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + current.id));
    };
    window.addEventListener('scroll', spy, { passive: true });
    spy();
  }

  bindEvents();
  renderCart();
  loadStore();
})();
