#!/usr/bin/env node
/**
 * Usage:
 *   node screenshot.js capture <url> [--out <path>] [--viewport [WxH]] [--init <file.js>]
 *   node screenshot.js compare <image1> <image2> [--out <path>] [--threshold <0-100>] [--sensitivity <0-100>]
 *
 * capture  — full-page by default; --viewport (optionally WxH) takes a viewport crop;
 *            --init runs a Playwright page script after load, before the screenshot
 * compare  — prints diff stats; --out writes a red-highlight diff PNG
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
/** Default --sensitivity (0–100). Maps to pixelmatch 0.1. */
const DEFAULT_SENSITIVITY = 90;

function usage(exitCode = 1) {
  console.error(`Usage:
  node screenshot.js capture <url> [--out <path>] [--viewport [WxH]] [--init <file.js>]
  node screenshot.js compare <image1> <image2> [--out <path>] [--threshold <0-100>] [--sensitivity <0-100>]`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0) usage();

  const command = args[0];
  const positionals = [];
  const flags = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out') {
      const value = args[++i];
      if (!value || value.startsWith('--')) {
        console.error('Error: --out requires a path');
        process.exit(1);
      }
      flags.out = value;
    } else if (arg === '--threshold') {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) {
        console.error('Error: --threshold requires a number (e.g. 1)');
        process.exit(1);
      }
      const n = Number(value);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        console.error('Error: --threshold must be a number between 0 and 100');
        process.exit(1);
      }
      flags.threshold = n;
    } else if (arg === '--sensitivity') {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) {
        console.error('Error: --sensitivity requires a number (e.g. 90)');
        process.exit(1);
      }
      const n = Number(value);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        console.error('Error: --sensitivity must be a number between 0 and 100');
        process.exit(1);
      }
      flags.sensitivity = n;
    } else if (arg === '--viewport') {
      const next = args[i + 1];
      if (next && !next.startsWith('--') && /^\d+x\d+$/i.test(next)) {
        flags.viewport = next;
        i++;
      } else {
        flags.viewport = true;
      }
    } else if (arg === '--init') {
      const value = args[++i];
      if (!value || value.startsWith('--')) {
        console.error('Error: --init requires a path to a .js file');
        process.exit(1);
      }
      flags.init = value;
    } else if (arg.startsWith('--')) {
      console.error(`Error: unknown option ${arg}`);
      usage();
    } else {
      positionals.push(arg);
    }
  }

  return { command, positionals, flags };
}

function parseViewport(value) {
  if (value === true) return { ...DEFAULT_VIEWPORT };
  const match = String(value).match(/^(\d+)x(\d+)$/i);
  if (!match) {
    console.error('Error: --viewport size must look like 1024x768');
    process.exit(1);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function urlSlug(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    console.error(`Error: invalid URL: ${urlString}`);
    process.exit(1);
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const pathname = parsed.pathname.replace(/\/+$/, '') || '';
  const raw = `${host}${pathname}`;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'screenshot';
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function defaultCapturePath(urlString) {
  return `${urlSlug(urlString)}-${timestamp()}.png`;
}

function loadInitScript(initPath) {
  const resolved = path.resolve(process.cwd(), initPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: --init file not found: ${resolved}`);
    process.exit(1);
  }
  // Clear cache so edits to the init script are picked up across runs
  delete require.cache[require.resolve(resolved)];
  const exported = require(resolved);
  const fn = typeof exported === 'function' ? exported : exported?.default;
  if (typeof fn !== 'function') {
    console.error(
      'Error: --init file must export an async function, e.g. module.exports = async (page) => { ... }'
    );
    process.exit(1);
  }
  return fn;
}

async function capture(url, flags) {
  if (!url) {
    console.error('Error: capture requires a <url>');
    usage();
  }

  const useViewport = flags.viewport !== undefined;
  const viewport = useViewport
    ? parseViewport(flags.viewport)
    : { ...DEFAULT_VIEWPORT };
  const outPath = flags.out || defaultCapturePath(url);
  const initFn = flags.init ? loadInitScript(flags.init) : null;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    if (initFn) await initFn(page);
    await page.screenshot({
      path: outPath,
      fullPage: !useViewport,
    });
  } finally {
    await browser.close();
  }

  console.log(outPath);
}

function loadPng(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: file not found: ${filePath}`);
    process.exit(1);
  }
  return PNG.sync.read(fs.readFileSync(filePath));
}

function compare(image1, image2, flags) {
  if (!image1 || !image2) {
    console.error('Error: compare requires <image1> <image2>');
    usage();
  }

  const img1 = loadPng(image1);
  const img2 = loadPng(image2);

  if (img1.width !== img2.width || img1.height !== img2.height) {
    console.error(
      `Error: image dimensions differ ` +
        `(${img1.width}x${img1.height} vs ${img2.width}x${img2.height})`
    );
    process.exit(1);
  }

  const { width, height } = img1;
  const totalPixels = width * height;
  const diff = new PNG({ width, height });

  const sensitivity =
    flags.sensitivity !== undefined ? flags.sensitivity : DEFAULT_SENSITIVITY;
  // 100 = exact match (pixelmatch 0); 0 = ignore color diffs (pixelmatch 1)
  const colorThreshold = 1 - sensitivity / 100;

  const diffPixels = pixelmatch(
    img1.data,
    img2.data,
    diff.data,
    width,
    height,
    { threshold: colorThreshold }
  );

  const percent = totalPixels === 0 ? 0 : (diffPixels / totalPixels) * 100;

  console.log(`diffPixels: ${diffPixels}`);
  console.log(`totalPixels: ${totalPixels}`);
  console.log(`percentDifferent: ${percent.toFixed(2)}%`);

  if (flags.out) {
    const dir = path.dirname(flags.out);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(flags.out, PNG.sync.write(diff));
  }

  if (flags.threshold !== undefined) {
    if (percent > flags.threshold) process.exit(1);
  }
}

async function main() {
  const { command, positionals, flags } = parseArgs(process.argv);

  if (command === 'capture') {
    await capture(positionals[0], flags);
  } else if (command === 'compare') {
    compare(positionals[0], positionals[1], flags);
  } else {
    console.error(`Error: unknown command "${command}"`);
    usage();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
