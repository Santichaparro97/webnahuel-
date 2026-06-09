// ===== STATE =====
let TENANT = null;
let PRODUCTS = [];
let CATEGORIES = [];
let OPEN_CATEGORIES = new Set();
let CURRENT_SEARCH = '';
let CAT_LIMITS = {}; // per-category visible limit
let CART = JSON.parse(localStorage.getItem('cart') || '[]');
let CURRENT_PRODUCT = null;
let CURRENT_QTY = 1;
let VISIBLE_LIMIT = 60;
const PAGE_SIZE = 60;

// ===== UTILS =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const fmtPrice = (n) => n === 0 ? 'Consultar' : '$' + Number(n).toLocaleString('es-AR');
const saveCart = () => localStorage.setItem('cart', JSON.stringify(CART));
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

// ===== INIT =====
async function init() {
  // Si Supabase está configurado, esperamos a que cargue antes de seguir
  if (window.__supabaseDataReady) {
    try { await window.__supabaseDataReady; } catch (e) { console.warn('Supabase falló, sigo con legacy:', e); }
  }
  let data;
  if (window.DATA) {
    data = window.DATA;
  } else {
    const res = await fetch('data/data.json');
    data = await res.json();
  }
  TENANT = data.tenant;
  // Pency migró las imágenes de AWS S3 a DigitalOcean Spaces.
  // Reescribimos el host para que las URLs viejas también carguen.
  const fixUrl = (u) => typeof u === 'string'
    ? u.replace('tap-pencyinfra-prod.s3.amazonaws.com', 'pency-images.nyc3.digitaloceanspaces.com')
    : u;
  if (TENANT.logo) TENANT.logo = fixUrl(TENANT.logo);
  if (TENANT.banner) TENANT.banner = fixUrl(TENANT.banner);
  PRODUCTS = (data.products || [])
    .filter(p => p && p.title)
    .map(p => ({ ...p, images: (p.images || []).map(fixUrl) }));
  CATEGORIES = [...new Set(PRODUCTS.map(p => p.category).filter(Boolean))]
    .map(name => ({ name, count: PRODUCTS.filter(p => p.category === name).length }))
    .sort((a, b) => b.count - a.count);

  renderTenant();
  renderFeatured();
  renderCategoryCards();
  bindEvents();
  updateCartCount();
  initAutoHideHeader();
}

// ===== AUTO-HIDE HEADER =====
// Esconde el header al scrollear hacia abajo, lo trae de vuelta al scrollear
// hacia arriba. Usa rAF para no saturar el scroll handler.
function initAutoHideHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  let lastY = window.scrollY;
  let ticking = false;
  const THRESHOLD = 5; // px mínimos de movimiento para reaccionar (anti-jitter)
  const TOP_GUARD = 12; // siempre visible cerca del top

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const dy = y - lastY;
      if (y < TOP_GUARD) {
        // Arriba del todo: siempre visible
        header.classList.remove('is-hidden');
      } else if (dy > THRESHOLD) {
        // Scroll hacia abajo → esconder
        header.classList.add('is-hidden');
      } else if (dy < -THRESHOLD) {
        // Scroll hacia arriba → mostrar
        header.classList.remove('is-hidden');
      }
      lastY = y;
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
}

