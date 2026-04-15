const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://www.divinafitness.com.br';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'divina');
const DATA_FILE = path.join(__dirname, 'divina-data.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Ensure directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function extractMeta(page) {
  return await page.evaluate(() => {
    const getMeta = (name) => {
      const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
      return el ? el.getAttribute('content') : null;
    };
    const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => {
      try { return JSON.parse(s.textContent); } catch { return null; }
    }).filter(Boolean);

    const ogTags = {};
    document.querySelectorAll('meta[property^="og:"]').forEach(el => {
      ogTags[el.getAttribute('property')] = el.getAttribute('content');
    });

    const imgsWithoutAlt = [...document.querySelectorAll('img')].filter(img => !img.getAttribute('alt') || img.getAttribute('alt').trim() === '');

    return {
      title: document.title,
      metaDescription: getMeta('description'),
      ogTags,
      jsonLd,
      imgsWithoutAlt: imgsWithoutAlt.length,
      totalImages: document.querySelectorAll('img').length,
      h1: [...document.querySelectorAll('h1')].map(h => h.textContent.trim()),
      h2: [...document.querySelectorAll('h2')].map(h => h.textContent.trim()).slice(0, 10),
    };
  });
}

async function detectPixels(page) {
  return await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script')].map(s => s.src || s.textContent?.substring(0, 500));
    const allText = scripts.join(' ');
    return {
      metaPixel: allText.includes('fbq(') || allText.includes('facebook.net/en_US/fbevents'),
      ga4: allText.includes('gtag(') || allText.includes('googletagmanager.com/gtag'),
      gtm: allText.includes('googletagmanager.com/gtm'),
      tiktok: allText.includes('tiktok.com/i18n/pixel'),
      hotjar: allText.includes('hotjar.com'),
      clarity: allText.includes('clarity.ms'),
      pinterest: allText.includes('pintrk') || allText.includes('pinterest.com/ct'),
      taboola: allText.includes('taboola'),
      kwai: allText.includes('kwai'),
    };
  });
}

async function checkTrustElements(page) {
  return await page.evaluate(() => {
    const body = document.body.innerHTML.toLowerCase();
    const text = document.body.textContent.toLowerCase();
    return {
      hasReviews: body.includes('review') || body.includes('avaliação') || body.includes('avaliacao') || body.includes('estrela') || body.includes('rating') || body.includes('yotpo') || body.includes('trustvox') || body.includes('lily'),
      hasSecurityBadge: body.includes('compra segura') || body.includes('site seguro') || body.includes('ssl') || body.includes('pagamento seguro') || body.includes('segurança') || body.includes('protegido'),
      hasReturnPolicy: text.includes('troca') || text.includes('devolução') || text.includes('devoluç'),
      hasWarranty: text.includes('garantia'),
      hasFreeShipping: text.includes('frete grátis') || text.includes('frete gratis') || text.includes('entrega grátis'),
      hasInstallments: text.includes('parcela') || text.includes('parcelo') || text.includes('sem juros'),
      hasSizeGuide: text.includes('guia de tamanho') || text.includes('tabela de medida') || text.includes('tamanho') && text.includes('medida'),
      hasSocialProof: body.includes('depoimento') || body.includes('cliente') && body.includes('disse'),
      hasWhatsapp: body.includes('whatsapp') || body.includes('wa.me') || body.includes('api.whatsapp'),
      hasLiveChat: body.includes('tidio') || body.includes('zendesk') || body.includes('intercom') || body.includes('chat') || body.includes('tawk'),
    };
  });
}

async function checkMobileUX(page) {
  return await page.evaluate(() => {
    const problems = [];
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    if (document.documentElement.scrollWidth > viewport.width + 5) {
      problems.push({ type: 'overflow', severity: 'critical', detail: `Conteúdo excede viewport: ${document.documentElement.scrollWidth}px vs ${viewport.width}px` });
    }

    const buttons = document.querySelectorAll('button, .btn, [class*="button"], input[type="submit"], a[class*="btn"]');
    let smallBtnCount = 0;
    buttons.forEach(btn => {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (rect.height < 44 || rect.width < 44)) {
        const text = btn.textContent?.trim()?.substring(0, 50);
        if (text && text.length > 0) smallBtnCount++;
      }
    });
    if (smallBtnCount > 0) {
      problems.push({ type: 'small-target', severity: 'important', detail: `${smallBtnCount} botões abaixo de 44px` });
    }

    const textEls = document.querySelectorAll('p, span, li, a, label');
    let smallTextCount = 0;
    textEls.forEach(el => {
      const fontSize = parseFloat(getComputedStyle(el).fontSize);
      if (fontSize < 12 && el.textContent?.trim().length > 5) smallTextCount++;
    });
    if (smallTextCount > 5) {
      problems.push({ type: 'small-text', severity: 'important', detail: `${smallTextCount} elementos com fonte < 12px` });
    }

    return problems;
  });
}

