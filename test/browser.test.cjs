// Real browser rendering with synthetic data only. No live Supabase requests.
const { chromium, webkit } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { posten, einnahmen } = require('./fixture.js');
const root = path.join(__dirname, '..');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });

async function setup(page, storageMode = 'normal') {
  page.setDefaultTimeout(10000);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const name = url.pathname.slice(1) || 'index.html';
    const allowed = ['index.html', 'app.js', 'logic.js', 'style.css', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png'];
    if (url.origin !== 'http://cockpit.test' || !allowed.includes(name)) return route.abort();
    let body = fs.readFileSync(path.join(root, name));
    if (name === 'index.html') body = body.toString().replace(/<script>[\s\S]*?<\/script>/, '<script src="logic.js"></script><script src="app.js"></script>');
    const contentType = name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : 'text/html';
    await route.fulfill({ body, contentType });
  });
  await page.addInitScript(({ posten, einnahmen, storageMode }) => {
    const RealDate = Date;
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [2026, 10, 13, 17, 30])); }
      static now() { return new RealDate(2026, 10, 13, 17, 30).getTime(); }
    };
    if (storageMode === 'blocked') Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } });
    if (storageMode === 'corrupt') localStorage.setItem('cockpit-folds', '{bad json');
    const db = {
      posten, einnahmen, posten_zahlungen: [],
      kontostaende: [
        ...Array.from({ length: 35 }, (_, i) => ({ betrag: 500 + i, konto: 'sascha', erfasst_am: new Date(2026, 10, 13, 17, 0, 35-i).toISOString() })),
        { betrag: 300, konto: 'luna', erfasst_am: '2026-10-01T12:00:00Z' }
      ],
      aufgaben: [
        { id: 'future', titel: 'Zukünftige Testaufgabe', faellig: '2026-12-01', erledigt: false },
        { id: 'undated', titel: 'Ohne Termin <b>Text</b>', faellig: null, erledigt: false },
        ...Array.from({ length: 17 }, (_, i) => ({ id: 'done'+i, titel: 'Erledigte Aufgabe '+i, erledigt: true, erledigt_am: '2026-11-14' }))
      ]
    };
    window.supabase = { createClient: () => ({
      from(table) {
        let rows = db[table].slice();
        const q = {
          select() { return q; },
          eq(key, val) { rows = rows.filter(x => x[key] === val); return q; },
          or(filter) {
            if (filter !== 'konto.eq.sascha,konto.is.null') throw Error('Unexpected filter');
            rows = rows.filter(x => x.konto === 'sascha' || x.konto == null); return q;
          },
          order(key, opts) { rows.sort((a,b) => String(a[key] || '').localeCompare(String(b[key] || '')) * (opts.ascending ? 1 : -1)); return q; },
          limit(n) { rows = rows.slice(0,n); return q; },
          then(resolve) { return resolve({ data: rows, error: null }); }
        };
        return q;
      },
      auth: { getSession: async () => ({ data: { session: { user: { email: 'browser-test@example.com' } } } }), onAuthStateChange() {} }
    }) };
  }, { posten, einnahmen, storageMode });
}

async function check(browserType, width) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await setup(page);
    await page.goto('http://cockpit.test/');
    const pair = page.locator('.dashboard-money-pair');
    await pair.waitFor();
    assert(!((await pair.textContent()).includes('Lunas Stand fehlt')), 'Luna remains visible after 35 Sascha updates');
    await page.locator('[data-fold="today-future"] summary').click();
    await page.locator('[data-fold="today-finances"] summary').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('cockpit-folds'))['today-future'] === true);
    await page.reload();
    await page.locator('[data-fold="today-future"][open]').waitFor();
    assert.equal(await page.locator('[data-fold="today-finances"]').getAttribute('open'), null);
    await page.locator('[data-fold="today-finances"] summary').click();
    await page.screenshot({ path: path.join(output, `${browserType.name()}-${width}-dashboard.png`), fullPage: true });
    await page.locator('[data-action="tab"][data-tab="geld"]').click();
    assert.equal(await page.locator('details').count(), 5);
    await page.locator('[data-fold="money-forecast"] summary').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Money view fits viewport');
    await page.screenshot({ path: path.join(output, `${browserType.name()}-${width}-money.png`), fullPage: true });
    await page.locator('[data-action="tab"][data-tab="aufgaben"]').click();
    await page.locator('[data-fold="tasks-2"] summary').click();
    await page.getByText('Zukünftige Testaufgabe', { exact: true }).waitFor({ state: 'visible' });
    await page.locator('[data-fold="tasks-done"] summary').click();
    await page.getByText('Erledigte Aufgabe 16', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-fold="tasks-done"] .row').count(), 17);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Tasks fit viewport');
    assert.deepEqual(errors, []);
    await page.close();
    for (const mode of ['blocked', 'corrupt']) {
      const fallback = await browser.newPage({ viewport: { width, height: 844 } });
      await setup(fallback, mode);
      await fallback.goto('http://cockpit.test/');
      await fallback.locator('[data-fold="today-future"] summary').click();
      await fallback.getByText('Zukünftige Testaufgabe', { exact: true }).waitFor({ state: 'visible' });
      await fallback.close();
    }
    console.log(`${browserType.name()} ${width}px: reload persistence, account histories, money/tasks, all 17 completed tasks, storage fallback passed`);
  } finally { await browser.close(); }
}
(async () => {
  for (const engine of [chromium, webkit]) for (const width of [320, 390, 1280]) await check(engine, width);
})().catch(error => { console.error(error); process.exit(1); });
