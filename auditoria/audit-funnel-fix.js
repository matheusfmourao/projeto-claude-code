const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://lyvafit.com.br';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== RE-TESTE DO FUNIL (DRAWER CARRINHO) ===\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const results = { steps: [], frictionPoints: [] };

  try {
    // Step 1: Go to product page
    console.log('1. Navegando para pagina de produto...');
    await page.goto(`${BASE_URL}/produtos/top-maya-rosa-chiclete-133tt/`, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);

    // Step 2: Check for size selector and select a size
    console.log('2. Verificando seletor de tamanho...');
    const sizeInfo = await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      const sizeData = [];
      selects.forEach(s => {
        const opts = [...s.options].map(o => ({ value: o.value, text: o.text, disabled: o.disabled }));
        sizeData.push({ name: s.name, id: s.id, className: s.className, options: opts });
      });

      // Also check for radio/button size selectors
      const radioSizes = document.querySelectorAll('input[type="radio"][name*="option"], input[type="radio"][name*="size"]');
      const buttonSizes = document.querySelectorAll('[class*="variant"] button, [class*="size"] button, [data-option] button');

      return {
        selects: sizeData,
        radioCount: radioSizes.length,
        buttonCount: buttonSizes.length
      };
    });
    console.log('   Selects encontrados:', JSON.stringify(sizeInfo, null, 2));

    // Try to select a variant/size
    const variantSelects = await page.$$('select');
    for (const sel of variantSelects) {
      const options = await sel.evaluate(el => [...el.options].map((o, i) => ({ index: i, value: o.value, text: o.text })));
      console.log('   Opcoes do select:', options);
      if (options.length > 1) {
        await sel.selectOption({ index: 1 });
        console.log('   Selecionada opcao:', options[1]?.text);
        await sleep(500);
      }
    }

    // Step 3: Find and describe the buy button
    console.log('3. Procurando botao de compra...');
    const buyBtnInfo = await page.evaluate(() => {
      const allButtons = document.querySelectorAll('button, input[type="submit"]');
      const btnData = [];
      allButtons.forEach(btn => {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const text = btn.textContent?.trim()?.substring(0, 80);
          const type = btn.type;
          const form = btn.closest('form')?.action;
          if (text && (text.toLowerCase().includes('comprar') || text.toLowerCase().includes('add') || text.toLowerCase().includes('carrinho') || type === 'submit')) {
            btnData.push({
              text, type, form,
              classes: btn.className?.substring(0, 100),
              id: btn.id,
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
              disabled: btn.disabled,
              visible: rect.width > 0 && rect.height > 0
            });
          }
        }
      });

      // Also check for links styled as buttons
      const links = document.querySelectorAll('a[class*="btn"], a[class*="buy"], a[class*="comprar"]');
      links.forEach(a => {
        btnData.push({
          text: a.textContent?.trim()?.substring(0, 80),
          type: 'link',
          href: a.href,
          classes: a.className?.substring(0, 100)
        });
      });

      return btnData;
    });
    console.log('   Botoes encontrados:', JSON.stringify(buyBtnInfo, null, 2));

    // Step 4: Try to click the buy button
    console.log('4. Tentando clicar em COMPRAR...');

    // Try multiple approaches
    let addedToCart = false;

    // Approach 1: form submit button
    const submitBtn = await page.$('form[action*="cart"] button[type="submit"], form[action*="carrinho"] button[type="submit"]');
    if (submitBtn) {
      console.log('   Encontrado: form submit button');
      await submitBtn.click();
      addedToCart = true;
    }

    if (!addedToCart) {
      // Approach 2: button with "comprar" text
      const comprarBtn = await page.$('button:has-text("COMPRAR"), button:has-text("Comprar")');
      if (comprarBtn) {
        console.log('   Encontrado: botao com texto COMPRAR');
        await comprarBtn.click();
        addedToCart = true;
      }
    }

    if (!addedToCart) {
      // Approach 3: any submit button in product form
      const anySubmit = await page.$('.js-addtocart, .btn-add-to-cart, [data-action="addToCart"], .product-form button');
      if (anySubmit) {
        console.log('   Encontrado: botao generico de add to cart');
        await anySubmit.click();
        addedToCart = true;
      }
    }

    if (!addedToCart) {
      // Approach 4: click by text content
      try {
        await page.click('text=COMPRAR', { timeout: 3000 });
        addedToCart = true;
        console.log('   Clicado via text=COMPRAR');
      } catch {
        console.log('   text=COMPRAR nao encontrado');
      }
    }

    if (!addedToCart) {
      // Approach 5: evaluate and click via JS
      const clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, input[type="submit"]');
        for (const btn of buttons) {
          if (btn.textContent?.trim().toUpperCase().includes('COMPRAR') ||
              btn.closest('form[action*="cart"]')) {
            btn.click();
            return btn.textContent?.trim();
          }
        }
        return null;
      });
      if (clicked) {
        addedToCart = true;
        console.log('   Clicado via JS:', clicked);
      }
    }

    await sleep(3000);

    // Step 5: Check if cart drawer opened
    console.log('5. Verificando se o carrinho drawer abriu...');
    const cartDrawerInfo = await page.evaluate(() => {
      // Check for any visible overlay/drawer/modal
      const possibleDrawers = document.querySelectorAll(
        '[class*="cart"][class*="drawer"], [class*="cart"][class*="sidebar"], [class*="cart"][class*="modal"], ' +
        '[class*="cart"][class*="panel"], [class*="carrinho"], [id*="cart"], [id*="carrinho"], ' +
        '.js-cart, .js-modal-cart, .cart-popup, .mini-cart, .cart-notification'
      );

      const drawers = [];
      possibleDrawers.forEach(d => {
        const style = getComputedStyle(d);
        const rect = d.getBoundingClientRect();
        drawers.push({
          tag: d.tagName,
          classes: d.className?.substring(0, 150),
          id: d.id,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
        });
      });

      // Also check for cart item count change
      const cartBadge = document.querySelector('[class*="cart"] [class*="count"], [class*="cart"] [class*="badge"], .js-cart-count');

      return {
        drawers,
        cartBadge: cartBadge?.textContent?.trim(),
        bodyHasOverlay: document.body.classList.toString()
      };
    });
    console.log('   Cart drawer info:', JSON.stringify(cartDrawerInfo, null, 2));

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'funnel_04_after_click.png'), fullPage: false });
    console.log('   Screenshot: funnel_04_after_click.png');

    // Step 6: Look for checkout button inside any visible cart drawer
    console.log('6. Procurando botao de checkout...');
    const checkoutInfo = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="checkout"], a:has-text("Finalizar"), button:has-text("Finalizar")');
      return [...links].map(l => ({
        text: l.textContent?.trim()?.substring(0, 80),
        href: l.href,
        tag: l.tagName,
        visible: l.getBoundingClientRect().width > 0
      }));
    });
    console.log('   Checkout buttons:', JSON.stringify(checkoutInfo, null, 2));

    // Final screenshot
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'funnel_final_state.png'), fullPage: true });

    // Also navigate trying the Nuvemshop checkout pattern
    console.log('\n7. Testando URL de checkout Nuvemshop...');
    const checkoutUrls = [
      '/checkout/v3/start',
      '/checkout/',
      '/comprar/',
    ];
    for (const url of checkoutUrls) {
      const resp = await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(e => null);
      if (resp) {
        console.log(`   ${url} -> Status: ${resp.status()}, URL final: ${page.url()}`);
        if (resp.status() !== 404) {
          await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `checkout_test_${url.replace(/\//g, '_')}.png`), fullPage: false });
        }
      }
    }

  } catch (err) {
    console.error('Erro:', err.message);
  } finally {
    await browser.close();
  }

  console.log('\n=== FIM DO RE-TESTE ===');
}

main().catch(console.error);
