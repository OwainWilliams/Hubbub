// Phase 2 with real browsers: the look you build on the join screen is what everyone else sees, and
// it is remembered for next time.
//
//   CHROMIUM=/path/to/chromium SHOTS=/some/dir node avatars.mjs
import { chromium } from 'playwright-core';

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const SHOTS = process.env.SHOTS;
const ROOM = `LOOK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

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
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const hook = (page, fn, ...args) => page.evaluate(([f, a]) => window.__hubbub[f](...a), [fn, args]);

try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const alice = await ctxA.newPage();
  alice.on('pageerror', (e) => console.log('[Alice] page error:', e.message));
  await alice.goto(`${APP_URL}/#${ROOM}`);
  await alice.fill('#name', 'Alice');

  // Build a distinctive look: a dwarf with a helm, plum robe, tan skin and a beard.
  await alice.click('.avatar-row button:has-text("Dwarf")');
  await alice.click('.avatar-row button:has-text("Helm")');
  await alice.click('.avatar-row button[aria-label="Robe: Plum"]');
  await alice.click('.avatar-row button[aria-label="Skin: Tan"]');
  await alice.click('.avatar-row button:has-text("Beard")');
  check((await alice.locator('.avatar-row button[aria-pressed=true]').count()) === 5, 'one choice is selected in each of the five rows');
  const previewSrc = await alice.locator('.avatar-preview').getAttribute('src');
  check(previewSrc.startsWith('data:image/svg+xml') && previewSrc.includes('%236d4a73'), 'the preview updates with the chosen plum robe');
  if (SHOTS) await alice.screenshot({ path: `${SHOTS}/join.png` });
  await alice.click('#join-button');
  await alice.waitForSelector('#room-info');

  const bob = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await bob.goto(`${APP_URL}/#${ROOM}`);
  await bob.fill('#name', 'Bob');
  await bob.click('.avatar-row button:has-text("Troll")');
  await bob.click('.avatar-row button:has-text("Bowler")');
  await bob.click('.avatar-row button:has-text("Spectacles")');
  await bob.click('.avatar-row button[aria-label="Robe: Ochre"]');
  await bob.click('.avatar-row button[aria-label="Skin: Fair"]');
  await bob.click('#join-button');
  await bob.waitForSelector('#room-info');

  const expectAlice = { kind: 1, hat: 2, robe: 3, skin: 1, extra: 1 };
  const expectBob = { kind: 2, hat: 1, robe: 0, skin: 0, extra: 2 };
  check(
    await waitFor(async () => JSON.stringify((await hook(bob, 'avatars')).remotes.Alice?.look) === JSON.stringify(expectAlice), 'Bob sees Alice\'s look'),
    "Bob receives Alice's exact look",
  );
  check(
    await waitFor(async () => JSON.stringify((await hook(alice, 'avatars')).remotes.Bob?.look) === JSON.stringify(expectBob), 'Alice sees Bob\'s look'),
    "Alice receives Bob's exact look",
  );
  check(await waitFor(async () => (await hook(bob, 'avatars')).remotes.Alice?.sprite === true, 'sprite loaded'), "Alice's picture is drawn in Bob's game");
  check(await waitFor(async () => (await hook(alice, 'avatars')).me.sprite === true, 'own sprite'), 'your own picture is drawn too');

  // Put them next to each other for a picture, and make Alice walk so the animation runs.
  await hook(alice, 'teleport', 300, 64);
  await hook(bob, 'teleport', 380, 64);
  await sleep(1000);
  await alice.keyboard.down('d');
  await sleep(250);
  if (SHOTS) await bob.screenshot({ path: `${SHOTS}/avatars.png` });
  await alice.keyboard.up('d');

  // The look is remembered for next visit.
  await alice.reload();
  await alice.waitForSelector('.avatar-preview');
  const remembered = await alice.locator('.avatar-preview').getAttribute('src');
  check(remembered === previewSrc, 'the look is remembered in this browser for next time');
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
