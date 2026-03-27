#!/usr/bin/env node
// qa/diagram-qa.js — Visual QA for SVG diagrams using Playwright
// Usage: node qa/diagram-qa.js [--baseline]
//
// Flags:
//   --baseline   Save screenshots as new baseline (first run or after intentional changes)
//   --no-pixel   Skip pixel analysis (screenshot capture only)

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// Resolve playwright from PATH first, fall back to known local install location
function resolvePlaywright() {
  try { require.resolve('playwright'); return 'playwright'; } catch (_) {}
  const local = '/opt/node22/lib/node_modules/playwright';
  if (require('fs').existsSync(local)) return local;
  throw new Error('playwright not found. Run: npm install -g playwright');
}
const PLAYWRIGHT_PATH = resolvePlaywright();
const ROOT_DIR = path.join(__dirname, '..');
const ARTICLES_DIR = path.join(ROOT_DIR, 'articles');
const CSS_DIR = path.join(ROOT_DIR, 'assets', 'css');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const BASELINE_DIR = path.join(SCREENSHOTS_DIR, 'baseline');
const REPORT_PATH = path.join(SCREENSHOTS_DIR, 'report.json');
const VIEWPORT = { width: 1400, height: 900 };

// CSS files to inline (in load order matching articles)
const CSS_FILES = ['base.css', 'layout.css', 'components.css', 'animations.css', 'article.css'];

// Background color of .diagram wrapper: #141414 = RGB(20,20,20)
const BG_COLOR = { r: 20, g: 20, b: 20 };
const BG_TOLERANCE = 15;
const BLANK_THRESHOLD = 0.95; // >95% bg pixels = blank

// Accent color: #FF3D00 = RGB(255,61,0)
const ACCENT_COLOR = { r: 255, g: 61, b: 0 };
const ACCENT_TOLERANCE = 30;
const ACCENT_MIN_PIXELS = 5; // at least 5 accent pixels expected

// Pixel diff for regression: flag if >2% bytes differ by >20
const DIFF_TOLERANCE = 20;
const DIFF_MAX_RATIO = 0.02;

const IS_BASELINE = process.argv.includes('--baseline');
const SKIP_PIXEL = process.argv.includes('--no-pixel');
// In CI, skip baseline diff to avoid false positives from cross-platform font/rendering differences
const SKIP_DIFF = process.argv.includes('--no-diff') || (process.env.CI === 'true');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function slugify(filename) {
  return filename.replace('.html', '');
}

// Build an inline-CSS version of an article HTML so setContent() works without a server.
function buildInlineHtml(articlePath) {
  let html = fs.readFileSync(articlePath, 'utf8');

  // Build combined CSS
  const combinedCss = CSS_FILES.map(f => {
    const cssPath = path.join(CSS_DIR, f);
    if (!fs.existsSync(cssPath)) return '';
    return fs.readFileSync(cssPath, 'utf8');
  }).join('\n');

  // Remove existing <link rel="stylesheet"> tags
  html = html.replace(/<link[^>]+rel="stylesheet"[^>]*>/gi, '');

  // Inject combined CSS as <style> before </head>
  html = html.replace('</head>', `<style>\n${combinedCss}\n</style>\n</head>`);

  // Remove JS scripts to avoid fetch errors (search.js, nav.js, etc.)
  html = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/gi, '');

  return html;
}

// PNG filter reconstruction (required before reading pixel values)
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function reconstructPngRows(raw, width, height, channels) {
  const stride = width * channels;
  const bytesPerRow = 1 + stride;
  const pixels = Buffer.alloc(height * stride);
  const prevRow = Buffer.alloc(stride); // zeros for row -1

  for (let y = 0; y < height; y++) {
    const filterType = raw[y * bytesPerRow];
    const srcRow = raw.slice(y * bytesPerRow + 1, y * bytesPerRow + 1 + stride);
    const dstRow = pixels.slice(y * stride, (y + 1) * stride);
    const prv = y === 0 ? prevRow : pixels.slice((y - 1) * stride, y * stride);

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? dstRow[x - channels] : 0;
      const b = prv[x];
      const c = x >= channels ? prv[x - channels] : 0;
      const src = srcRow[x];
      let val;
      switch (filterType) {
        case 0: val = src; break;                              // None
        case 1: val = (src + a) & 0xff; break;                // Sub
        case 2: val = (src + b) & 0xff; break;                // Up
        case 3: val = (src + Math.floor((a + b) / 2)) & 0xff; break; // Average
        case 4: val = (src + paethPredictor(a, b, c)) & 0xff; break; // Paeth
        default: val = src;
      }
      dstRow[x] = val;
    }
  }
  return pixels;
}

