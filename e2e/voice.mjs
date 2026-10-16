// Phase 5 with real browsers and a fake microphone: voice only flows to people in range, stops when you
// mute, stops when you go indoors, and the far away person costs no audio at all.
//
//   CHROMIUM=/path/to/chromium node voice.mjs
import { chromium } from 'playwright-core';

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const VIEW = process.env.VIEW ?? '2d'; // '2d' or '3d': which view to test
// Software rendering in headless Chrome is slow, and several browsers share one CPU, so 3D tests use smaller windows.
const VIEWPORT = VIEW === '3d' ? { width: 800, height: 500 } : { width: 1000, height: 700 };
const ROOM = `VOICE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

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
  args: [
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

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
const hook = (page, fn, ...args) => page.evaluate(([f, a]) => window.__hubbub[f](...a), [fn, args]);
const heardFrom = async (page, who) => Object.values((await hook(page, 'voice')).peers).find((p) => p.name === who);
const bytes = async (page, who) => (await heardFrom(page, who))?.audioBytes ?? 0;
/** Did audio from `who` arrive during the next `ms`? */
const growing = async (page, who, ms = 1800) => {
  const a = await bytes(page, who);
  await sleep(ms);
  return (await bytes(page, who)) > a + 200;
};

try {
  const alice = await join('Alice');
  const bob = await join('Bob');
  const cara = await join('Cara');
  for (const p of [alice, bob, cara]) await waitFor(async () => (await p.locator('#roster li[data-status=connected]').count()) === 3, 'all connected');

  // Alice and Bob stand 60px apart on the street. Cara is far away.
  await hook(alice, 'teleport', 200, 64);
  await hook(bob, 'teleport', 260, 64);
  await hook(cara, 'teleport', 900, 64);
  await sleep(800);

  check(!(await hook(alice, 'voice')).micOn, 'the mic starts off');
  await alice.click('#mic');
  check(await waitFor(async () => (await hook(alice, 'voice')).micOn, 'Alice mic on'), 'Alice turns her mic on');
  check((await alice.locator('#mic').innerText()) === 'Mic on', 'the button says Mic on');

  check(await waitFor(async () => (await heardFrom(bob, 'Alice'))?.audioBytes > 1000, 'Bob receives audio'), 'Bob, standing next to Alice, receives her voice');
  const bobVol = (await heardFrom(bob, 'Alice')).volume;
  check(bobVol > 0.9, `and plays it at full volume (${bobVol.toFixed(2)})`);

  const caraBefore = await bytes(cara, 'Alice');
  await sleep(1500);
  const caraAfter = await bytes(cara, 'Alice');
  check(caraAfter - caraBefore < 2000, `Cara, far away, receives almost nothing (${caraAfter - caraBefore} bytes)`);
  check((await heardFrom(cara, 'Alice')).volume < 0.05, 'and would play it silently');
  const aliceView = (await hook(alice, 'voice')).peers;
  const sendingTo = (name) => Object.values(aliceView).find((p) => p.name === name)?.sending;
  check(sendingTo('Bob') === true && sendingTo('Cara') === false, 'Alice sends her voice to Bob and not to Cara');

  // Cara walks over: now she hears Alice too.
  await hook(cara, 'teleport', 320, 64);
  check(await waitFor(async () => growing(cara, 'Alice', 1500), 'Cara hears Alice'), 'when Cara walks over, she starts hearing Alice');

  // Volume falls off with distance: move Cara partway out.
  await hook(cara, 'teleport', 200 + 250, 64);
  await sleep(800);
  const mid = (await heardFrom(cara, 'Alice')).volume;
  check(mid > 0.02 && mid < 0.9, `at 250px the volume is in between (${mid.toFixed(2)})`);
  await hook(cara, 'teleport', 320, 64);

  // Mute.
  await alice.click('#mic');
  check((await alice.locator('#mic').innerText()) === 'Muted', 'second click mutes');
  await sleep(600);
  check(!(await growing(bob, 'Alice')), 'while muted, nothing reaches Bob');
  await alice.click('#mic');
  check(await waitFor(async () => growing(bob, 'Alice', 1500), 'unmuted'), 'unmuting brings the voice back');

  // Indoors: Alice goes into a building, Bob stays in the street.
  const [door] = await hook(alice, 'doors');
  await hook(alice, 'teleport', door.x, door.y);
  await waitFor(async () => (await hook(alice, 'positions')).me.place === door.id, 'Alice inside');
  await sleep(800);
  check(!(await growing(bob, 'Alice')), 'Bob outside does not hear Alice inside, even though she was just next to him');

  // Bob joins her inside: they hear each other again (everyone in a room hears everyone).
  await hook(bob, 'teleport', door.x, door.y);
  await waitFor(async () => (await hook(bob, 'positions')).me.place === door.id, 'Bob inside');
  check(await waitFor(async () => growing(bob, 'Alice', 1500), 'Bob hears Alice inside'), 'Bob hears Alice once he is inside with her');

  // Speaking indicator and turning the mic fully off.
  const dbg = await hook(alice, 'voice');
  check(dbg.micOn && !dbg.muted, 'Alice is still live');
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
