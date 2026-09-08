#!/usr/bin/env bun
/*
 * UI audit: walks every public route at desktop and phone width and measures
 * what the playbook can be checked by machine — text contrast (rule D1),
 * type size (T2), horizontal overflow (L3/L9), and target size (I1). It writes
 * a full-page screenshot per route and viewport and exits non-zero when a
 * contrast or overflow finding remains.
 *
 * Usage (dev server already running on BASE):
 *   SHOT_BASE_URL=http://127.0.0.1:4397 \
 *   SHOT_OUT_DIR=/tmp/shots \
 *   bun scripts/run-with-timeout.mjs 900 -- bun scripts/ui-audit.mjs
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = (process.env.SHOT_BASE_URL ?? 'http://127.0.0.1:4397').replace(/\/+$/, '');
const OUT = process.env.SHOT_OUT_DIR ?? '/tmp/polis-ui-audit';
const JSON_OUT = process.env.UI_AUDIT_JSON ?? '';

const ROUTES = [
  '/',
  '/hr',
  '/presentation',
  '/transparency',
  '/source',
  '/docs',
  '/methodology',
  '/privacy',
  '/security',
  '/release-boundary',
  '/demo/citizen',
  '/demo/official',
  '/demo/review',
  '/demo/record',
  '/demo/embed',
  '/verify',
  '/proofs',
  '/login',
  '/issues',
  '/assistant',
  '/audit',
  '/complaints',
  '/partners',
  '/pilot/results',
  '/contribute/evidence',
  '/pilot/vrsar',
  '/pilot/vrsar/login',
  '/pilot/vrsar/receipts',
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

async function systemChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Playwright browser downloads are forbidden here; try the next install.
    }
  }
  throw new Error(`No system Chrome found. Checked: ${CHROME_CANDIDATES.join(', ')}`);
}

function slug(route) {
  const cleaned = route.replace(/^\/+|\/+$/g, '');
  return cleaned === '' ? 'home' : cleaned.replace(/\//g, '-');
}

/*
 * Runs in the page. Everything it needs has to be self-contained, so the colour
 * maths and the DOM walk live in one function body.
 */
