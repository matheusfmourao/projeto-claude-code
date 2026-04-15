const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://lyvafit.com.br';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const DATA_FILE = path.join(__dirname, 'audit-data.json');

const PAGES = [
  { name: 'home', url: '/', label: 'Home' },
  { name: 'colecao', url: '/colecao-flow/', label: 'Coleção Flow' },
  { name: 'produto', url: '/produtos/top-maya-rosa-chiclete-133tt/', label: 'Produto - Top Maya' },
  { name: 'contato', url: '/contato/', label: 'Contato' },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function captureScreenshot(page, name, viewport) {
  const suffix = viewport ? `_${viewport.width}x${viewport.height}` : '';
  const filename = `${name}${suffix}.png`;
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, filename), fullPage: true });
  console.log(`  Screenshot: ${filename}`);
  return filename;
}

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

    const imgsWithoutAlt = [...document.querySelectorAll('img')].filter(img => !img.getAttribute('alt') || img.getAttribute('alt').trim() === '').map(img => ({
      src: img.src?.substring(0, 120),
      width: img.naturalWidth,
      height: img.naturalHeight
    }));

    return {
      title: document.title,
      metaDescription: getMeta('description'),
      ogTags,
      jsonLd,
      imgsWithoutAlt,
      totalImages: document.querySelectorAll('img').length,
      h1: [...document.querySelectorAll('h1')].map(h => h.textContent.trim()),
      h2: [...document.querySelectorAll('h2')].map(h => h.textContent.trim()),
    };
  });
}

async function detectPixels(page) {
  return await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script')].map(s => s.src || s.textContent?.substring(0, 500));
    const pixels = {
      metaPixel: false,
      ga4: false,
      gtm: false,
      tiktok: false,
      hotjar: false,
      clarity: false,
      other: []
    };
    const allText = scripts.join(' ');
    if (allText.includes('fbq(') || allText.includes('facebook.net/en_US/fbevents')) pixels.metaPixel = true;
    if (allText.includes('gtag(') || allText.includes('googletagmanager.com/gtag')) pixels.ga4 = true;
    if (allText.includes('googletagmanager.com/gtm')) pixels.gtm = true;
    if (allText.includes('tiktok.com/i18n/pixel')) pixels.tiktok = true;
    if (allText.includes('hotjar.com')) pixels.hotjar = true;
    if (allText.includes('clarity.ms')) pixels.clarity = true;
    return pixels;
  });
}

async function extractProducts(page) {
  return await page.evaluate(() => {
    const products = [];
    // Try common selectors for product grids
    const selectors = [
      '.product-card', '.product-item', '.product',
      '[data-product]', '.grid-product', '.collection-product',
      'li.grid__item', '.productgrid--item', '.product-block',
      '.card--product', '.product-grid-item'
    ];

    let productEls = [];
    for (const sel of selectors) {
      productEls = document.querySelectorAll(sel);
      if (productEls.length > 0) break;
    }

    // If no products found with specific selectors, try generic approach
    if (productEls.length === 0) {
      // Look for links containing /produtos/ or /products/
      const links = [...document.querySelectorAll('a[href*="/produtos/"], a[href*="/products/"]')];
      const seen = new Set();
      links.forEach(a => {
        const href = a.href;
        if (seen.has(href)) return;
        seen.add(href);
        const card = a.closest('div') || a;
        const name = card.querySelector('h2, h3, .product-title, .product-name, [class*="title"]')?.textContent?.trim() || a.textContent?.trim();
        const priceEl = card.querySelector('[class*="price"], .money, s, .price');
        const price = priceEl ? priceEl.textContent.trim() : 'N/A';
        if (name && name.length > 2 && name.length < 200) {
          products.push({ name: name.substring(0, 100), price, url: href, available: true });
        }
      });
      return products;
    }

    productEls.forEach(el => {
      const nameEl = el.querySelector('h2, h3, .title, .product-title, .product-name, [class*="title"]');
      const priceEl = el.querySelector('[class*="price"], .money');
      const linkEl = el.querySelector('a');
      const soldOut = el.querySelector('[class*="sold-out"], [class*="esgotado"], .badge--sold-out');
      products.push({
        name: nameEl?.textContent?.trim()?.substring(0, 100) || 'N/A',
        price: priceEl?.textContent?.trim() || 'N/A',
        url: linkEl?.href || 'N/A',
        available: !soldOut
      });
    });
    return products;
  });
}