// ===== CATEGORY CARDS (rediseño pestaña 2) =====
const CARD_THEMES = ['cyan', 'blue', 'magenta', 'purple', 'gold', 'cyan', 'blue', 'purple'];
const CARD_ICONS = {
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2"/></svg>',
  male: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="14" r="5"/><path d="M14 10l6-6M14 4h6v6"/></svg>',
  female: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="9" r="5"/><path d="M12 14v8M9 19h6"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="13"/><path d="M3 12h18M12 8v13M12 8s-2-4-5-4-3 3 0 4M12 8s2-4 5-4 3 3 0 4"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2s4 4 4 9a4 4 0 11-8 0c0-3 2-5 2-7l2-2z"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>',
  drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.5s6 7 6 12a6 6 0 11-12 0c0-5 6-12 6-12z"/></svg>',
  diamond: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12l4 6-10 12L2 9l4-6z"/><path d="M11 3L8 9l4 12M13 3l3 6-4 12M2 9h20"/></svg>',
};
// Mapping: ícono + descripción + tema por nombre exacto de categoría
const CATEGORY_META = {
  'Réplica Importada':                     { icon: 'star',    desc: 'Las mejores réplicas importadas de alta calidad.' },
  'Perfumes AA hombre':                    { icon: 'male',    desc: 'Perfumes árabes y alternativos para hombre.' },
  'Perfumes AA mujer':                     { icon: 'female',  desc: 'Fragancias árabes y alternativas para mujer.' },
  'Replicas mini':                         { icon: 'gift',    desc: 'Presentaciones mini para probar y llevar.' },
  'TUBOS ARABES 35ml':                     { icon: 'flame',   desc: 'Tubos árabes de 35ml, prácticos y elegantes.' },
  'Replicas Árabes':                       { icon: 'moon',    desc: 'Las mejores réplicas árabes al mejor precio.' },
  'TUBOS 35ml':                            { icon: 'drop',    desc: 'Perfumes en tubo de 35ml. Ideales para revender.' },
  'Replicas Mini Arabes':                  { icon: 'diamond', desc: 'Miniaturas árabes para todos los gustos.' },
  'Perfumes Árabes (originales)':          { icon: 'star',    desc: 'Perfumes árabes originales seleccionados.' },
  'Body Splash Réplica Victoria’s Secret': { icon: 'female',  desc: 'Body splash réplica de las mejores fragancias.' },
  'Body Splash Arabe':                     { icon: 'drop',    desc: 'Body splash árabes refrescantes.' },
  'Especial Lata y Otros':                 { icon: 'gift',    desc: 'Presentaciones especiales en lata y más.' },
  'Cremas Victoria’s Secret':              { icon: 'female',  desc: 'Cremas perfumadas Victoria\'s Secret.' },
  'Body Splash Mini':                      { icon: 'gift',    desc: 'Body splash en presentación mini.' },
  'Réplicas Premium AAA de mujer':         { icon: 'female',  desc: 'Réplicas AAA premium para mujer.' },
  'Réplicas Premium AAA de hombre':        { icon: 'male',    desc: 'Réplicas AAA premium para hombre.' },
  'OFERTAS!!':                             { icon: 'flame',   desc: '¡Aprovechá nuestras ofertas exclusivas!' },
  'Body Splash Dupe Victoria’s Secret':    { icon: 'female',  desc: 'Body splash dupe de las clásicas Victoria\'s Secret.' },
  'Probadores':                            { icon: 'drop',    desc: 'Probadores para descubrir nuevas fragancias.' },
  'Crema para Manos':                      { icon: 'female',  desc: 'Cremas para manos hidratantes y perfumadas.' },
  'Karseell Original':                     { icon: 'star',    desc: 'Productos Karseell Original.' },
  'SET SKINCARE':                          { icon: 'gift',    desc: 'Sets de skincare seleccionados.' },
};
const CARDS_PER_PAGE = 8;
let CARDS_PAGE = 0;
let CARDS_SEARCH = '';

function getCategoriesFiltered() {
  if (!CARDS_SEARCH) return CATEGORIES;
  const q = CARDS_SEARCH.toLowerCase();
  return CATEGORIES.filter(c => c.name.toLowerCase().includes(q));
}

function renderCategoryCards() {
  const grid = $('#category-cards-grid');
  if (!grid) return;
  const cats = getCategoriesFiltered();
  const totalPages = Math.max(1, Math.ceil(cats.length / CARDS_PER_PAGE));
  if (CARDS_PAGE >= totalPages) CARDS_PAGE = totalPages - 1;
  if (CARDS_PAGE < 0) CARDS_PAGE = 0;

  const start = CARDS_PAGE * CARDS_PER_PAGE;
  const page = cats.slice(start, start + CARDS_PER_PAGE);
  grid.innerHTML = '';

  if (page.length === 0) {
    grid.innerHTML = '<p class="empty" style="grid-column:1/-1">No se encontraron categorías.</p>';
  } else {
    page.forEach((cat, idx) => grid.appendChild(makeCategoryCard(cat, idx)));
  }

  const prev = $('#cat-prev'), next = $('#cat-next');
  if (prev) prev.disabled = CARDS_PAGE <= 0;
  if (next) next.disabled = CARDS_PAGE >= totalPages - 1;

  // Indicador de página: "X / Y"
  const indicator = $('#cat-pages-indicator');
  if (indicator) indicator.textContent = `${CARDS_PAGE + 1} / ${totalPages}`;
}

