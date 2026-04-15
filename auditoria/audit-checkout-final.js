const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = 'https://lyvafit.com.br';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('=== CHECKOUT FINAL TEST ===\n');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Go to product with good stock (Camiseta Luna Gelo, stock=10)
  await page.goto(`${BASE_URL}/produtos/camiseta-open-gelo-32si7/`, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);

  // Select size via the FIRST visible select only
  console.log('1. Selecionando tamanho...');
  await page.evaluate(() => {
    const sel = document.querySelector('select.js-variation-option');
    if (sel) { sel.value = 'P'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await sleep(1000);

  // Click the actual add-to-cart INPUT button
  console.log('2. Adicionando ao carrinho...');
  await page.evaluate(() => {
    const btn = document.querySelector('input.js-addtocart');
    if (btn) btn.click();
  });
  await sleep(3000);

  // Check cart state
  const cartCount = await page.evaluate(() => {
    const badge = document.querySelector('.js-cart-widget-amount.badge');
    return badge?.textContent?.trim();
  });
  console.log('   Items no carrinho:', cartCount);

  // Screenshot after add
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'checkout_flow_01_added.png'), fullPage: false });

  // Open cart drawer
  console.log('3. Abrindo drawer do carrinho...');
  await page.evaluate(() => {
    const toggle = document.querySelector('.js-toggle-cart');
    if (toggle) toggle.click();
  });
  await sleep(2000);

  // Screenshot of drawer with product
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'checkout_flow_02_drawer.png'), fullPage: false });

  // Analyze drawer content
  console.log('4. Analisando conteudo do drawer...');
  const drawerContent = await page.evaluate(() => {
    const modal = document.querySelector('#modal-cart');
    if (!modal) return { error: 'modal not found' };

    // Get all text content structured
    const result = {
      visible: getComputedStyle(modal).display !== 'none',
      classes: modal.className,
      title: modal.querySelector('h3, h2, .modal-header, [class*="title"]')?.textContent?.trim(),
      items: [],
      subtotal: null,
      shipping: null,
      checkoutBtn: null,
      allLinks: [],
      allButtons: [],
      fullText: modal.textContent?.replace(/\s+/g, ' ')?.trim()?.substring(0, 1000)
    };

    // Find items
    modal.querySelectorAll('[class*="item"], [class*="product"], tr').forEach(item => {
      const name = item.querySelector('[class*="name"], [class*="title"], a')?.textContent?.trim();
      const price = item.querySelector('[class*="price"], .money')?.textContent?.trim();
      if (name && name.length > 2 && name.length < 100) {
        result.items.push({ name: name.substring(0, 80), price });
      }
    });

    // Find subtotal
    const subtotalEl = modal.querySelector('[class*="subtotal"], [class*="total"]');
    result.subtotal = subtotalEl?.textContent?.trim();

    // Find shipping info
    const shippingEl = modal.querySelector('[class*="shipping"], [class*="frete"], [class*="delivery"]');
    result.shipping = shippingEl?.textContent?.trim()?.substring(0, 200);

    // Find checkout/finalize button
    modal.querySelectorAll('a, button, input[type="submit"]').forEach(el => {
      const text = el.textContent?.trim() || el.value || '';
      const href = el.href || '';
      const rect = el.getBoundingClientRect();
      if (text.length > 0 && text.length < 100 && rect.width > 0) {
        const entry = { text: text.substring(0, 80), tag: el.tagName, visible: rect.width > 0 };
        if (href) entry.href = href;
        if (el.className) entry.cls = el.className.toString().substring(0, 100);

        if (text.toLowerCase().includes('finalizar') || text.toLowerCase().includes('checkout') ||
            text.toLowerCase().includes('comprar') || href.includes('checkout')) {
          result.checkoutBtn = entry;
        }
        result.allButtons.push(entry);
      }
    });

    // Find all links
    modal.querySelectorAll('a[href]').forEach(a => {
      if (a.href && a.href !== '#' && !a.href.endsWith('#')) {
        result.allLinks.push({ text: a.textContent?.trim()?.substring(0, 50), href: a.href });
      }
    });

    return result;
  });
  console.log('   Drawer:', JSON.stringify(drawerContent, null, 2));

  // If checkout button found, try clicking it
  if (drawerContent.checkoutBtn) {
    console.log('\n5. Clicando no botao de checkout...');
    const checkoutClicked = await page.evaluate(() => {
      const modal = document.querySelector('#modal-cart');
      const links = modal?.querySelectorAll('a, button');
      for (const el of (links || [])) {
        const text = (el.textContent?.trim() || el.value || '').toLowerCase();
        if (text.includes('finalizar') || text.includes('checkout') || text.includes('iniciar')) {
          el.click();
          return el.textContent?.trim() || el.value;
        }
      }
      // Also try href-based checkout
      const checkoutLink = modal?.querySelector('a[href*="checkout"]');
      if (checkoutLink) { checkoutLink.click(); return checkoutLink.href; }
      return null;
    });
    console.log('   Clicked:', checkoutClicked);
    await sleep(5000);

    // Capture checkout page
    console.log('   URL apos click:', page.url());
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'checkout_flow_03_checkout.png'), fullPage: false });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'checkout_flow_03_checkout_full.png'), fullPage: true });

    // Analyze checkout page
    const checkoutAnalysis = await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        h1: document.querySelector('h1')?.textContent?.trim(),
        forms: document.querySelectorAll('form').length,
        inputs: [...document.querySelectorAll('input:not([type="hidden"])')]
          .map(i => ({ type: i.type, name: i.name, placeholder: i.placeholder, required: i.required }))
          .filter(i => i.name),
        paymentMethods: [...document.querySelectorAll('[class*="payment"], [class*="pagamento"], [class*="pay"]')]
          .map(el => el.textContent?.trim()?.substring(0, 100)),
        securityBadges: document.querySelectorAll('[class*="security"], [class*="seguranca"], [class*="trust"], [class*="safe"]').length,
        ssl: window.location.protocol === 'https:',
        hasLoginForm: !!document.querySelector('[class*="login"], [class*="signin"]'),
        textContent: document.body?.textContent?.replace(/\s+/g, ' ')?.trim()?.substring(0, 500)
      };
    });
    console.log('\n6. Analise do checkout:', JSON.stringify(checkoutAnalysis, null, 2));
  }

  await browser.close();
  console.log('\n=== FIM ===');
}

main().catch(console.error);