async function checkMobileUX(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(1500);

  const issues = await page.evaluate(() => {
    const problems = [];
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    // Check for horizontal overflow
    if (document.documentElement.scrollWidth > viewport.width + 5) {
      problems.push({
        type: 'overflow',
        severity: 'critical',
        detail: `Conteúdo excede a largura da tela: ${document.documentElement.scrollWidth}px vs ${viewport.width}px`
      });
    }

    // Check buttons and CTAs
    const buttons = document.querySelectorAll('button, .btn, [class*="button"], input[type="submit"], a[class*="btn"]');
    buttons.forEach(btn => {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        if (rect.height < 44 || rect.width < 44) {
          const text = btn.textContent?.trim()?.substring(0, 50);
          if (text && text.length > 0) {
            problems.push({
              type: 'small-target',
              severity: 'important',
              detail: `Botão "${text}" muito pequeno para toque: ${Math.round(rect.width)}x${Math.round(rect.height)}px (mín. 44x44)`
            });
          }
        }
        if (rect.right > viewport.width || rect.left < 0) {
          problems.push({
            type: 'offscreen',
            severity: 'critical',
            detail: `Elemento fora da tela: ${btn.textContent?.trim()?.substring(0, 50)}`
          });
        }
      }
    });

    // Check font sizes
    const textEls = document.querySelectorAll('p, span, li, a, label');
    let smallTextCount = 0;
    textEls.forEach(el => {
      const style = getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize);
      if (fontSize < 12 && el.textContent?.trim().length > 5) {
        smallTextCount++;
      }
    });
    if (smallTextCount > 5) {
      problems.push({
        type: 'small-text',
        severity: 'important',
        detail: `${smallTextCount} elementos com fonte menor que 12px`
      });
    }

    // Check images
    const images = document.querySelectorAll('img');
    images.forEach(img => {
      const rect = img.getBoundingClientRect();
      if (rect.width > viewport.width) {
        problems.push({
          type: 'image-overflow',
          severity: 'important',
          detail: `Imagem excede viewport: ${Math.round(rect.width)}px - ${img.src?.substring(0, 80)}`
        });
      }
    });

    return problems;
  });

  return issues;
}

async function collectConsoleErrors(page, url) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    errors.push(err.message);
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(2000);
  return errors;
}

