// End-to-end check of Phase 1 with real browsers: three people join one room, see each other,
// chat, and watch each other move. Needs the Worker (npm run dev in worker/) and the app
// (npm run dev in app/) running locally.
//
//   APP_URL=http://localhost:5173 CHROMIUM=/path/to/chromium node two-peers.mjs
import { chromium } from 'playwright-core';

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const VIEW = process.env.VIEW ?? '2d'; // '2d' or '3d': which view to test
const CHROMIUM = process.env.CHROMIUM; // optional: path to a Chromium binary
const ROOM = `E2E-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
};

async function waitFor(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return true;
    } catch {
      // keep trying
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  check(false, `timed out: ${what}`);
  return false;
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: true,
  // Same-machine peers need real host candidates, not mDNS-hidden ones.
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});

async function join(name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  await page.goto(`${APP_URL}/?view=${VIEW}#${ROOM}`);
  await page.fill('#name', name);
  await page.click('#join-button');
  await page.waitForSelector('#room-info');
  return page;
}

try {
  const alice = await join('Alice');
  const bob = await join('Bob');
  const cara = await join('Cara');

  const connected = (page, n) => async () =>
    (await page.locator('#roster li[data-status=connected]').count()) === n + 1; // plus "(you)"

  check(await waitFor(connected(alice, 2), 'Alice connected to 2 peers'), 'Alice connected to Bob and Cara');
  check(await waitFor(connected(bob, 2), 'Bob connected to 2 peers'), 'Bob connected to Alice and Cara');
  check(await waitFor(connected(cara, 2), 'Cara connected to 2 peers'), 'Cara connected to Alice and Bob');

  // Chat reaches everyone, in order.
  await alice.fill('#chat-input', 'hello from Alice');
  await alice.press('#chat-input', 'Enter');
  await bob.fill('#chat-input', 'hi Alice');
  await bob.press('#chat-input', 'Enter');
  for (const [page, who] of [[alice, 'Alice'], [bob, 'Bob'], [cara, 'Cara']]) {
    const ok = await waitFor(async () => {
      const t = await page.locator('#chat-log').innerText();
      return t.includes('hello from Alice') && t.includes('hi Alice') && t.indexOf('hello from Alice') < t.indexOf('hi Alice');
    }, `${who} sees both chat lines`);
    check(ok, `${who} sees both chat lines in order`);
  }

  // Movement: Alice walks right for a moment; Bob and Cara see her move.
  const pos = (page) => page.evaluate(() => window.__hubbub.positions());
  const before = await pos(bob);
  const aliceId = Object.keys(before.remotes).find((id) => before.remotes[id].seen);
  check(!!aliceId && Object.keys(before.remotes).length === 2, 'Bob has two remote avatars');
  await alice.locator('#chat-input').blur();
  await alice.keyboard.down('d');
  await new Promise((r) => setTimeout(r, 1200));
  await alice.keyboard.up('d');
  const aliceNow = (await pos(alice)).me;
  for (const [page, who] of [[bob, 'Bob'], [cara, 'Cara']]) {
    const ok = await waitFor(async () => {
      const p = await pos(page);
      return Object.values(p.remotes).some((r) => r.seen && Math.abs(r.x - aliceNow.x) < 6 && Math.abs(r.y - aliceNow.y) < 6);
    }, `${who} sees Alice at her new position`);
    check(ok, `${who} sees Alice at her new position (${Math.round(aliceNow.x)}, ${Math.round(aliceNow.y)})`);
  }

  // Typing in the chat box must not move the character.
  const typedBefore = (await pos(bob)).me;
  await bob.click('#chat-input');
  await bob.keyboard.type('wasd wasd');
  const typedAfter = (await pos(bob)).me;
  check(typedBefore.x === typedAfter.x && typedBefore.y === typedAfter.y, 'typing WASD in chat does not move the player');

  // Leaving is noticed.
  await cara.close();
  check(
    await waitFor(async () => (await alice.locator('#roster li').count()) === 2, 'Alice sees Cara leave'),
    'Alice sees Cara leave',
  );
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