async function extractProducts(page) {
  return await page.evaluate(() => {
    const products = [];
    // Try JSON-LD first
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach(s => {
      try {
        const data = JSON.parse(s.textContent);
        if (data['@type'] === 'Product') {
          products.push({
            name: data.name,
            price: data.offers?.price || data.offers?.lowPrice,
            available: data.offers?.availability !== 'http://schema.org/OutOfStock',
            url: data.offers?.url || data.mainEntityOfPage?.['@id'],
          });
        }
        // Handle ItemList or array
        if (Array.isArray(data)) {
          data.forEach(item => {
            if (item['@type'] === 'Product') {
              products.push({ name: item.name, price: item.offers?.price, available: true, url: item.offers?.url });
            }
          });
        }
        if (data['@graph']) {
          data['@graph'].forEach(item => {
            if (item['@type'] === 'Product') {
              products.push({ name: item.name, price: item.offers?.price, available: true, url: item.offers?.url });
            }
          });
        }
      } catch {}
    });

    // Also try from DOM
    if (products.length === 0) {
      const links = [...document.querySelectorAll('a[href*="/produto"], a[href*="/products/"], a[href*="/p/"]')];
      const seen = new Set();
      links.forEach(a => {
        const href = a.href;
        if (seen.has(href)) return;
        seen.add(href);
        const card = a.closest('[class*="product"], [class*="card"], li') || a;
        const name = card.querySelector('h2, h3, [class*="name"], [class*="title"]')?.textContent?.trim();
        const priceEl = card.querySelector('[class*="price"], .money');
        const price = priceEl ? priceEl.textContent.trim() : 'N/A';
        if (name && name.length > 2 && name.length < 200) {
          products.push({ name: name.substring(0, 100), price, url: href, available: true });
        }
      });
    }

    return products;
  });
}