function makeCategoryCard(cat, indexInPage) {
  const meta = CATEGORY_META[cat.name] || { icon: 'star', desc: 'Productos seleccionados.' };
  const theme = CARD_THEMES[indexInPage % CARD_THEMES.length];
  const product = PRODUCTS.find(p =>
    p.category === cat.name && p.images && p.images[0]
  );

  const el = document.createElement('article');
  el.className = `category-card theme-${theme}`;
  const titleLen = cat.name.length;
  const sizeClass = titleLen <= 20 ? 'size-lg' : titleLen <= 30 ? 'size-md' : 'size-sm';

  // Cata image cíclica: 12 imágenes → cada categoría obtiene una.
  // El índice se toma del array GLOBAL de categorías para que la misma
  // categoría tenga siempre la misma imagen (no cambia entre páginas).
  const globalIndex = CATEGORIES.findIndex(c => c.name === cat.name);
  const cataNum = (globalIndex % 12) + 1;
  el.style.backgroundImage = `url('catalogo/cata${cataNum}.png')`;

  el.innerHTML = `
    <div class="card-overlay"></div>
    <div class="card-info">
      <h3 class="card-title ${sizeClass}">${escapeHtml(cat.name)}</h3>
      <p class="card-desc">${escapeHtml(meta.desc)}</p>
      <span class="card-explorar">
        Explorar
        <span class="card-explorar-count">${cat.count} productos</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
      </span>
    </div>
    <div class="card-icon">${CARD_ICONS[meta.icon] || CARD_ICONS.star}</div>
  `;
  el.onclick = () => openCategoryFromCard(cat.name);
  return el;
}

// ===== Vista de productos de una categoría =====
// Reemplaza las cards por la grilla de productos de la categoría seleccionada.
// Bot. "Volver a categorías" restaura las cards.
let CAT_PRODUCTS_LIMIT = 24;

