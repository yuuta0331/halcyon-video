#!/usr/bin/env node
// Rasterize public/brand-packs/halcyon-jp wrap PNGs from project-authored
// canvas source. Uses the bundled Noto Sans JP face (BBCjk). Provenance:
// public/brand-packs/halcyon-jp/NOTES.md
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/brand-packs/halcyon-jp');
const html = readFileSync(path.join(root, 'tools/halcyon-jp-art.html'), 'utf8');

function contentType(p) {
  if (p.endsWith('.woff2')) return 'font/woff2';
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.js')) return 'text/javascript';
  return 'application/octet-stream';
}

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (url === '/' || url === '/art.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html.replace("url('/src/assets/noto-sans-jp-regular.woff2')", "url('/font.woff2')"));
    return;
  }
  if (url === '/font.woff2') {
    const buf = readFileSync(path.join(root, 'src/assets/noto-sans-jp-regular.woff2'));
    res.writeHead(200, { 'content-type': 'font/woff2' });
    res.end(buf);
    return;
  }
  if (url === '/save' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        mkdirSync(path.join(outDir, 'wraps'), { recursive: true });
        for (const [rel, dataUrl] of Object.entries(body)) {
          const b64 = String(dataUrl).split(',')[1];
          writeFileSync(path.join(outDir, rel), Buffer.from(b64, 'base64'));
          console.log('wrote', rel);
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const port = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
console.log('art server http://127.0.0.1:' + port + '/art.html');

const puppeteer = await import('puppeteer').catch(() => null);
if (!puppeteer) {
  if (process.argv.includes('--serve')) {
    // Browser will POST /save; keep listening.
    await new Promise(() => {});
  }
  console.error('puppeteer is not installed; re-run with --serve and open the URL');
  process.exit(1);
}

const browser = await puppeteer.default.launch({
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/art.html`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => document.title === 'halcyon-jp art ready', { timeout: 30000 });
  const art = await page.evaluate(() => window.__HALCYON_JP_ART__);
  mkdirSync(path.join(outDir, 'wraps'), { recursive: true });
  for (const [rel, dataUrl] of Object.entries(art)) {
    const b64 = String(dataUrl).split(',')[1];
    const dest = path.join(outDir, rel);
    writeFileSync(dest, Buffer.from(b64, 'base64'));
    console.log('wrote', rel, existsSync(dest) ? `${Buffer.from(b64, 'base64').length} bytes` : 'MISSING');
  }
} finally {
  await browser.close();
  server.close();
}
