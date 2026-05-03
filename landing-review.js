const { chromium } = require('/usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const fileUrl = 'file:///Users/netanelmalka/Desktop/%D7%AA%D7%96%D7%95%D7%A0%D7%94/%D7%9E%D7%A2%D7%A8%D7%9B%D7%AA%20%D7%A0%D7%99%D7%94%D7%95%D7%9C%20%D7%9C%D7%A7%D7%95%D7%97%D7%95%D7%AA/landing/index.html';

  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500); // wait for fonts

  // Screenshot 1: Hero + stats (top of page)
  await page.screenshot({
    path: '/Users/netanelmalka/Desktop/תזונה/מערכת ניהול לקוחות/review-1-hero.png',
    fullPage: false,
  });
  console.log('Shot 1: Hero done');

  // Scroll to 1000px
  await page.evaluate(() => window.scrollTo({ top: 1000, behavior: 'instant' }));
  await page.waitForTimeout(600);
  await page.screenshot({
    path: '/Users/netanelmalka/Desktop/תזונה/מערכת ניהול לקוחות/review-2-beliefs.png',
    fullPage: false,
  });
  console.log('Shot 2: Beliefs done');

  // Scroll to 2000px
  await page.evaluate(() => window.scrollTo({ top: 2000, behavior: 'instant' }));
  await page.waitForTimeout(600);
  await page.screenshot({
    path: '/Users/netanelmalka/Desktop/תזונה/מערכת ניהול לקוחות/review-3-benefits.png',
    fullPage: false,
  });
  console.log('Shot 3: Benefits done');

  // Scroll to 3000px
  await page.evaluate(() => window.scrollTo({ top: 3000, behavior: 'instant' }));
  await page.waitForTimeout(600);
  await page.screenshot({
    path: '/Users/netanelmalka/Desktop/תזונה/מערכת ניהול לקוחות/review-4-process-price.png',
    fullPage: false,
  });
  console.log('Shot 4: Process + price done');

  // Scroll to 4000px
  await page.evaluate(() => window.scrollTo({ top: 4000, behavior: 'instant' }));
  await page.waitForTimeout(600);
  await page.screenshot({
    path: '/Users/netanelmalka/Desktop/תזונה/מערכת ניהול לקוחות/review-5-testimonials-contact.png',
    fullPage: false,
  });
  console.log('Shot 5: Testimonials + contact done');

  // Scroll to bottom
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(600);
  await page.screenshot({
    path: '/Users/netanelmalka/Desktop/תזונה/מערכת ניהול לקוחות/review-6-footer.png',
    fullPage: false,
  });
  console.log('Shot 6: Footer done');

  // Also capture full page dimensions for reference
  const dims = await page.evaluate(() => ({
    scrollHeight: document.body.scrollHeight,
    scrollWidth: document.body.scrollWidth,
  }));
  console.log('Page dimensions:', dims);

  // Grab computed styles of key elements
  const styles = await page.evaluate(() => {
    const getColor = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return `NOT FOUND: ${selector}`;
      return window.getComputedStyle(el).backgroundColor;
    };
    const getFont = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return `NOT FOUND: ${selector}`;
      const cs = window.getComputedStyle(el);
      return { fontFamily: cs.fontFamily, fontSize: cs.fontSize };
    };

    return {
      // Hero heading
      heroHeading: getFont('h1, .hero h1, [class*="hero"] h1, section:first-of-type h1'),
      // Price box
      priceBox: getColor('[class*="price"], .price-box, #price, [id*="price"], [class*="pricing"]'),
      // Contact section
      contactSection: getColor('[id*="contact"], [class*="contact"], form'),
      // Footer
      footer: getColor('footer'),
      // Body background
      bodyBg: getColor('body'),
    };
  });
  console.log('Computed styles:', JSON.stringify(styles, null, 2));

  // Get all section backgrounds
  const sectionBgs = await page.evaluate(() => {
    const sections = document.querySelectorAll('section, [class*="section"]');
    return Array.from(sections).map((s, i) => ({
      index: i,
      id: s.id || '',
      className: s.className.substring(0, 80),
      bg: window.getComputedStyle(s).backgroundColor,
    }));
  });
  console.log('Section backgrounds:', JSON.stringify(sectionBgs, null, 2));

  await browser.close();
})();
