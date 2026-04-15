const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = 'https://lyvafit.com.br';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('=== TESTE CARRINHO DRAWER ===\n');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Go to product
  await page.goto(`${BASE_URL}/produtos/top-maya-rosa-chiclete-133tt/`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);

  // Select size using only the FIRST visible select
  await page.evaluate(() => {
    const sel = document.querySelector('.js-variation-option');
    if (sel) {
      sel.value = 'M';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(1000);
  console.log('Tamanho M selecionado');

  // Click COMPRAR via JS on the main product form
  const clicked = await page.evaluate(() => {
    // Find the main product form (not the quick-buy ones from related products)
    const mainForm = document.querySelector('.js-product-form, form[action*="cart"][class*="js-product-form"]') ||
                     document.querySelector('#product-form') ||
                     document.querySelector('.product-form');

    if (mainForm) {
      const btn = mainForm.querySelector('button[type="submit"], input[type="submit"]');
      if (btn) {
        btn.click();
        return `Form button: "${btn.textContent?.trim()}"`;
      }
    }

    // Fallback: find first visible COMPRAR button
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 &&
          btn.textContent?.trim().toUpperCase().includes('COMPRAR') &&
          rect.y < 800) { // Only in main viewport
        btn.click();
        return `Fallback button: "${btn.textContent?.trim()}"`;
      }
    }
    return null;
  });
  console.log('Resultado do clique:', clicked);
  await sleep(3000);

  // Screenshot after clicking buy
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'funnel_04_carrinho_drawer.png'), fullPage: false });
  console.log('Screenshot: funnel_04_carrinho_drawer.png');

  // Check page state after click
  const state = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;

    // Check for overlay/drawer
    const allEls = document.querySelectorAll('*');
    const visibleOverlays = [];
    allEls.forEach(el => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const cls = el.className?.toString() || '';
      const id = el.id || '';
      if ((cls.includes('cart') || cls.includes('carrinho') || id.includes('cart')) &&
          rect.width > 100 && rect.height > 100 &&
          style.display !== 'none' && style.visibility !== 'hidden') {
        visibleOverlays.push({
          tag: el.tagName,
          cls: cls.substring(0, 100),
          id: id,
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          pos: `${Math.round(rect.x)},${Math.round(rect.y)}`
        });
      }
    });

    // Also check current URL
    return {
      url: window.location.href,
      overlays: visibleOverlays,
      bodyClass: body.className?.substring(0, 200)
    };
  });
  console.log('Estado apos clique:', JSON.stringify(state, null, 2));

  // Try checkout URL patterns for Nuvemshop
  console.log('\n--- Testando URLs de checkout ---');
  const currentCookies = await context.cookies();
  const cartCookie = currentCookies.find(c => c.name.includes('cart'));
  console.log('Cart cookie:', cartCookie ? `${cartCookie.name}=${cartCookie.value.substring(0, 50)}...` : 'nenhum');

  // Take a full page screenshot for reference
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'funnel_04_fullpage.png'), fullPage: true });
  console.log('Screenshot fullpage: funnel_04_fullpage.png');

  await browser.close();
  console.log('\n=== FIM ===');
}

main().catch(console.error);
