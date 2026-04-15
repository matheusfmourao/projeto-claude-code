const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = 'https://lyvafit.com.br';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('=== ANALISE DO CHECKOUT ===\n');
  const browser = await chromium.launch({ headless: true });

  // Desktop
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Capture all network requests to find checkout URL
  const requests = [];
  page.on('request', req => {
    if (req.url().includes('checkout') || req.url().includes('cart') || req.url().includes('comprar')) {
      requests.push({ method: req.method(), url: req.url() });
    }
  });

  // Go to product page
  console.log('1. Abrindo pagina de produto...');
  await page.goto(`${BASE_URL}/produtos/camiseta-open-gelo-32si7/`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);

  // Select size P via JS (this product has stock 10)
  console.log('2. Selecionando tamanho P...');
  await page.evaluate(() => {
    const sel = document.querySelector('.js-variation-option');
    if (sel) {
      sel.value = 'P';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(1000);

  // Click buy button via form submission
  console.log('3. Clicando COMPRAR...');

  // Try submitting the form via AJAX like Nuvemshop does
  const addResult = await page.evaluate(async () => {
    const form = document.querySelector('form[action*="cart"]');
    if (!form) return { error: 'form not found', forms: document.querySelectorAll('form').length };

    const action = form.action;
    const formData = new FormData(form);

    // Log form details
    const details = {
      action: action,
      method: form.method,
      fields: {}
    };
    formData.forEach((val, key) => { details.fields[key] = val; });

    // Submit via fetch
    try {
      const resp = await fetch(action, {
        method: 'POST',
        body: formData,
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      details.status = resp.status;
      details.redirectUrl = resp.url;
      details.responseType = resp.headers.get('content-type');

      // Try to read response
      const text = await resp.text();
      details.responsePreview = text.substring(0, 500);

      return details;
    } catch (e) {
      details.fetchError = e.message;
      return details;
    }
  });
  console.log('   Resultado:', JSON.stringify(addResult, null, 2));
  await sleep(2000);

  // Take screenshot
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'checkout_01_after_add.png'), fullPage: false });

  // Check if drawer opened
  console.log('\n4. Verificando drawer do carrinho...');
  const drawerState = await page.evaluate(() => {
    // Look at DOM changes - common Nuvemshop cart drawer patterns
    const elements = document.querySelectorAll('[class*="cart"], [id*="cart"], [class*="carrinho"]');
    const results = [];
    elements.forEach(el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width > 50) {
        results.push({
          tag: el.tagName,
          cls: (el.className?.toString() || '').substring(0, 120),
          id: el.id,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          transform: style.transform,
          position: style.position,
          right: style.right,
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          pos: `x:${Math.round(rect.x)},y:${Math.round(rect.y)}`,
          innerHTML: el.innerHTML?.substring(0, 200)
        });
      }
    });
    return results;
  });
  console.log('   Elementos de carrinho:', JSON.stringify(drawerState, null, 2));

  // Try to find and click the cart icon to open drawer
  console.log('\n5. Tentando abrir carrinho via icone...');
  const cartIconClicked = await page.evaluate(() => {
    // Common cart icon selectors
    const selectors = [
      'a[href*="cart"]', 'a[href*="carrinho"]',
      '[class*="cart-icon"]', '[class*="cart-link"]', '[class*="cart-toggle"]',
      '.js-toggle-cart', '.js-open-cart', '.js-cart',
      'a[aria-label*="cart"]', 'a[aria-label*="carrinho"]',
      '[class*="header"] [class*="cart"]',
      'a[title*="carrinho"]', 'a[title*="cart"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) {
          el.click();
          return { selector: sel, text: el.textContent?.trim()?.substring(0, 50), tag: el.tagName };
        }
      }
    }

    // Try header area links
    const headerLinks = document.querySelectorAll('header a, .js-head a, nav a');
    for (const a of headerLinks) {
      if (a.href?.includes('cart') || a.textContent?.toLowerCase().includes('carrinho')) {
        a.click();
        return { selector: 'header link', text: a.textContent?.trim(), href: a.href };
      }
    }

    return null;
  });
  console.log('   Icone do carrinho:', cartIconClicked);
  await sleep(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'checkout_02_cart_icon.png'), fullPage: false });

  // Check for any visible modal/drawer now
  console.log('\n6. Verificando modais/drawers visiveis...');
  const visibleOverlays = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const overlays = [];
    all.forEach(el => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const z = parseInt(style.zIndex) || 0;
      const cls = el.className?.toString() || '';

      // High z-index elements that are visible and large enough to be a drawer/modal
      if (z > 100 && rect.width > 200 && rect.height > 200 &&
          style.display !== 'none' && style.visibility !== 'hidden') {
        overlays.push({
          tag: el.tagName,
          cls: cls.substring(0, 150),
          id: el.id,
          zIndex: z,
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          text: el.textContent?.substring(0, 300)
        });
      }
    });
    return overlays;
  });
  console.log('   Overlays:', JSON.stringify(visibleOverlays, null, 2));

  // Also try to get checkout URL from the page
  console.log('\n7. Procurando links de checkout...');
  const checkoutLinks = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    const checkout = [];
    links.forEach(a => {
      if (a.href && (a.href.includes('checkout') || a.href.includes('finalizar') || a.href.includes('comprar'))) {
        checkout.push({ text: a.textContent?.trim()?.substring(0, 80), href: a.href, visible: a.getBoundingClientRect().width > 0 });
      }
    });
    return checkout;
  });
  console.log('   Links de checkout:', JSON.stringify(checkoutLinks, null, 2));

  // Check network requests
  console.log('\n8. Requests capturadas:');
  requests.forEach(r => console.log(`   ${r.method} ${r.url}`));

  // Try Nuvemshop API cart endpoint
  console.log('\n9. Testando API Nuvemshop...');
  const apiResult = await page.evaluate(async () => {
    try {
      const resp = await fetch('/cart', { headers: { 'Accept': 'application/json' } });
      return { status: resp.status, type: resp.headers.get('content-type'), body: (await resp.text()).substring(0, 300) };
    } catch(e) {
      return { error: e.message };
    }
  });
  console.log('   /cart API:', JSON.stringify(apiResult, null, 2));

  // Try the Nuvemshop specific checkout pattern
  console.log('\n10. Verificando cookies e estado do carrinho...');
  const cookies = await context.cookies();
  const relevantCookies = cookies.filter(c =>
    c.name.includes('cart') || c.name.includes('session') || c.name.includes('nube') || c.name.includes('tien')
  );
  relevantCookies.forEach(c => console.log(`   Cookie: ${c.name} = ${c.value.substring(0, 60)}...`));

  // Final: dump all the page HTML structure to understand the checkout flow
  console.log('\n11. Estrutura do header/cart area...');
  const headerHTML = await page.evaluate(() => {
    const header = document.querySelector('header, .js-head, #header');
    if (!header) return 'header not found';
    // Find cart-related elements
    const cartEls = header.querySelectorAll('[class*="cart"], [href*="cart"]');
    return [...cartEls].map(el => ({
      tag: el.tagName,
      cls: el.className?.toString()?.substring(0, 100),
      href: el.href,
      html: el.outerHTML?.substring(0, 300)
    }));
  });
  console.log('   Cart elements in header:', JSON.stringify(headerHTML, null, 2));

  await browser.close();
  console.log('\n=== FIM ===');
}

main().catch(console.error);
