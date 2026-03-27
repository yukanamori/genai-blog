#!/usr/bin/env node
// qa/check-structure.js — Static HTML structure validation for SVG diagrams
// Usage: node qa/check-structure.js

'use strict';

const fs = require('fs');
const path = require('path');

const ARTICLES_DIR = path.join(__dirname, '..', 'articles');
const REQUIRED_SVG_ATTRS = ['viewBox', 'xmlns', 'role', 'aria-label'];

let totalDiagrams = 0;
let failures = 0;

function fail(article, index, check, detail) {
  console.error(`  FAIL [${article}] diagram #${index + 1}: ${check}${detail ? ' — ' + detail : ''}`);
  failures++;
}

function findDiagramBlocks(html) {
  const blocks = [];
  const marker = '<div class="diagram">';
  let searchFrom = 0;

  while (true) {
    const start = html.indexOf(marker, searchFrom);
    if (start === -1) break;

    // Depth-track to find matching closing </div>
    let depth = 0;
    let i = start;
    let end = -1;

    while (i < html.length) {
      const openTag = html.indexOf('<div', i);
      const closeTag = html.indexOf('</div>', i);

      if (closeTag === -1) break;

      if (openTag !== -1 && openTag < closeTag) {
        depth++;
        i = openTag + 4;
      } else {
        if (depth === 1) {
          end = closeTag + 6; // include </div>
          break;
        }
        depth--;
        i = closeTag + 6;
      }
    }

    if (end === -1) {
      blocks.push({ content: html.slice(start), start });
    } else {
      blocks.push({ content: html.slice(start, end), start });
    }

    searchFrom = end === -1 ? html.length : end;
  }

  return blocks;
}

function checkArticle(filename) {
  const filepath = path.join(ARTICLES_DIR, filename);
  const html = fs.readFileSync(filepath, 'utf8');
  const blocks = findDiagramBlocks(html);

  if (blocks.length === 0) return;

  console.log(`\n  ${filename}: ${blocks.length} diagram(s)`);

  blocks.forEach((block, idx) => {
    totalDiagrams++;
    const { content } = block;

    // Check 1: SVG element exists
    if (!content.includes('<svg')) {
      fail(filename, idx, 'missing <svg>', null);
      return;
    }

    // Check 2: Required SVG attributes
    const svgStart = content.indexOf('<svg');
    const svgTagEnd = content.indexOf('>', svgStart);
    const svgOpenTag = content.slice(svgStart, svgTagEnd + 1);

    for (const attr of REQUIRED_SVG_ATTRS) {
      if (!svgOpenTag.includes(attr + '=') && !svgOpenTag.includes(attr + ' ')) {
        fail(filename, idx, `SVG missing attribute: ${attr}`, null);
      }
    }

    // Check 3: viewBox has 4 positive numbers
    const viewBoxMatch = svgOpenTag.match(/viewBox="([^"]+)"/);
    if (viewBoxMatch) {
      const parts = viewBoxMatch[1].trim().split(/\s+/);
      if (parts.length !== 4 || parts.some(p => isNaN(Number(p)))) {
        fail(filename, idx, 'invalid viewBox', viewBoxMatch[1]);
      } else {
        const [, , w, h] = parts.map(Number);
        if (w <= 0 || h <= 0) {
          fail(filename, idx, 'viewBox width/height not positive', viewBoxMatch[1]);
        }
      }
    }

    // Check 4: figcaption exists
    if (!content.includes('<figcaption>') && !content.includes('<figcaption ')) {
      fail(filename, idx, 'missing <figcaption>', null);
    }

    // Check 5: SVG has at least one <rect> or <path> (non-empty body)
    const svgBodyStart = content.indexOf('>', svgStart) + 1;
    const svgBodyEnd = content.lastIndexOf('</svg>');
    if (svgBodyStart < svgBodyEnd) {
      const svgBody = content.slice(svgBodyStart, svgBodyEnd);
      if (!svgBody.includes('<rect') && !svgBody.includes('<path') &&
          !svgBody.includes('<circle') && !svgBody.includes('<line') &&
          !svgBody.includes('<polygon') && !svgBody.includes('<g ') &&
          !svgBody.includes('<g>')) {
        fail(filename, idx, 'SVG body appears empty (no graphic elements)', null);
      }
    }

    if (failures === 0 || !failures) {
      // Only print OK if this diagram had no new failures
    }
  });
}

// Main
const articles = fs.readdirSync(ARTICLES_DIR)
  .filter(f => f.endsWith('.html'))
  .sort();

console.log('=== Diagram Structure Check ===');
articles.forEach(checkArticle);

console.log(`\n=== Summary ===`);
console.log(`Articles checked: ${articles.length}`);
console.log(`Diagrams checked: ${totalDiagrams}`);

if (failures > 0) {
  console.error(`Failures: ${failures}`);
  process.exit(1);
} else {
  console.log(`All ${totalDiagrams} diagrams passed structure checks.`);
}
