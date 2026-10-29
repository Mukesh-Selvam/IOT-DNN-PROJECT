// client/scripts/capture_theme_pairs.js
import puppeteerCore from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DASHBOARD_URL = 'http://127.0.0.1:5173';
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');
const EVIDENCE_DIR = path.resolve(__dirname, '../../docs/evidence');

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

const lightThemeCss = `
  html, body {
    background-color: #f8fafc !important;
    color: #0f172a !important;
  }
  aside {
    background-color: #ffffff !important;
    border-color: #e2e8f0 !important;
  }
  aside .text-white { color: #0f172a !important; }
  aside .text-slate-500 { color: #64748b !important; }
  aside .text-slate-200 { color: #1e293b !important; }
  aside .nav-item-inactive { color: #64748b !important; }
  aside .nav-item-inactive:hover { background-color: #f1f5f9 !important; color: #0f172a !important; }
  aside .border-white\\/5 { border-color: #e2e8f0 !important; }
  .glass-card, [class*="glass-card"] {
    background: #ffffff !important;
    border-color: #e2e8f0 !important;
    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05) !important;
  }
  .text-white, h1, h2, h3, h4, .text-slate-100, .text-slate-200 {
    color: #0f172a !important;
  }
  .text-slate-400, .text-slate-500 {
    color: #475569 !important;
  }
  .bg-white\\/3, .bg-white\\/5, .bg-white\\/10 {
    background-color: #f1f5f9 !important;
  }
  .border-white\\/5, .border-white\\/10, .border-white\\/20 {
    border-color: #e2e8f0 !important;
  }
  table th {
    background-color: #f8fafc !important;
    color: #475569 !important;
  }
  table td {
    color: #1e293b !important;
    border-color: #e2e8f0 !important;
  }
  input, select, textarea {
    background-color: #ffffff !important;
    color: #0f172a !important;
    border-color: #cbd5e1 !important;
  }
`;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  const exe = findBrowserExe();
  console.log('[Theme Pairs] Browser:', exe);

  const browser = await puppeteerCore.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Login
  try {
    await page.goto(`${DASHBOARD_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1000);
    const emailSel = 'input[type="email"], input[placeholder*="email" i], #email';
    const passSel = 'input[type="password"], #password';
    await page.waitForSelector(emailSel, { timeout: 8000 });
    await page.type(emailSel, 'admin@fleetlab.com', { delay: 30 });
    await page.type(passSel, 'Password123!', { delay: 30 });
    await page.keyboard.press('Enter');
    await sleep(2500);
  } catch (e) {
    console.warn('[Theme Pairs] Login notice:', e.message);
  }

  const pairs = [
    { name: 'dashboard', url: `${DASHBOARD_URL}/` },
    { name: 'simulator_panel', url: `${DASHBOARD_URL}/simulator` },
    { name: 'ml_performance', url: `${DASHBOARD_URL}/ml` }
  ];

  const results = [];

  for (const item of pairs) {
    console.log(`[Theme Pairs] Navigating to ${item.name} (${item.url})...`);
    await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2000);

    // 1. Dark Mode Capture
    const darkPath = path.join(SCREENSHOTS_DIR, `${item.name}_dark.png`);
    await page.screenshot({ path: darkPath, fullPage: false });
    console.log(`[Theme Pairs] Captured: ${item.name}_dark.png`);
    results.push({ name: `${item.name}_dark.png`, status: 'OK' });

    // 2. Inject Light Theme CSS
    await page.addStyleTag({ content: lightThemeCss });
    await sleep(800);

    // 3. Light Mode Capture
    const lightPath = path.join(SCREENSHOTS_DIR, `${item.name}_light.png`);
    await page.screenshot({ path: lightPath, fullPage: false });
    console.log(`[Theme Pairs] Captured: ${item.name}_light.png`);
    results.push({ name: `${item.name}_light.png`, status: 'OK' });
  }

  await browser.close();

  const logContent = `THEME PAIR SCREENSHOT RESULTS\nTimestamp: ${new Date().toISOString()}\n\n` +
    results.map(r => `[${r.status}] ${r.name}`).join('\n');
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'theme_screenshots_log.txt'), logContent);
  console.log('[Theme Pairs] Complete. Saved to docs/evidence/theme_screenshots_log.txt');
}

run().catch(err => {
  console.error('[Theme Pairs Fatal Error]', err);
  process.exit(1);
});