function openCategoryFromCard(name) {
  const view = $('#categories-view');
  const productsView = $('#category-products-view');
  if (!view || !productsView) return;

  view.classList.add('is-viewing-products');
  productsView.hidden = false;

  $('#category-products-title').textContent = name;
  const total = PRODUCTS.filter(p => p.category === name).length;
  $('#category-products-count').textContent = `${total} producto${total === 1 ? '' : 's'}`;

  CAT_PRODUCTS_LIMIT = 24;
  renderCategoryProductsView(name);

  // Scroll al inicio de la vista
  setTimeout(() => {
    view.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function renderCategoryProductsView(name) {
  const grid = $('#category-products-grid');
  const loadMoreWrap = $('#category-products-loadmore');
  if (!grid) return;
  const list = PRODUCTS.filter(p => p.category === name);
  grid.innerHTML = '';
  loadMoreWrap.innerHTML = '';

  const frag = document.createDocumentFragment();
  list.slice(0, CAT_PRODUCTS_LIMIT).forEach(p => frag.appendChild(productCard(p)));
  grid.appendChild(frag);

  if (list.length > CAT_PRODUCTS_LIMIT) {
    const btn = document.createElement('button');
    btn.className = 'load-more-btn';
    btn.textContent = `Ver más (${list.length - CAT_PRODUCTS_LIMIT} restantes)`;
    btn.onclick = () => {
      CAT_PRODUCTS_LIMIT += 24;
      renderCategoryProductsView(name);
    };
    loadMoreWrap.style.cssText = 'text-align:center; padding: 30px 20px 10px;';
    loadMoreWrap.appendChild(btn);
  }
}

function backToCategoryCards() {
  const view = $('#categories-view');
  const productsView = $('#category-products-view');
  if (!view || !productsView) return;
  view.classList.remove('is-viewing-products');
  productsView.hidden = true;
  setTimeout(() => {
    view.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

// ===== PODIUM HERO =====
// Carga 4 botellas reales del catálogo (con imagen y stock) para el podio del hero.
function renderPodium() {
  const wrap = $('#podium-bottles');
  if (!wrap) return;
  // Picks: con imagen, en stock, de marcas reconocibles (top categorías AAA)
  const goodCats = [
    'Réplica Importada',
    'Réplicas Premium AAA de hombre',
    'Réplicas Premium AAA de mujer',
    'Perfumes AA hombre',
  ];
  const picks = [];
  goodCats.forEach(cat => {
    const candidate = PRODUCTS.find(p =>
      p.category === cat &&
      p.images && p.images[0] &&
      !(p.handleStock && p.currentStock <= 0) &&
      !picks.some(x => x.id === p.id)
    );
    if (candidate) picks.push(candidate);
  });
  // Fallback: si faltan, agarrar los primeros con imagen
  while (picks.length < 4) {
    const next = PRODUCTS.find(p =>
      p.images && p.images[0] && !picks.some(x => x.id === p.id)
    );
    if (!next) break;
    picks.push(next);
  }
  picks.slice(0, 4).forEach(p => {
    const img = document.createElement('img');
    img.src = p.images[0];
    img.alt = p.title;
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => { img.style.opacity = 0.2; };
    wrap.appendChild(img);
  });
}

// ===== TENANT =====
function renderTenant() {
  const cleanTitle = (TENANT.title || '').replace(/\s*-\s*Tienda online\s*$/i, '').trim();
  $('#title').textContent = cleanTitle;
  $('#footer-title').textContent = cleanTitle;
  $('#year').textContent = new Date().getFullYear();
  $('#hero-count').textContent = PRODUCTS.length.toLocaleString('es-AR');
  document.title = TENANT.title || 'Tienda';

  const logo = $('#logo');
  if (TENANT.logo) {
    logo.src = TENANT.logo;
    logo.alt = TENANT.title || 'logo';
    logo.onerror = () => { logo.removeAttribute('src'); };
  }

  const igHref = TENANT.instagram ? 'https://instagram.com/' + TENANT.instagram.split('?')[0] : null;
  const wspHref = TENANT.phone ? 'https://wa.me/' + TENANT.phone : null;
  [['#instagram-link', igHref], ['#footer-ig', igHref]].forEach(([sel, href]) => {
    const el = $(sel);
    if (!el) return;
    if (href) el.href = href; else el.style.display = 'none';
  });
  [['#whatsapp-link', wspHref], ['#footer-wsp', wspHref], ['#topbar-wsp', wspHref], ['#hero-wsp', wspHref]].forEach(([sel, href]) => {
    const el = $(sel);
    if (!el) return;
    if (href) el.href = href; else el.style.display = 'none';
  });
}

// ===== FEATURED CAROUSEL (más vendidos) =====
// 8 cards con imágenes pre-armadas. Click → busca el producto en la DB y
// abre el modal. Auto-scroll infinito izq → der con pausa al hover.
const FEATURED_CARDS = [
  // 4 hombre — title y price son los que se muestran abajo de la imagen
  { img: 'masvendido/sauvage-dior.png',     title: 'SAUVAGE PARFUM - DIOR',          price: 8300,  match: ['SAUVAGE', 'Dior'] },
  { img: 'masvendido/bleu-chanel.png',      title: 'BLEU DE CHANEL PARFUM',          price: 11000, match: ['BLEU', 'CHANEL'] },
  { img: 'masvendido/club-de-nuit.png',     title: 'CLUB DE NUIT INTENSE MAN',       price: 9250,  match: ['CLUB DE NUIT', 'INTENSE'] },
  { img: 'masvendido/212-men-aqua.png',     title: '212 MEN AQUA - CAROLINA HERRERA', price: 11000, match: ['212 MEN AQUA'] },
  // 4 mujer
  { img: 'masvendido/212-vip-black.png',    title: '212 VIP BLACK - CAROLINA HERRERA', price: 12000, match: ['212 VIP BLACK'] },
  { img: 'masvendido/black-opium.png',      title: 'BLACK OPIUM - YVES SAINT LAURENT', price: 12500, match: ['BLACK OPIUM'] },
  { img: 'masvendido/good-girl.png',        title: 'GOOD GIRL - CAROLINA HERRERA',   price: 12000, match: ['GOOD GIRL'] },
  { img: 'masvendido/la-vie-est-belle.png', title: 'LA VIE EST BELLE - LANCÔME',     price: 11500, match: ['LA VIE EST BELLE', 'VIE EST BELLE'] },
];

function findProductByKeywords(keywords) {
  // Busca el producto cuyo título contenga todas las keywords (case insensitive)
  // Prefiere los que tengan stock > 0
  const upperKws = keywords.map(k => k.toUpperCase());
  const matches = PRODUCTS.filter(p => {
    const title = (p.title || '').toUpperCase();
    return upperKws.every(kw => title.includes(kw));
  });
  if (matches.length === 0) return null;
  // Priorizar con stock
  const inStock = matches.find(p => !(p.handleStock && p.currentStock <= 0));
  return inStock || matches[0];
}

function renderFeatured() {
  const section = $('#featured-section');
  if (!section) return;
  section.hidden = false;
  const track = $('#featured-track');
  track.innerHTML = '';

  // Genero los 8 cards, cada uno linkeado a un producto real (si existe)
  const cards = FEATURED_CARDS.map(c => {
    const product = findProductByKeywords(c.match);
    return { ...c, product };
  });

  // Duplico para loop infinito perfecto
  const allCards = [...cards, ...cards];
  allCards.forEach(c => track.appendChild(makeFeaturedCard(c)));

  // Activar auto-scroll después de un frame
  requestAnimationFrame(() => startFeaturedAutoScroll(track, cards.length));

  // Oculto las flechas (ya no se usan, hay auto-scroll)
  const prev = $('#carousel-prev');
  const next = $('#carousel-next');
  if (prev) prev.style.display = 'none';
  if (next) next.style.display = 'none';
}

function makeFeaturedCard(card) {
  const el = document.createElement('article');
  el.className = 'featured-card';
  el.innerHTML = `
    <div class="fc-image">
      <img src="${escapeHtml(card.img)}" alt="${escapeHtml(card.title)}" loading="lazy" />
    </div>
    <div class="fc-info">
      <h3 class="fc-title">${escapeHtml(card.title)}</h3>
      <p class="fc-price">${fmtPrice(card.price)}</p>
    </div>
  `;
  if (card.product) {
    el.onclick = () => openProduct(card.product);
  } else {
    el.onclick = () => {
      const cat = document.getElementById('categories');
      if (cat) cat.scrollIntoView({ behavior: 'smooth' });
    };
  }
  return el;
}

let FEATURED_RAF;
function startFeaturedAutoScroll(track, originalCount) {
  // Scroll continuo izq → der vía JS rAF. Se reinicia cuando llega al 50%
  // del contenido (segundo duplicado) para loop seamless.
  let pos = 0;
  let lastT = performance.now();
  const SPEED_PX_S = 30; // lento y elegante (~15s por card cruzando)
  let paused = false;
  track.addEventListener('mouseenter', () => { paused = true; });
  track.addEventListener('mouseleave', () => { paused = false; });

  function frame(now) {
    const dt = (now - lastT) / 1000;
    lastT = now;
    if (!paused) {
      pos += SPEED_PX_S * dt;
      const half = track.scrollWidth / 2;
      if (pos >= half) pos -= half;
      track.style.transform = `translate3d(${-pos}px, 0, 0)`;
    }
    FEATURED_RAF = requestAnimationFrame(frame);
  }
  if (FEATURED_RAF) cancelAnimationFrame(FEATURED_RAF);
  FEATURED_RAF = requestAnimationFrame(frame);
}

// ===== CATEGORY ACCORDION =====
function renderCategoryAccordion() {
  const list = $('#categories-list');
  list.innerHTML = '';
  CATEGORIES.forEach(({ name, count }) => {
    const products = PRODUCTS.filter(p => p.category === name);
    const previewImgs = products
      .map(p => p.images?.[0])
      .filter(Boolean)
      .slice(0, 6);

    const row = document.createElement('div');
    row.className = 'cat-row reveal' + (OPEN_CATEGORIES.has(name) ? ' open' : '');

    const header = document.createElement('button');
    header.className = 'cat-header';
    header.setAttribute('aria-expanded', OPEN_CATEGORIES.has(name) ? 'true' : 'false');
    header.innerHTML = `
      <span class="cat-count">${count}</span>
      <span class="cat-name">${escapeHtml(name)}</span>
      <span class="cat-preview" aria-hidden="true">
        ${previewImgs.map(src =>
          `<img loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(src)}" onerror="this.style.display='none'" alt="" />`
        ).join('')}
      </span>
      <span class="chevron">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </span>
    `;
    header.onclick = () => toggleCategory(name);
    row.appendChild(header);

    const body = document.createElement('div');
    body.className = 'cat-body';
    body.innerHTML = `<div class="products-grid" data-cat="${escapeHtml(name)}"></div>`;
    row.appendChild(body);

    list.appendChild(row);

    if (OPEN_CATEGORIES.has(name)) {
      renderCategoryProducts(name);
    }
  });
}

function toggleCategory(name) {
  if (OPEN_CATEGORIES.has(name)) {
    OPEN_CATEGORIES.delete(name);
    const row = [...$$('.cat-row')].find(r =>
      r.querySelector('.cat-name')?.textContent === name
    );
    if (row) {
      row.classList.remove('open');
      row.querySelector('.cat-header').setAttribute('aria-expanded', 'false');
    }
  } else {
    OPEN_CATEGORIES.add(name);
    CAT_LIMITS[name] = CAT_LIMITS[name] || PAGE_SIZE;
    const row = [...$$('.cat-row')].find(r =>
      r.querySelector('.cat-name')?.textContent === name
    );
    if (row) {
      row.classList.add('open');
      row.querySelector('.cat-header').setAttribute('aria-expanded', 'true');
      renderCategoryProducts(name);
      // Scroll the row into view after expanding
      setTimeout(() => {
        const rect = row.getBoundingClientRect();
        if (rect.top < 80) {
          window.scrollTo({ top: window.scrollY + rect.top - 80, behavior: 'smooth' });
        }
      }, 50);
    }
  }
}

function renderCategoryProducts(name) {
  const row = [...$$('.cat-row')].find(r =>
    r.querySelector('.cat-name')?.textContent === name
  );
  if (!row) return;
  const grid = row.querySelector('.products-grid');
  grid.innerHTML = '';
  const products = PRODUCTS.filter(p => p.category === name);
  const limit = CAT_LIMITS[name] || PAGE_SIZE;
  const frag = document.createDocumentFragment();
  products.slice(0, limit).forEach(p => frag.appendChild(productCard(p)));
  grid.appendChild(frag);

  if (products.length > limit) {
    const wrap = document.createElement('div');
    wrap.className = 'load-more-wrap';
    const btn = document.createElement('button');
    btn.className = 'load-more-btn';
    btn.textContent = `Ver más (${products.length - limit} restantes)`;
    btn.onclick = () => {
      CAT_LIMITS[name] = (CAT_LIMITS[name] || PAGE_SIZE) + PAGE_SIZE;
      renderCategoryProducts(name);
    };
    wrap.appendChild(btn);
    grid.appendChild(wrap);
  }
}

// ===== SEARCH VIEW =====
function renderSearch() {
  const searchView = $('#search-view');
  const catView = $('#categories-view');
  const grid = $('#products-grid');
  if (!CURRENT_SEARCH) {
    searchView.hidden = true;
    catView.hidden = false;
    return;
  }
  catView.hidden = true;
  searchView.hidden = false;
  const q = CURRENT_SEARCH.toLowerCase();
  const list = PRODUCTS.filter(p =>
    (p.title || '').toLowerCase().includes(q) ||
    (p.description || '').toLowerCase().includes(q) ||
    (p.category || '').toLowerCase().includes(q)
  );
  grid.innerHTML = '';
  $('#empty-msg').hidden = list.length > 0;
  $('#results-count').textContent = `${list.length} resultado${list.length === 1 ? '' : 's'} para "${CURRENT_SEARCH}"`;
  const limit = Math.min(VISIBLE_LIMIT, list.length);
  const frag = document.createDocumentFragment();
  list.slice(0, limit).forEach(p => frag.appendChild(productCard(p)));
  grid.appendChild(frag);
  if (list.length > limit) {
    const wrap = document.createElement('div');
    wrap.className = 'load-more-wrap';
    const btn = document.createElement('button');
    btn.className = 'load-more-btn';
    btn.textContent = `Ver más (${list.length - limit} restantes)`;
    btn.onclick = () => { VISIBLE_LIMIT += PAGE_SIZE; renderSearch(); };
    wrap.appendChild(btn);
    grid.appendChild(wrap);
  }
}

const FALLBACK_SVG = `<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M10 2h4v3h-4z M9 5h6v2H9z M7 8h10v13H7z"/><circle cx="12" cy="14" r="2.5"/></svg>`;

function fallbackEl(title) {
  return `<div class="img-fallback">${FALLBACK_SVG}<span>${escapeHtml(title || '')}</span></div>`;
}

function productCard(p) {
  const el = document.createElement('article');
  el.className = 'product-card reveal';
  const img = p.images?.[0] || '';
  const noStock = p.handleStock && p.currentStock <= 0;
  const original = p.originalPrice && p.originalPrice > p.price
    ? `<span class="original-price">${fmtPrice(p.originalPrice)}</span>` : '';
  const fallback = fallbackEl(p.title).replace(/"/g, '&quot;');
  el.innerHTML = `
    <div class="img-wrap">
      ${noStock ? '<span class="nostock">Sin stock</span>' : ''}
      ${img
        ? `<img loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(img)}" alt="${escapeHtml(p.title)}" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('beforeend','${fallback}')" />`
        : fallbackEl(p.title)}
    </div>
    <div class="info">
      <div class="cat">${escapeHtml(p.category || '')}</div>
      <h3>${escapeHtml(p.title)}</h3>
      <div class="price">${original}${fmtPrice(p.price)}</div>
    </div>
  `;
  el.onclick = () => openProduct(p);
  return el;
}

// ===== MODAL HELPERS =====
function closeAllModals() {
  $('#product-modal').hidden = true;
  $('#cart-modal').hidden = true;
  document.body.style.overflow = '';
}
function openModal(id) {
  closeAllModals();
  $(id).hidden = false;
  document.body.style.overflow = 'hidden';
}

// ===== PRODUCT MODAL =====
function openProduct(p) {
  CURRENT_PRODUCT = p;
  CURRENT_QTY = 1;
  const modalImg = $('#modal-img');
  const wrap = modalImg.parentElement;
  // remove any previous fallback inside the wrap
  wrap.querySelectorAll('.img-fallback').forEach(n => n.remove());
  modalImg.style.display = '';
  modalImg.alt = p.title;
  if (p.images?.[0]) {
    modalImg.src = p.images[0];
    modalImg.onerror = () => {
      modalImg.style.display = 'none';
      wrap.insertAdjacentHTML('beforeend', fallbackEl(p.title));
    };
  } else {
    modalImg.removeAttribute('src');
    modalImg.style.display = 'none';
    wrap.insertAdjacentHTML('beforeend', fallbackEl(p.title));
  }
  $('#modal-title').textContent = p.title;
  $('#modal-category').textContent = p.category || '';
  $('#modal-price').textContent = fmtPrice(p.price);
  $('#modal-description').textContent = p.description || '';
  $('#qty-val').textContent = '1';
  const noStock = p.handleStock && p.currentStock <= 0;
  $('#modal-stock').textContent = noStock ? 'Sin stock disponible' : '';
  const btn = $('#add-to-cart');
  btn.disabled = noStock;
  btn.textContent = noStock ? 'Sin stock' : 'Agregar al carrito';
  openModal('#product-modal');
}

// ===== CART =====
function addToCart() {
  if (!CURRENT_PRODUCT) return;
  const existing = CART.find(i => i.id === CURRENT_PRODUCT.id);
  if (existing) existing.qty += CURRENT_QTY;
  else CART.push({
    id: CURRENT_PRODUCT.id,
    title: CURRENT_PRODUCT.title,
    price: CURRENT_PRODUCT.price,
    image: CURRENT_PRODUCT.images?.[0] || '',
    qty: CURRENT_QTY,
  });
  saveCart();
  updateCartCount();
  openCart();
}

function updateCartCount() {
  const total = CART.reduce((s, i) => s + i.qty, 0);
  ['#cart-count', '#cart-header-count'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.textContent = total;
    el.classList.toggle('empty', total === 0);
  });
}

function openCart() {
  const itemsEl = $('#cart-items');
  itemsEl.innerHTML = '';
  if (CART.length === 0) {
    itemsEl.innerHTML = '<p class="cart-empty">Tu carrito está vacío</p>';
  } else {
    CART.forEach(item => {
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <img referrerpolicy="no-referrer" src="${escapeHtml(item.image)}" alt="" onerror="this.style.opacity=0.3" />
        <div class="cart-item-info">
          <h4>${escapeHtml(item.title)}</h4>
          <div class="cart-qty">
            <button data-act="dec" aria-label="Restar">−</button>
            <span class="qty-num">${item.qty}</span>
            <button data-act="inc" aria-label="Sumar">+</button>
            <button class="remove" data-act="rm">Quitar</button>
          </div>
        </div>
        <div class="item-price">${fmtPrice(item.price * item.qty)}</div>
      `;
      row.querySelectorAll('button').forEach(b => {
        b.onclick = () => {
          const act = b.dataset.act;
          if (act === 'inc') item.qty++;
          else if (act === 'dec') item.qty = Math.max(1, item.qty - 1);
          else if (act === 'rm') CART = CART.filter(i => i.id !== item.id);
          saveCart();
          updateCartCount();
          openCart();
        };
      });
      itemsEl.appendChild(row);
    });
  }
  const total = CART.reduce((s, i) => s + i.price * i.qty, 0);
  $('#cart-total').textContent = fmtPrice(total);
  $('#checkout-wsp').disabled = CART.length === 0;
  openModal('#cart-modal');
}

async function checkoutWhatsapp() {
  if (CART.length === 0) return;
  const total = CART.reduce((s, i) => s + i.price * i.qty, 0);

  // 1) Guardar el pedido en Supabase si está configurado (no bloquea WhatsApp si falla)
  let orderNumber = null;
  if (window.__sb) {
    try {
      const { data, error } = await window.__sb
        .from('orders')
        .insert({
          items: CART.map(i => ({
            id: i.id, title: i.title, price: i.price, qty: i.qty, image: i.image,
          })),
          subtotal: total,
          total: total,
          payment_method: 'whatsapp',
          status: 'pendiente',
          whatsapp_sent: true,
        })
        .select('order_number')
        .single();
      if (error) console.warn('No se pudo guardar el pedido en DB:', error);
      else orderNumber = data?.order_number;
    } catch (e) { console.warn('Error guardando pedido:', e); }
  }

  // 2) Armar mensaje y abrir WhatsApp
  const lines = ['*Hola! Quiero hacer un pedido:*'];
  if (orderNumber) lines.push(`Pedido #${orderNumber}`);
  lines.push('');
  CART.forEach(i => {
    lines.push(`• ${i.title} x${i.qty} — ${fmtPrice(i.price * i.qty)}`);
  });
  lines.push('', `*Total:* ${fmtPrice(total)}`);
  const msg = encodeURIComponent(lines.join('\n'));
  window.open(`https://wa.me/${TENANT.phone}?text=${msg}`, '_blank');
}

// ===== EVENTS =====
function bindEvents() {
  let searchTO;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTO);
    searchTO = setTimeout(() => {
      CURRENT_SEARCH = e.target.value.trim();
      VISIBLE_LIMIT = PAGE_SIZE;
      renderSearch();
    }, 180);
  });
  $('#clear-search').onclick = () => {
    $('#search').value = '';
    CURRENT_SEARCH = '';
    renderSearch();
  };

  // ----- Catalog cards: pagination + search -----
  const catPrev = $('#cat-prev');
  const catNext = $('#cat-next');
  if (catPrev) catPrev.onclick = () => { CARDS_PAGE--; renderCategoryCards(); };
  if (catNext) catNext.onclick = () => { CARDS_PAGE++; renderCategoryCards(); };
  const catSearch = $('#catalog-search');
  if (catSearch) {
    let catSearchTO;
    catSearch.addEventListener('input', (e) => {
      clearTimeout(catSearchTO);
      catSearchTO = setTimeout(() => {
        CARDS_SEARCH = e.target.value.trim();
        CARDS_PAGE = 0;
        renderCategoryCards();
      }, 160);
    });
  }
  // Back button: vuelve a la grilla de cards
  const backBtn = $('#back-to-categories');
  if (backBtn) backBtn.onclick = backToCategoryCards;

  // CTA mayorista → WhatsApp con mensaje prearmado
  const ctaMayorista = $('#cta-mayorista');
  if (ctaMayorista && TENANT.phone) {
    const msg = encodeURIComponent('Hola! Quería consultar por precios mayoristas.');
    ctaMayorista.href = `https://wa.me/${TENANT.phone}?text=${msg}`;
  }
  $('#qty-minus').onclick = () => { CURRENT_QTY = Math.max(1, CURRENT_QTY - 1); $('#qty-val').textContent = CURRENT_QTY; };
  $('#qty-plus').onclick = () => { CURRENT_QTY++; $('#qty-val').textContent = CURRENT_QTY; };
  $('#add-to-cart').onclick = addToCart;
  $('#cart-fab').onclick = openCart;
  const cartHeader = $('#cart-header');
  if (cartHeader) cartHeader.onclick = openCart;
  // Link Contacto del nav → WhatsApp
  const navContact = $('#nav-contact');
  if (navContact && TENANT.phone) {
    navContact.href = 'https://wa.me/' + TENANT.phone;
  }
  $('#checkout-wsp').onclick = checkoutWhatsapp;
  $$('[data-close]').forEach(el => el.onclick = closeAllModals);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });
}

// ===== SCROLL REVEAL =====
// Elements with .reveal stay invisible until the user scrolls.
// On first scroll, anything in viewport reveals immediately.
// Anything below the fold reveals as it enters the viewport.
function initScrollReveal(startActive = false) {
  let canReveal = startActive;
  const els = () => [...document.querySelectorAll('.reveal:not(.revealed)')];

  const revealEl = (el) => {
    const delay = parseInt(el.dataset.delay || '0', 10);
    if (delay > 0) setTimeout(() => el.classList.add('revealed'), delay);
    else el.classList.add('revealed');
  };

  const inViewport = (el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight - 40 && r.bottom > 40;
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && canReveal) {
        revealEl(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  // Observe initial + future elements via MutationObserver
  const watch = (el) => observer.observe(el);
  els().forEach(watch);

  const mo = new MutationObserver((muts) => {
    muts.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.classList?.contains('reveal') && !node.classList.contains('revealed')) {
          watch(node);
        }
        node.querySelectorAll?.('.reveal:not(.revealed)').forEach(watch);
      });
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // First-scroll gate: reveal everything currently in viewport, then keep observing
  const onFirstScroll = () => {
    if (canReveal) return;
    canReveal = true;
    revealInViewport();
  };
  function revealInViewport() {
    els().forEach((el, i) => {
      if (inViewport(el)) {
        const baseDelay = parseInt(el.dataset.delay || '0', 10);
        setTimeout(() => el.classList.add('revealed'), baseDelay + i * 30);
        observer.unobserve(el);
      }
    });
  }
  // If we started active (FX path), reveal currently-visible elements right away
  if (startActive) revealInViewport();
  window.addEventListener('scroll', onFirstScroll, { passive: true, once: true });
  window.addEventListener('wheel', onFirstScroll, { passive: true, once: true });
  window.addEventListener('touchmove', onFirstScroll, { passive: true, once: true });
  window.addEventListener('keydown', (e) => {
    if (['PageDown','ArrowDown','Space','End','Home'].includes(e.code)) onFirstScroll();
  }, { once: true });
}

init().then(() => {
  // Si el landing FX está activo, esperar a que termine la desintegración
  // antes de inicializar el scroll-reveal. Si no, arrancar normal.
  if (document.body.classList.contains('fx-active')) {
    window.__startSiteReveal = () => initScrollReveal(true);
  } else {
    initScrollReveal();
  }
}).catch(err => {
  console.error(err);
  document.body.innerHTML = '<p style="padding:40px;text-align:center;color:#dc2626">Error cargando los datos.</p>';
});