async function main() {
  console.log('=== AUDITORIA DIVINA FITNESS ===\n');

  const data = {
    timestamp: new Date().toISOString(),
    site: BASE_URL,
    pages: {},
    products: [],
    pixels: {},
    trust: {},
    mobileIssues: [],
    screenshots: []
  };

  const browser = await chromium.launch({ headless: true });

  try {
    // ============ PAGES ANALYSIS ============
    const pages = [
      { name: 'home', url: '/', label: 'Home' },
      { name: 'colecao', url: '/colecoes', label: 'Coleções' },
      { name: 'categoria', url: '/roupas-femininas', label: 'Roupas Femininas' },
    ];

    // First discover the site structure
    console.log('0. Descobrindo estrutura do site...');
    const ctxDiscover = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageDiscover = await ctxDiscover.newPage();
    await pageDiscover.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await sleep(3000);

    const siteStructure = await pageDiscover.evaluate(() => {
      const navLinks = [...document.querySelectorAll('nav a, header a, .menu a, [class*="nav"] a')];
      return navLinks.map(a => ({ text: a.textContent?.trim()?.substring(0, 50), href: a.href }))
        .filter(l => l.text && l.text.length > 1 && l.href.includes('divinafitness'))
        .slice(0, 30);
    });
    console.log('   Links de navegação:', JSON.stringify(siteStructure, null, 2));

    // Find a product page
    const productLinks = await pageDiscover.evaluate(() => {
      const links = [...document.querySelectorAll('a')];
      return links.filter(a => a.href.match(/\/(produto|products?|p)\//i))
        .map(a => ({ text: a.textContent?.trim()?.substring(0, 60), href: a.href }))
        .filter(l => l.text && l.text.length > 2)
        .slice(0, 5);
    });
    console.log('   Produtos encontrados:', productLinks);

    // Find collection/category pages
    const categoryLinks = siteStructure.filter(l =>
      !l.href.includes('#') &&
      !l.href.includes('instagram') &&
      !l.href.includes('facebook') &&
      l.href !== BASE_URL + '/' &&
      l.href !== BASE_URL
    ).slice(0, 8);
    console.log('   Categorias:', categoryLinks.map(l => l.text));

    await ctxDiscover.close();

    // Add discovered pages
    if (productLinks.length > 0) {
      const prodUrl = new URL(productLinks[0].href);
      pages.push({ name: 'produto', url: prodUrl.pathname, label: `Produto: ${productLinks[0].text}` });
    }
    if (categoryLinks.length > 0) {
      const catUrl = new URL(categoryLinks[0].href);
      if (!pages.find(p => p.url === catUrl.pathname)) {
        pages.push({ name: 'categoria_extra', url: catUrl.pathname, label: categoryLinks[0].text });
      }
    }

    // Analyze each page
    for (const pg of pages) {
      console.log(`\n--- Analisando: ${pg.label} (${pg.url}) ---`);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await ctx.newPage();

      const errors = [];
      p.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      p.on('pageerror', err => errors.push(err.message));

      const resp = await p.goto(`${BASE_URL}${pg.url}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => null);
      if (!resp || resp.status() >= 400) {
        console.log(`   ERRO: Status ${resp?.status() || 'timeout'}`);
        // Try alternate URLs
        if (pg.name === 'colecao') {
          for (const alt of ['/collections', '/categorias', '/departments']) {
            const r2 = await p.goto(`${BASE_URL}${alt}`, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => null);
            if (r2 && r2.status() < 400) { pg.url = alt; break; }
          }
        }
      }
      await sleep(2000);

      // Desktop screenshot
      await p.screenshot({ path: path.join(SCREENSHOTS_DIR, `${pg.name}_desktop.png`), fullPage: true });
      console.log(`   Screenshot desktop: ${pg.name}_desktop.png`);

      // Meta extraction
      const meta = await extractMeta(p);
      data.pages[pg.name] = { ...meta, url: `${BASE_URL}${pg.url}`, label: pg.label, consoleErrors: errors.length };

      // Pixels (home only)
      if (pg.name === 'home') {
        data.pixels = await detectPixels(p);
        data.trust = await checkTrustElements(p);
        console.log('   Pixels:', data.pixels);
        console.log('   Trust:', data.trust);
      }

      // Products (from collection/category pages)
      if (['colecao', 'categoria', 'categoria_extra'].includes(pg.name)) {
        const prods = await extractProducts(p);
        if (prods.length > 0) {
          data.products.push(...prods);
          console.log(`   Produtos: ${prods.length}`);
        }
      }

      // Trust elements on product page
      if (pg.name === 'produto') {
        data.productPageTrust = await checkTrustElements(p);
        data.productPageDetails = await p.evaluate(() => {
          const body = document.body;
          return {
            hasAddToCart: !!body.querySelector('button[class*="buy"], button[class*="cart"], button[class*="comprar"], [class*="add-to-cart"], form[action*="cart"] button, input[class*="buy"]'),
            hasSizeSelector: !!body.querySelector('select[name*="size"], [class*="size"], [class*="tamanho"], [class*="variant"] button, [data-option]'),
            hasPrice: !!body.querySelector('[class*="price"], [class*="preco"]'),
            hasInstallments: body.textContent?.toLowerCase().includes('parcela'),
            hasReviews: body.innerHTML.toLowerCase().includes('review') || body.innerHTML.toLowerCase().includes('avaliação') || body.innerHTML.toLowerCase().includes('avaliacao'),
            hasShipping: body.textContent?.toLowerCase().includes('frete') || body.textContent?.toLowerCase().includes('entrega'),
            hasSizeGuide: body.textContent?.toLowerCase().includes('guia de tamanho') || body.textContent?.toLowerCase().includes('tabela de medida'),
            hasDescription: !!body.querySelector('[class*="description"], [class*="descri"]'),
            hasMultipleImages: body.querySelectorAll('[class*="product"] img, [class*="gallery"] img, [class*="thumb"] img').length > 1,
            hasSocialShare: !!body.querySelector('[class*="share"], [class*="social"]'),
            hasReturnPolicy: body.textContent?.toLowerCase().includes('troca') || body.textContent?.toLowerCase().includes('devolução'),
            hasSecurityBadge: body.innerHTML.toLowerCase().includes('compra segura') || body.innerHTML.toLowerCase().includes('site seguro'),
          };
        });
        console.log('   Produto trust:', data.productPageTrust);
        console.log('   Produto details:', data.productPageDetails);
      }

      // Mobile screenshot
      await p.setViewportSize({ width: 390, height: 844 });
      await sleep(1500);
      await p.screenshot({ path: path.join(SCREENSHOTS_DIR, `${pg.name}_mobile.png`), fullPage: true });
      console.log(`   Screenshot mobile: ${pg.name}_mobile.png`);

      // Mobile UX
      const mobileIssues = await checkMobileUX(p);
      data.mobileIssues.push({ page: pg.label, issues: mobileIssues });

      await ctx.close();
    }

    // Dedup products
    const seen = new Set();
    data.products = data.products.filter(p => {
      const key = p.url || p.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  } catch (err) {
    console.error('Erro:', err.message);
    data.error = err.message;
  } finally {
    await browser.close();
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log(`\nDados salvos: ${DATA_FILE}`);
}

main().catch(console.error);
