// Phase 6 with real browsers: a live screen share reaches only the people in the same building, shows on the
// in-world screen and the theatre view, and stops cleanly. The browser's screen picker cannot be driven in a
// headless test, so the page is given an animated canvas as its "screen" through a test seam.
//
//   CHROMIUM=/path/to/chromium SHOTS=/some/dir node screenshare.mjs
import { chromium } from 'playwright-core';

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const VIEW = process.env.VIEW ?? '2d'; // '2d' or '3d': which view to test
// Software rendering in headless Chrome is slow, and several browsers share one CPU, so 3D tests use smaller windows.
const VIEWPORT = VIEW === '3d' ? { width: 800, height: 500 } : { width: 1280, height: 720 };
const SHOTS = process.env.SHOTS;
const ROOM = `SHARE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 15000) {
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
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

const fakeScreen = () => {
  // An animated 1280x720 canvas standing in for a shared screen.
  window.__hubbubDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const ctx = c.getContext('2d');
    let n = 0;
    setInterval(() => {
      ctx.fillStyle = '#1d3b2f';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#e8dcc0';
      ctx.font = '64px sans-serif';
      ctx.fillText('Quarterly plan', 80, 160);
      ctx.fillRect(80 + (n % 600), 300, 200, 80);
      n += 9;
    }, 50);
    return c.captureStream(20);
  };
};

async function join(name) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.addInitScript(fakeScreen);
  page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  await page.goto(`${APP_URL}/?view=${VIEW}#${ROOM}`);
  await page.fill('#name', name);
  await page.click('#join-button');
  await page.waitForSelector('#room-info');
  await page.waitForFunction(() => window.__hubbub?.world().loaded > 0);
  return page;
}
const hook = (page, fn, ...args) => page.evaluate(([f, a]) => window.__hubbub[f](...a), [fn, args]);
const inside = async (page, door) => {
  await hook(page, 'teleport', door.x, door.y);
  return waitFor(async () => (await hook(page, 'positions')).me.place === door.id, 'inside');
};

try {
  const alice = await join('Alice');
  const bob = await join('Bob');
  const cara = await join('Cara');
  const dave = await join('Dave');
  for (const p of [alice, bob, cara, dave]) await waitFor(async () => (await p.locator('#roster li[data-status=connected]').count()) === 4, 'all connected');

  check(await alice.locator('#share').isHidden(), 'no Share button while outdoors');
  const [door] = await hook(alice, 'doors');
  for (const p of [alice, bob, cara]) check(await inside(p, door), 'someone walked in');
  check(await alice.locator('#share').isVisible(), 'the Share button appears inside a building');
  check(await dave.locator('#share').isHidden(), 'Dave (outside) has no Share button');

  await alice.click('#share');
  check(await waitFor(async () => (await hook(alice, 'share')).sharing, 'Alice sharing'), 'Alice starts sharing');
  check((await alice.locator('#share').innerText()) === 'Stop sharing', 'the button now says Stop sharing');

  for (const [page, who] of [[bob, 'Bob'], [cara, 'Cara']]) {
    check(await waitFor(async () => (await hook(page, 'share')).watching === 'Alice', `${who} sees the share`), `${who} is told Alice is sharing`);
    check(await waitFor(async () => (await hook(page, 'share')).videoFrames > 5, `${who} receives video frames`), `${who} receives live video frames`);
    check(await page.locator('#watch').isVisible(), `${who} gets a Watch button`);
    check(await waitFor(async () => (await hook(page, 'share')).tvShowing, `${who} TV`), `${who}'s in-world screen is showing the picture`);
  }
  await sleep(1200);
  await bob.screenshot({ path: SHOTS ? `${SHOTS}/share-tv.png` : undefined }).catch(() => {});

  // The theatre view shows the live picture large.
  await bob.click('#watch');
  check(await bob.locator('#theatre').isVisible(), 'Watch opens the theatre view');
  check(
    await waitFor(async () => bob.evaluate(() => { const v = document.getElementById('theatre-video'); return v.videoWidth > 0 && !v.paused; }), 'theatre playing'),
    'the theatre video is playing the shared screen',
  );
  if (SHOTS) await bob.screenshot({ path: `${SHOTS}/share-theatre.png` });
  await bob.click('#theatre-close');
  check(await bob.locator('#theatre').isHidden(), 'Close hides the theatre');

  // Dave is outside: he gets nothing at all.
  await sleep(800);
  check((await hook(dave, 'videoBytesFrom', 'Alice')) === 0, 'Dave, outside the building, receives no video');
  check((await hook(dave, 'share')).watching === null && (await dave.locator('#watch').isHidden()), 'and has no Watch button');

  // A second person cannot start over the top of the first.
  await bob.click('#share');
  check(
    await waitFor(async () => (await bob.locator('#chat-log').innerText()).includes('already sharing'), 'busy message'),
    'Bob is told Alice is already sharing',
  );
  check(!(await hook(bob, 'share')).sharing, 'and Bob is not sharing');

  // Dave walks in later and gets the picture too.
  check(await inside(dave, door), 'Dave walks in');
  check(await waitFor(async () => (await hook(dave, 'share')).watching === 'Alice', 'Dave sees the share'), 'a late arrival is told about the share');
  check(await waitFor(async () => (await hook(dave, 'share')).videoFrames > 5, 'Dave receives video'), 'and receives the live video');

  // Stopping.
  await alice.click('#share');
  check(await waitFor(async () => !(await hook(alice, 'share')).sharing, 'Alice stopped'), 'Alice stops sharing');
  for (const [page, who] of [[bob, 'Bob'], [cara, 'Cara'], [dave, 'Dave']]) {
    check(await waitFor(async () => (await hook(page, 'share')).watching === null, `${who} cleared`), `${who}'s screen goes back to idle`);
    check(await page.locator('#watch').isHidden(), `${who}'s Watch button goes away`);
  }

  // Walking out of the building stops a share.
  await alice.click('#share');
  check(await waitFor(async () => (await hook(alice, 'share')).sharing, 'Alice sharing again'), 'Alice shares again');
  const room = await hook(alice, 'room');
  await hook(alice, 'teleport', room.door.x, room.door.y - 10);
  check(await waitFor(async () => !(await hook(alice, 'share')).sharing, 'share ended on exit'), 'walking out of the building ends the share');
  check(await waitFor(async () => (await hook(bob, 'share')).watching === null, 'Bob cleared after exit'), 'and viewers are told');
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
