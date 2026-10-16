// Phase 7 with real browsers: a broken peer connection heals itself, flooding is cut off, click to walk
// works, and the app copes with the server connection dropping.
//
//   CHROMIUM=/path/to/chromium node resilience.mjs
import { chromium } from 'playwright-core';

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const VIEW = process.env.VIEW ?? '2d'; // '2d' or '3d': which view to test
// Software rendering in headless Chrome is slow, and several browsers share one CPU, so 3D tests use smaller windows.
const VIEWPORT = VIEW === '3d' ? { width: 800, height: 500 } : { width: 1000, height: 700 };
const WORKER = process.env.WORKER_URL ?? 'http://localhost:8787';
const ROOM = `RESIL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return true;
    } catch {
      // keep trying
    }
    await sleep(150);
  }
  check(false, `timed out: ${what}`);
  return false;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  headless: true,
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const hook = (page, fn, ...args) => page.evaluate(([f, a]) => window.__hubbub[f](...a), [fn, args]);

async function join(name) {
  const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  await page.goto(`${APP_URL}/?view=${VIEW}#${ROOM}`);
  await page.fill('#name', name);
  await page.click('#join-button');
  await page.waitForSelector('#room-info');
  await page.waitForFunction(() => window.__hubbub?.world().loaded > 0);
  return page;
}
const allConnected = (p, n) => async () => Object.values(await hook(p, 'statuses')).filter((s) => s === 'connected').length === n;
const say = async (page, text) => {
  await page.fill('#chat-input', text);
  await page.press('#chat-input', 'Enter');
  await page.locator('#chat-input').blur();
};

try {
  const alice = await join('Alice');
  const bob = await join('Bob');
  const cara = await join('Cara');
  for (const p of [alice, bob, cara]) await waitFor(allConnected(p, 2), 'everyone connected');

  // 1. A broken connection heals. Break each direction so both "who starts it" cases are covered.
  for (const [breaker, other, otherName, breakerName] of [[alice, bob, 'Bob', 'Alice'], [bob, alice, 'Alice', 'Bob']]) {
    await hook(breaker, 'breakLink', otherName);
    check(
      await waitFor(async () => (await hook(breaker, 'statuses'))[otherName] !== 'connected', `${breakerName} sees the break`, 4000),
      `${breakerName} notices the connection to ${otherName} broke`,
    );
    check(await waitFor(async () => (await hook(breaker, 'statuses'))[otherName] === 'connected', `${breakerName} reconnects`), `${breakerName} reconnects to ${otherName}`);
    check(await waitFor(async () => (await hook(other, 'statuses'))[breakerName] === 'connected', `${otherName} reconnects`), `${otherName} is connected to ${breakerName} again`);
    const line = `after break from ${breakerName}`;
    await say(breaker, line);
    check(await waitFor(async () => (await other.locator('#chat-log').innerText()).includes(line), 'chat after heal'), 'chat flows again over the new connection');
  }
  check((await hook(cara, 'statuses')).Alice === 'connected' && (await hook(cara, 'statuses')).Bob === 'connected', 'Cara was not disturbed');

  // 2. Click to walk.
  await hook(alice, 'teleport', 200, 64);
  await sleep(500);
  const start = (await hook(alice, 'positions')).me;
  const vp = alice.viewportSize();
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  if (VIEW === '2d') {
    // The player is centred on screen and one screen pixel is one world pixel, so 160px right is 160px of walking.
    await alice.mouse.click(cx + 160, cy);
    await sleep(1500);
    const end = (await hook(alice, 'positions')).me;
    check(Math.abs(end.x - (start.x + 160)) < 25 && Math.abs(end.y - start.y) < 25, `clicking 160px to the right walks there (moved ${Math.round(end.x - start.x)}px)`);
  } else {
    // In 3D the screen is a perspective view, so the distance depends on the camera. Click well to the right of
    // the player, on the street, and check they walk that way and stop at the spot instead of carrying on.
    await alice.mouse.click(cx + 150, cy + 40);
    await sleep(3000);
    const end = (await hook(alice, 'positions')).me;
    check(end.x - start.x > 60 && Math.abs(end.y - start.y) < 120, `clicking to the right walks right (moved ${Math.round(end.x - start.x)}px across, ${Math.round(end.y - start.y)}px down)`);
    await sleep(600);
    const later = (await hook(alice, 'positions')).me;
    check(Math.hypot(later.x - end.x, later.y - end.y) < 3, 'and they stop when they get there');
  }
  await alice.keyboard.press('Escape');

  // 3. Flooding the signalling socket is cut off.
  const flood = await alice.evaluate(
    (worker) =>
      new Promise((resolve) => {
        const ws = new WebSocket(`${worker.replace(/^http/, 'ws')}/room/FLOOD-${Math.random().toString(36).slice(2, 7)}`);
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'hello', name: 'Flood', color: '#d9a441', look: [0, 0, 0, 0, 0] }));
          for (let i = 0; i < 3000; i++) ws.send(JSON.stringify({ type: 'signal', to: 'nobody', data: { kind: 'ice', candidate: {} } }));
        };
        ws.onclose = (e) => resolve(e.code);
        setTimeout(() => resolve('still open'), 8000);
      }),
    WORKER,
  );
  check(flood === 1008, `a socket sending 3000 messages at once is closed (code ${flood})`);

  // 4. Losing the server: the page says so and rejoins by itself, and the room sees one person leave and return.
  const carasView = async () => Object.keys(await hook(cara, 'statuses')).join(',');
  check((await carasView()).includes('Bob'), 'Cara can see Bob before the drop');
  await bob.evaluate(() => { window.__marker = 1; });
  await hook(bob, 'dropServer');
  const banner = await bob.waitForSelector('#banner:not([hidden])', { timeout: 3000 }).then(() => true, () => false);
  check(banner, 'Bob sees a banner saying the connection was lost');
  check(
    await waitFor(async () => !(await carasView()).includes('Bob'), 'Cara sees Bob leave', 8000),
    'the others see Bob leave the room',
  );
  // After a short pause the page reloads and joins again on its own. A marker set before the drop disappears
  // when the page reloads, which tells the new page from the old one.
  check(
    await waitFor(async () => {
      try {
        const reloaded = await bob.evaluate(() => window.__marker === undefined && typeof window.__hubbub === 'object');
        return reloaded && (await bob.locator('#room-info').isVisible()) && (await allConnected(bob, 2)());
      } catch {
        return false; // the page is mid-reload
      }
    }, 'Bob rejoined', 25000),
    'Bob rejoins by himself and is connected to both of them again',
  );
  check(
    await waitFor(async () => (await hook(cara, 'statuses')).Bob === 'connected', 'Cara connected to the new Bob'),
    'Cara is connected to Bob again (not just told he arrived)',
  );
  await say(bob, 'back again');
  check(await waitFor(async () => (await cara.locator('#chat-log').innerText()).includes('back again'), 'chat after rejoin'), 'and chat works after the rejoin');
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