// Pixel analysis of PNG buffer (raw RGBA PNG from Playwright)
function analyzePixels(pngBuffer) {
  const zlib = require('zlib');

  const width = pngBuffer.readUInt32BE(16);
  const height = pngBuffer.readUInt32BE(20);
  const colorType = pngBuffer[25]; // 2=RGB, 6=RGBA
  const channels = colorType === 6 ? 4 : 3;

  // Collect IDAT chunks
  const idatBuffers = [];
  let offset = 8;
  while (offset < pngBuffer.length - 12) {
    const chunkLen = pngBuffer.readUInt32BE(offset);
    const chunkType = pngBuffer.slice(offset + 4, offset + 8).toString('ascii');
    if (chunkType === 'IDAT') idatBuffers.push(pngBuffer.slice(offset + 8, offset + 8 + chunkLen));
    if (chunkType === 'IEND') break;
    offset += 12 + chunkLen;
  }

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idatBuffers));
  } catch (e) {
    return null; // can't parse
  }

  // Apply PNG filter reconstruction
  const pixels = reconstructPngRows(raw, width, height, channels);
  const stride = width * channels;

  let totalPixels = 0;
  let bgPixels = 0;
  let accentPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * stride + x * channels;
      const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2];
      totalPixels++;

      if (Math.abs(r - BG_COLOR.r) <= BG_TOLERANCE &&
          Math.abs(g - BG_COLOR.g) <= BG_TOLERANCE &&
          Math.abs(b - BG_COLOR.b) <= BG_TOLERANCE) bgPixels++;

      if (Math.abs(r - ACCENT_COLOR.r) <= ACCENT_TOLERANCE &&
          Math.abs(g - ACCENT_COLOR.g) <= ACCENT_TOLERANCE &&
          Math.abs(b - ACCENT_COLOR.b) <= ACCENT_TOLERANCE) accentPixels++;
    }
  }

  const bgRatio = bgPixels / totalPixels;
  const hasAccentColor = accentPixels >= ACCENT_MIN_PIXELS;
  return {
    width, height, totalPixels, bgPixels, accentPixels,
    bgRatio,
    // A diagram is blank only if the background dominates AND there is no accent color.
    // Sparse-but-valid diagrams on dark backgrounds may have high bg ratios.
    isBlank: bgRatio >= BLANK_THRESHOLD && !hasAccentColor,
    hasAccentColor,
  };
}