function auditInPage() {
  const parseColor = (value) => {
    const match = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!match) return null;
    const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };

  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  const luminance = ({ r, g, b }) => {
    const channel = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  const ratio = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (Number(style.opacity) === 0) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };

  // The first ancestor that actually paints something opaque behind the text.
  const backdrop = (el) => {
    let node = el;
    let acc = null;
    while (node) {
      const style = getComputedStyle(node);
      const bg = parseColor(style.backgroundColor);
      if (bg && bg.a > 0) {
        acc = acc ? over(acc, bg) : bg;
        if (acc.a >= 0.999) return acc;
      }
      node = node.parentElement;
    }
    const page = parseColor(getComputedStyle(document.body).backgroundColor);
    const fallback = page && page.a > 0 ? page : { r: 255, g: 255, b: 255, a: 1 };
    return acc ? over(acc, fallback) : fallback;
  };

  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };

  const clip = (text) => (text || '').replace(/\s+/g, ' ').trim().slice(0, 60);

  const contrast = [];
  const typeSize = [];
  const targets = [];
  const seen = new Set();

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = (node.nodeValue || '').trim();
    const el = node.parentElement;
    if (text && el && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) && visible(el)) {
      const style = getComputedStyle(el);
      const fg = parseColor(style.color);
      if (fg) {
        const bg = backdrop(el);
        const solid = fg.a < 1 ? over(fg, bg) : fg;
        const size = Number.parseFloat(style.fontSize);
        const weight = Number(style.fontWeight) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const need = large ? 3 : 4.5;
        const value = ratio(solid, bg);
        if (value < need) {
          const key = `c:${describe(el)}:${style.color}:${Math.round(value * 100)}`;
          if (!seen.has(key)) {
            seen.add(key);
            contrast.push({
              el: describe(el),
              text: clip(text),
              fg: style.color,
              bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
              size: Math.round(size * 100) / 100,
              weight,
              ratio: Math.round(value * 100) / 100,
              need,
            });
          }
        }
      }
    }
    node = walker.nextNode();
  }

  // Type size. Anything under 12px fails outright; body-copy tags must hold 16px
  // unless they are marked as a meta/data/label role, which may go to 13px.
  const metaRole = (el) => {
    if (el.closest('.status-label, .trust-badge, .badge, .meaning-label, .pilot-status, .demo-stamp, .demo-chip'))
      return true;
    const size = getComputedStyle(el).fontSize;
    const meta = getComputedStyle(document.documentElement).getPropertyValue('--type-meta').trim();
    const data = getComputedStyle(document.documentElement).getPropertyValue('--type-data').trim();
    const label = getComputedStyle(document.documentElement).getPropertyValue('--type-label').trim();
    const px = (value) => {
      if (!value) return null;
      if (value.endsWith('rem')) return Number.parseFloat(value) * 16;
      if (value.endsWith('px')) return Number.parseFloat(value);
      return null;
    };
    const current = Number.parseFloat(size);
    return [meta, data, label].some((token) => {
      const target = px(token);
      return target !== null && Math.abs(target - current) < 0.51;
    });
  };

  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    const own = [...el.childNodes].some((child) => child.nodeType === 3 && (child.nodeValue || '').trim());
    if (!own || !visible(el)) continue;
    const size = Number.parseFloat(getComputedStyle(el).fontSize);
    const bodyTag = ['P', 'LI', 'DD', 'TD', 'LABEL'].includes(el.tagName);
    let floor = null;
    if (size < 12) floor = 12;
    else if (bodyTag) floor = metaRole(el) ? 13 : 16;
    if (floor !== null && size < floor) {
      const key = `t:${describe(el)}:${size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      typeSize.push({ el: describe(el), text: clip(el.textContent), size: Math.round(size * 100) / 100, floor });
    }
  }

  // Target size. Inline links sitting inside a run of prose are exempt: they are
  // words in a sentence, not controls (WCAG 2.2 inline exception).
  for (const el of document.querySelectorAll('a, button, input, select, summary')) {
    if (!visible(el)) continue;
    const box = el.getBoundingClientRect();
    if (box.width >= 44 && box.height >= 44) continue;
    if (el.tagName === 'INPUT' && ['hidden', 'checkbox', 'radio'].includes(el.type)) continue;
    const inlineLink =
      el.tagName === 'A' &&
      getComputedStyle(el).display.startsWith('inline') &&
      Boolean(el.closest('p, li, dd, td, blockquote, figcaption, .prose'));
    targets.push({
      el: describe(el),
      text: clip(el.textContent) || el.getAttribute('aria-label') || '',
      width: Math.round(box.width * 10) / 10,
      height: Math.round(box.height * 10) / 10,
      inlineLink,
    });
  }

  return {
    contrast,
    typeSize,
    targets,
    overflow: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
  };
}

function table(rows) {
  return rows.map((row) => `      ${row}`).join('\n');
}

let browser;
try {
  await mkdir(OUT, { recursive: true });
  browser = await chromium.launch({
    executablePath: await systemChrome(),
    headless: true,
    args: ['--disable-background-networking', '--no-first-run'],
  });

  const report = [];
  let contrastTotal = 0;
  let overflowTotal = 0;
  let typeTotal = 0;
  let targetTotal = 0;
  let inlineExemptTotal = 0;

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    for (const route of ROUTES) {
      const label = `${route} @ ${viewport.name}`;
      let result;
      let status = 0;
      try {
        const response = await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 30_000 });
        status = response ? response.status() : 0;
        await page.waitForTimeout(250);
        result = await page.evaluate(auditInPage);
      } catch (error) {
        console.log(`\n${label}\n  LOAD FAILED: ${error instanceof Error ? error.message : error}`);
        report.push({ route, viewport: viewport.name, error: String(error) });
        continue;
      }

      const overflow = result.overflow.scrollWidth > result.overflow.clientWidth + 1;
      const smallTargets = result.targets.filter((t) => !t.inlineLink);
      const inlineExempt = result.targets.filter((t) => t.inlineLink);
      contrastTotal += result.contrast.length;
      typeTotal += result.typeSize.length;
      targetTotal += smallTargets.length;
      inlineExemptTotal += inlineExempt.length;
      if (overflow) overflowTotal += 1;

      const shot = path.join(OUT, `${slug(route)}-${viewport.name}.png`);
      await page.screenshot({ path: shot, fullPage: true });

      report.push({
        route,
        viewport: viewport.name,
        status,
        contrast: result.contrast,
        typeSize: result.typeSize,
        targets: smallTargets,
        inlineExempt: inlineExempt.length,
        overflow: overflow ? result.overflow : null,
      });

      const head =
        `\n${label}  [${status}]  contrast ${result.contrast.length}` +
        `  type ${result.typeSize.length}` +
        `  targets ${smallTargets.length}` +
        `  overflow ${overflow ? `${result.overflow.scrollWidth}>${result.overflow.clientWidth}` : 'ok'}`;
      console.log(head);
      if (result.contrast.length) {
        console.log(
          table(
            result.contrast.map(
              (c) => `contrast ${c.ratio}:1 (need ${c.need}) ${c.el} ${c.size}px/${c.weight} ${c.fg} on ${c.bg} — "${c.text}"`,
            ),
          ),
        );
      }
      if (result.typeSize.length) {
        console.log(table(result.typeSize.map((t) => `type ${t.size}px (min ${t.floor}) ${t.el} — "${t.text}"`)));
      }
      if (smallTargets.length) {
        console.log(table(smallTargets.map((t) => `target ${t.width}x${t.height} ${t.el} — "${t.text}"`)));
      }
    }
    await context.close();
  }

  console.log('\n=== ui-audit summary ===');
  console.log(`base            ${BASE}`);
  console.log(`routes          ${ROUTES.length} x ${VIEWPORTS.length} viewports = ${ROUTES.length * VIEWPORTS.length} checks`);
  console.log(`contrast fails  ${contrastTotal}`);
  console.log(`overflow fails  ${overflowTotal}`);
  console.log(`type fails      ${typeTotal}`);
  console.log(`small targets   ${targetTotal} (plus ${inlineExemptTotal} inline-link exceptions)`);
  console.log(`screenshots     ${OUT}`);

  if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify(report, null, 2));

  if (contrastTotal > 0 || overflowTotal > 0) {
    console.error(`\nui-audit failed: ${contrastTotal} contrast and ${overflowTotal} overflow findings`);
    process.exitCode = 1;
  } else {
    console.log('\nui-audit passed: no contrast or overflow findings');
  }
} finally {
  if (browser) await browser.close();
}
