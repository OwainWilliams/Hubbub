// Takes screenshots of the main views for a quick visual check. Not an assertion test.
//   CHROMIUM=/path/to/chromium SHOTS=/some/dir node screenshots.mjs
import { chromium } from 'playwright-core';

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const VIEW = process.env.VIEW ?? '2d'; // '2d' or '3d': which view to test
// Software rendering in headless Chrome is slow, and several browsers share one CPU, so 3D tests use smaller windows.
const VIEWPORT = VIEW === '3d' ? { width: 800, height: 500 } : { width: 1280, height: 720 };
const SHOTS = process.env.SHOTS ?? '.';
const ROOM = `SHOT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  headless: true,
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

async function join(name) {
  const page = await (await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: VIEW === '3d' ? 1 : 2 })).newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  await page.goto(`${APP_URL}/?view=${VIEW}#${ROOM}`);
  await page.fill('#name', name);
  await page.click('#join-button');
  await page.waitForSelector('#room-info');
  await page.waitForFunction(() => window.__hubbub?.world().loaded > 0);
  return page;
}
const hook = (page, fn, ...args) => page.evaluate(([f, a]) => window.__hubbub[f](...a), [fn, args]);

try {
  const a = await join('Alice');
  const b = await join('Bob');
  await sleep(1500);
  await a.fill('#chat-input', 'hello from the street');
  await a.press('#chat-input', 'Enter');
  await a.locator('#chat-input').blur();
  await sleep(600);
  await a.screenshot({ path: `${SHOTS}/outdoors.png` });
  await a.screenshot({ path: `${SHOTS}/bubble.png`, clip: { x: 500, y: 250, width: 300, height: 120 } });

  const [door] = await hook(a, 'doors');
  await hook(a, 'teleport', door.x, door.y);
  await hook(b, 'teleport', door.x, door.y);
  await sleep(1500);
  await a.screenshot({ path: `${SHOTS}/inside.png` });
} finally {
  await browser.close();
}