function compareBaseline(newBuf, basePath) {
  if (!fs.existsSync(basePath)) return null;
  const baseBuf = fs.readFileSync(basePath);
  if (newBuf.length !== baseBuf.length) return { diffRatio: 1.0, reason: 'size mismatch', exceeds: true };

  let diffBytes = 0;
  for (let i = 0; i < newBuf.length; i++) {
    if (Math.abs(newBuf[i] - baseBuf[i]) > DIFF_TOLERANCE) diffBytes++;
  }
  const diffRatio = diffBytes / newBuf.length;
  return { diffRatio, exceeds: diffRatio > DIFF_MAX_RATIO };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  ensureDir(SCREENSHOTS_DIR);
  ensureDir(BASELINE_DIR);

  const { chromium } = require(PLAYWRIGHT_PATH);

  const articles = fs.readdirSync(ARTICLES_DIR)
    .filter(f => f.endsWith('.html'))
    .sort();

  console.log('Launching Chromium...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({ viewport: VIEWPORT });

  const report = [];
  let totalFailed = 0;

  try {
    for (const article of articles) {
      const slug = slugify(article);
      const articlePath = path.join(ARTICLES_DIR, article);
      console.log(`\nChecking: ${article}`);

      const html = buildInlineHtml(articlePath);

      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      const diagramCount = await page.locator('.diagram').count();
      if (diagramCount === 0) {
        console.log(`  (no diagrams found)`);
        await page.close();
        continue;
      }

      // Small settle delay for CSS animations
      await page.waitForTimeout(300);

      const diagrams = await page.locator('.diagram').all();

      for (let i = 0; i < diagrams.length; i++) {
        const diagramHandle = diagrams[i];
        const screenshotName = `${slug}-diagram-${i + 1}.png`;
        const screenshotPath = path.join(SCREENSHOTS_DIR, screenshotName);
        const baselinePath = path.join(BASELINE_DIR, screenshotName);

        // Check bounding box
        const box = await diagramHandle.boundingBox();
        const sizeAnomaly = box && (box.height < 50 || box.width < 100);

        // Take screenshot
        const pngBuffer = await diagramHandle.screenshot({ type: 'png' });
        fs.writeFileSync(screenshotPath, pngBuffer);

        // Pixel analysis
        let pixelResult = null;
        let diffResult = null;

        if (!SKIP_PIXEL) {
          try {
            pixelResult = analyzePixels(pngBuffer);
          } catch (e) {
            console.error(`  WARN: Pixel analysis failed for diagram #${i + 1}: ${e.message}`);
          }

          if (IS_BASELINE) {
            fs.writeFileSync(baselinePath, pngBuffer);
          } else if (!SKIP_DIFF) {
            diffResult = compareBaseline(pngBuffer, baselinePath);
          }
        }

        // Determine pass/fail
        const checks = {
          sizeOk: !sizeAnomaly,
          notBlank: pixelResult ? !pixelResult.isBlank : true,
          hasAccentColor: pixelResult ? pixelResult.hasAccentColor : true,
          baselineMatch: diffResult ? !diffResult.exceeds : true,
        };
        const passed = Object.values(checks).every(Boolean);
        if (!passed) totalFailed++;

        // Log
        let detail = '';
        if (pixelResult) detail = ` bg=${(pixelResult.bgRatio * 100).toFixed(1)}% accent=${pixelResult.accentPixels}px`;
        if (sizeAnomaly) console.error(`  FAIL diagram #${i + 1}: size anomaly (${box.width}x${box.height})`);
        if (pixelResult && pixelResult.isBlank) console.error(`  FAIL diagram #${i + 1}: appears blank (${(pixelResult.bgRatio * 100).toFixed(1)}% background pixels)`);
        if (pixelResult && !pixelResult.hasAccentColor) console.error(`  FAIL diagram #${i + 1}: accent color #FF3D00 not found`);
        if (diffResult && diffResult.exceeds) console.error(`  FAIL diagram #${i + 1}: differs from baseline (${(diffResult.diffRatio * 100).toFixed(2)}% changed)`);
        if (passed) console.log(`  OK   diagram #${i + 1}${detail} → ${screenshotName}`);

        report.push({
          article,
          diagramIndex: i + 1,
          screenshotPath: screenshotName,
          baselinePath: `baseline/${screenshotName}`,
          box: box ? { width: Math.round(box.width), height: Math.round(box.height) } : null,
          pixelAnalysis: pixelResult ? {
            totalPixels: pixelResult.totalPixels,
            bgRatio: Math.round(pixelResult.bgRatio * 1000) / 1000,
            accentPixels: pixelResult.accentPixels,
            isBlank: pixelResult.isBlank,
            hasAccentColor: pixelResult.hasAccentColor,
          } : null,
          baselineDiff: diffResult,
          checks,
          passed,
        });
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }

  // Write report
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('\n=== Summary ===');
  console.log(`Diagrams checked: ${report.length}`);
  console.log(`Passed: ${report.filter(r => r.passed).length}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Report: ${REPORT_PATH}`);
  if (IS_BASELINE) console.log(`Baseline screenshots saved to: ${BASELINE_DIR}`);

  if (totalFailed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
