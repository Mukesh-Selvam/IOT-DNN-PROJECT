// client/scripts/take_screenshots.js
// Captures screenshots of every dashboard page using Edge (headless) + puppeteer-core
// Saves: login, dashboard_normal, dashboard_crash, simulator_panel,
//        incidents_list, incident_detail, contacts, ml_console, settings
// Usage: node scripts/take_screenshots.js

import puppeteerCore from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DASHBOARD_URL = 'http://127.0.0.1:5173';
const BACKEND_URL = 'http://127.0.0.1:5000';
const SIM_URL = 'http://127.0.0.1:5055';
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');
const EVIDENCE_DIR = path.resolve(__dirname, '../../docs/evidence');

// Try to find Edge or Chrome
function findBrowserExe() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function takeScreenshots() {
  const execPath = findBrowserExe();
  if (!execPath) {
    console.error('[Screenshots] No browser found. Cannot take screenshots.');
    process.exit(1);
  }
  console.log(`[Screenshots] Using browser: ${execPath}`);

  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const browser = await puppeteerCore.launch({
    executablePath: execPath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1440,900',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const results = [];

  async function capture(name, fn) {
    try {
      await fn();
      const outPath = path.join(SCREENSHOTS_DIR, `${name}.png`);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`[Screenshots] Captured: ${name}.png`);
      results.push({ name, status: 'OK', path: outPath });
    } catch (err) {
      console.error(`[Screenshots] FAILED ${name}: ${err.message}`);
      results.push({ name, status: 'FAILED', error: err.message });
    }
  }

  // 1. Login Page
  await capture('01_login', async () => {
    await page.goto(`${DASHBOARD_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1500);
  });

  // 2. Register + Login
  try {
    await page.goto(`${DASHBOARD_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Fill login form
    const emailSel = 'input[type="email"], input[placeholder*="email" i], #email';
    const passSel = 'input[type="password"], #password';
    await page.waitForSelector(emailSel, { timeout: 8000 });
    await page.type(emailSel, 'admin@iot-accident.local', { delay: 40 });
    await page.type(passSel, 'Password123!', { delay: 40 });
    await page.keyboard.press('Enter');
    await sleep(2500);
  } catch (e) {
    console.warn(`[Screenshots] Login step error (continuing): ${e.message}`);
  }

  // 3. Dashboard (normal state)
  await capture('02_dashboard_normal', async () => {
    await page.goto(`${DASHBOARD_URL}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2500);
  });

  // 4. Fleet Monitor
  await capture('03_fleet_monitor', async () => {
    await page.goto(`${DASHBOARD_URL}/fleet`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2000);
  });

  // 5. Live Map
  await capture('04_live_map', async () => {
    await page.goto(`${DASHBOARD_URL}/map`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(3000);
  });

  // 6. Trigger crash scenario via simulator API
  try {
    const http = await import('http');
    await new Promise((res, rej) => {
      const body = JSON.stringify({ vehicleId: 'ESP32-SIM-001', scenario: 'head_on' });
      const req = http.request(`${SIM_URL}/trigger`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (r) => { r.resume(); res(); });
      req.on('error', rej);
      req.write(body); req.end();
    });
    await sleep(600);
  } catch (e) {
    console.warn(`[Screenshots] Crash trigger: ${e.message}`);
  }

  // 7. Dashboard during crash (banner + countdown)
  await capture('05_dashboard_crash_banner', async () => {
    await page.goto(`${DASHBOARD_URL}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(3000);
  });

  // 8. Incidents list
  await capture('06_incidents_list', async () => {
    await page.goto(`${DASHBOARD_URL}/incidents`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2000);
  });

  // 9. Incident detail (click first incident if exists)
  await capture('07_incident_detail', async () => {
    await page.goto(`${DASHBOARD_URL}/incidents`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1000);
    const link = await page.$('a[href*="/incidents/"], tr[data-id], [data-testid="incident-row"]');
    if (link) { await link.click(); await sleep(1500); }
  });

  // 10. Contacts
  await capture('08_contacts', async () => {
    await page.goto(`${DASHBOARD_URL}/contacts`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1500);
  });

  // 11. Simulator Control Panel
  await capture('09_simulator_panel', async () => {
    await page.goto(`${DASHBOARD_URL}/simulator`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1500);
  });

  // 12. ML Console
  await capture('10_ml_console', async () => {
    await page.goto(`${DASHBOARD_URL}/ml`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1500);
  });

  // 13. Settings
  await capture('11_settings', async () => {
    await page.goto(`${DASHBOARD_URL}/settings`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1500);
  });

  // 14. Dark mode toggle attempt
  await capture('12_dark_mode', async () => {
    await page.goto(`${DASHBOARD_URL}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1000);
    // Try clicking dark mode toggle
    const toggle = await page.$('[data-testid="theme-toggle"], button[aria-label*="dark" i], .theme-toggle');
    if (toggle) { await toggle.click(); await sleep(800); }
  });

  await browser.close();

  // Write evidence log
  const logContent = `SCREENSHOT CAPTURE RESULTS\nTimestamp: ${new Date().toISOString()}\n\n` +
    results.map(r => `[${r.status}] ${r.name}.png${r.error ? ' - ' + r.error : ''}`).join('\n');
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'screenshot_results.txt'), logContent);
  console.log(`\n[Screenshots] Done. ${results.filter(r=>r.status==='OK').length}/${results.length} captured.`);
  console.log(`[Screenshots] Log saved to docs/evidence/screenshot_results.txt`);
}

takeScreenshots().catch(err => {
  console.error('[Screenshots] Fatal error:', err.message);
  process.exit(1);
});