async function simulateFunnel(page, auditData) {
  console.log('\n=== SIMULAÇÃO DO FUNIL DE COMPRA ===');
  const funnel = { steps: [], totalClicks: 0, frictionPoints: [] };

  // Step 1: Home
  console.log('  Step 1: Home');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(2000);
  await captureScreenshot(page, 'funnel_01_home');
  funnel.steps.push({ name: 'Home', url: BASE_URL, clicks: 0 });

  // Step 2: Navigate to collection
  console.log('  Step 2: Coleção');
  await page.goto(`${BASE_URL}/colecao-flow/`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(2000);
  await captureScreenshot(page, 'funnel_02_colecao');
  funnel.steps.push({ name: 'Coleção', url: `${BASE_URL}/colecao-flow/`, clicks: 1 });
  funnel.totalClicks++;

  // Step 3: Product page
  console.log('  Step 3: Produto');
  await page.goto(`${BASE_URL}/produtos/top-maya-rosa-chiclete-133tt/`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(2000);
  await captureScreenshot(page, 'funnel_03_produto');

  // Check product page elements
  const productPageInfo = await page.evaluate(() => {
    const addToCartBtn = document.querySelector('button[type="submit"], [class*="add-to-cart"], [class*="comprar"], [class*="buy"], form[action*="cart"] button');
    const sizeSelector = document.querySelector('select[name*="size"], [class*="size"], [class*="tamanho"], input[name*="option"], select[name*="option"]');
    const price = document.querySelector('[class*="price"], .money, [class*="preco"]');
    const reviews = document.querySelector('[class*="review"], [class*="avalia"]');
    const shipping = document.querySelector('[class*="shipping"], [class*="frete"], [class*="entrega"]');
    const installments = document.querySelector('[class*="parcela"], [class*="installment"]');

    return {
      hasAddToCart: !!addToCartBtn,
      addToCartText: addToCartBtn?.textContent?.trim(),
      hasSizeSelector: !!sizeSelector,
      hasPrice: !!price,
      priceText: price?.textContent?.trim(),
      hasReviews: !!reviews,
      hasShippingInfo: !!shipping,
      hasInstallments: !!installments,
    };
  });
  funnel.steps.push({ name: 'Produto', clicks: 1, details: productPageInfo });
  funnel.totalClicks++;

  if (!productPageInfo.hasSizeSelector) {
    funnel.frictionPoints.push('Seletor de tamanho não encontrado ou não identificável na página de produto');
  }
  if (!productPageInfo.hasReviews) {
    funnel.frictionPoints.push('Sem avaliações de clientes visíveis na página de produto');
  }
  if (!productPageInfo.hasShippingInfo) {
    funnel.frictionPoints.push('Informação de frete não visível antes de adicionar ao carrinho');
  }

  // Step 4: Try to add to cart
  console.log('  Step 4: Adicionar ao carrinho');
  try {
    // First try to select a size/variant if needed
    const variantSelector = await page.$('select[name*="option"], select[name*="variant"], [class*="swatch"] input, [class*="option"] input, [class*="size"] button, [class*="tamanho"] button');
    if (variantSelector) {
      const tagName = await variantSelector.evaluate(el => el.tagName.toLowerCase());
      if (tagName === 'select') {
        const options = await variantSelector.evaluate(el => [...el.options].map((o, i) => ({ value: o.value, text: o.text, index: i })));
        if (options.length > 1) {
          await variantSelector.selectOption({ index: 1 });
          await sleep(500);
        }
      } else {
        await variantSelector.click();
        await sleep(500);
      }
    }

    // Click add to cart
    const addBtn = await page.$('button[type="submit"][name="add"], [class*="add-to-cart"], form[action*="cart"] button[type="submit"], button:has-text("Comprar"), button:has-text("Adicionar"), button:has-text("COMPRAR")');
    if (addBtn) {
      await addBtn.click();
      await sleep(3000);
      await captureScreenshot(page, 'funnel_04_carrinho_aberto');
      funnel.steps.push({ name: 'Adicionar ao Carrinho', clicks: 1 });
      funnel.totalClicks++;
    } else {
      funnel.frictionPoints.push('Botão de adicionar ao carrinho não encontrado com seletores padrão');
    }
  } catch (e) {
    funnel.frictionPoints.push(`Erro ao tentar adicionar ao carrinho: ${e.message}`);
  }

  // Step 5: Go to cart
  console.log('  Step 5: Carrinho');
  try {
    await page.goto(`${BASE_URL}/cart`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await sleep(2000);
    await captureScreenshot(page, 'funnel_05_carrinho');
    funnel.steps.push({ name: 'Carrinho', url: `${BASE_URL}/cart`, clicks: 1 });
    funnel.totalClicks++;
  } catch (e) {
    funnel.frictionPoints.push(`Erro ao acessar carrinho: ${e.message}`);
  }

  // Step 6: Try checkout
  console.log('  Step 6: Checkout');
  try {
    const checkoutBtn = await page.$('a[href*="checkout"], button:has-text("Finalizar"), button:has-text("Checkout"), [class*="checkout"] a, [class*="checkout"] button, a:has-text("Finalizar"), a:has-text("Checkout")');
    if (checkoutBtn) {
      await checkoutBtn.click();
      await sleep(4000);
      await captureScreenshot(page, 'funnel_06_checkout');
      funnel.steps.push({ name: 'Checkout', clicks: 1, url: page.url() });
      funnel.totalClicks++;
    } else {
      // Try direct navigation
      await page.goto(`${BASE_URL}/checkout`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
      await sleep(2000);
      await captureScreenshot(page, 'funnel_06_checkout');
      funnel.steps.push({ name: 'Checkout', clicks: 0, url: page.url() });
    }
  } catch (e) {
    funnel.frictionPoints.push(`Erro ao acessar checkout: ${e.message}`);
  }

  auditData.funnel = funnel;
  console.log(`  Total de cliques no funil: ${funnel.totalClicks}`);
  console.log(`  Pontos de fricção: ${funnel.frictionPoints.length}`);
}

async function main() {
  console.log('=== AUDITORIA UX & CONVERSÃO - LYVAFIT.COM.BR ===\n');

  const auditData = {
    timestamp: new Date().toISOString(),
    site: BASE_URL,
    pages: {},
    products: [],
    mobileIssues: [],
    consoleErrors: {},
    pixels: {},
    funnel: {},
    screenshots: []
  };

  const browser = await chromium.launch({ headless: true });

  try {
    // ============ PART 1: PAGE SCREENSHOTS & META ============
    console.log('=== PARTE 1: SCREENSHOTS E METADADOS ===');

    for (const pg of PAGES) {
      console.log(`\nAnalisando: ${pg.label} (${pg.url})`);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();

      // Collect console errors
      const errors = [];
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      page.on('pageerror', err => errors.push(err.message));

      await page.goto(`${BASE_URL}${pg.url}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await sleep(2000);

      // Desktop screenshot
      const desktopFile = await captureScreenshot(page, pg.name, { width: 1440, height: 900 });
      auditData.screenshots.push({ page: pg.label, file: desktopFile, type: 'desktop' });

      // Extract meta
      const meta = await extractMeta(page);
      auditData.pages[pg.name] = { ...meta, url: `${BASE_URL}${pg.url}`, label: pg.label, consoleErrors: errors };

      // Detect pixels (only on home)
      if (pg.name === 'home') {
        auditData.pixels = await detectPixels(page);
      }

      // Mobile screenshot
      await page.setViewportSize({ width: 390, height: 844 });
      await sleep(1500);
      const mobileFile = await captureScreenshot(page, `${pg.name}_mobile`, { width: 390, height: 844 });
      auditData.screenshots.push({ page: pg.label, file: mobileFile, type: 'mobile' });

      await context.close();
    }

    // ============ PART 2: PRODUCTS ============
    console.log('\n=== PARTE 2: EXTRAÇÃO DE PRODUTOS ===');

    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page2 = await ctx2.newPage();

    // Try multiple collection pages
    const collectionUrls = ['/colecao-flow/', '/collections/', '/collections/all', '/produtos/', '/products/'];
    for (const colUrl of collectionUrls) {
      console.log(`  Tentando: ${colUrl}`);
      await page2.goto(`${BASE_URL}${colUrl}`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
      await sleep(2000);
      const products = await extractProducts(page2);
      if (products.length > 0) {
        console.log(`  Encontrados ${products.length} produtos em ${colUrl}`);
        auditData.products = [...auditData.products, ...products];
      }
    }

    // Deduplicate
    const seen = new Set();
    auditData.products = auditData.products.filter(p => {
      const key = p.url || p.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`  Total de produtos únicos: ${auditData.products.length}`);
    await ctx2.close();

    // ============ PART 3: MOBILE UX ============
    console.log('\n=== PARTE 3: ANÁLISE MOBILE ===');

    const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' });
    const page3 = await ctx3.newPage();

    for (const pg of PAGES) {
      console.log(`  Mobile check: ${pg.label}`);
      await page3.goto(`${BASE_URL}${pg.url}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await sleep(2000);
      const issues = await checkMobileUX(page3);
      auditData.mobileIssues.push({ page: pg.label, issues });
    }
    await ctx3.close();

    // ============ PART 4: FUNNEL ============
    console.log('\n=== PARTE 4: FUNIL DE COMPRA ===');

    const ctx4 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page4 = await ctx4.newPage();
    await simulateFunnel(page4, auditData);
    await ctx4.close();

  } catch (err) {
    console.error('Erro geral:', err.message);
    auditData.error = err.message;
  } finally {
    await browser.close();
  }

  // Save data
  fs.writeFileSync(DATA_FILE, JSON.stringify(auditData, null, 2));
  console.log(`\nDados salvos em: ${DATA_FILE}`);
}

main().catch(console.error);
