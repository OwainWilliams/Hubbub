// Phases 3 and 4 with real browsers: everyone in a room gets the same town, different rooms get different
// towns, buildings can be entered, and what happens inside a building stays inside.
//
//   CHROMIUM=/path/to/chromium SHOTS=/some/dir node world-places.mjs
import { chromium } from 'playwright-core';

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const VIEW = process.env.VIEW ?? '2d'; // '2d' or '3d': which view to test
// Software rendering in headless Chrome is slow, and several browsers share one CPU, so 3D tests use smaller windows.
const VIEWPORT = VIEW === '3d' ? { width: 800, height: 500 } : { width: 1280, height: 720 };
const SHOTS = process.env.SHOTS; // optional folder for screenshots
const tag = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const ROOM = `WORLD-${tag()}`;
const OTHER_ROOM = `OTHER-${tag()}`;

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

async function join(name, room) {
  const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  await page.goto(`${APP_URL}/?view=${VIEW}#${room}`);
  await page.fill('#name', name);
  await page.click('#join-button');
  await page.waitForSelector('#room-info');
  await page.waitForFunction(() => window.__hubbub?.world().loaded > 0);
  return page;
}
const hook = (page, fn, ...args) => page.evaluate(([f, a]) => window.__hubbub[f](...a), [fn, args]);
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const chatText = (page) => page.locator('#chat-log').innerText();
const say = async (page, text) => {
  await page.fill('#chat-input', text);
  await page.press('#chat-input', 'Enter');
  await page.locator('#chat-input').blur();
};

try {
  const alice = await join('Alice', ROOM);
  const bob = await join('Bob', ROOM);
  const dave = await join('Dave', OTHER_ROOM);

  // Phase 3: same room, same town. Different room, different town.
  const [wa, wb, wd] = await Promise.all([hook(alice, 'world'), hook(bob, 'world'), hook(dave, 'world')]);
  check(wa.seed === wb.seed && wa.checksum === wb.checksum, 'Alice and Bob generated the identical starting square');
  check(wa.seed !== wd.seed, 'a different room code gives a different world seed');
  check(wa.loaded >= 9, `the squares around you are loaded (${wa.loaded})`);
  await sleep(500);
  await shot(alice, '1-outdoors');

  // Walk a long way east along the street: the world keeps generating and nothing breaks.
  await hook(alice, 'teleport', 40 * 32 * 32 + 100, 2 * 32);
  await sleep(600);
  const far = await hook(alice, 'world');
  check(far.loaded >= 9, 'far from the start, squares are still generated around you');
  await shot(alice, '2-far-east');
  await hook(alice, 'teleport', 330, 330);
  await sleep(300);

  // Phase 4: enter a building.
  const doors = await hook(alice, 'doors');
  check(doors.length === 4, 'the square next to the spawn has four enterable buildings');
  const door = doors[0];
  // Walk in the way a person would: from the pavement, a little off-centre, holding "up".
  await hook(alice, 'teleport', door.x + 14, door.y + 1.4 * 32);
  await alice.keyboard.down('w');
  const entered = await waitFor(async () => (await hook(alice, 'positions')).me.place === door.id, 'Alice enters the building');
  await alice.keyboard.up('w');
  check(entered, `Alice walked into ${door.name} through the door, off-centre`);
  await sleep(500);
  await shot(alice, '3-inside');
  check((await alice.locator('#place').innerText()).includes(door.name), 'the HUD says which building she is in');

  // Bob is outside, so he cannot see her and the roster says where she is.
  await bob.waitForFunction(() => Object.values(window.__hubbub.positions().remotes).some((r) => r.seen));
  const bobSees = (await hook(bob, 'positions')).remotes;
  check(Object.values(bobSees).every((r) => !r.visible), 'Bob (outside) cannot see Alice (inside)');
  check(
    await waitFor(async () => (await bob.locator('#roster').innerText()).includes(`in ${door.name}`), 'roster shows where Alice is'),
    'Bob\'s roster says Alice is in the building',
  );
  check(
    await waitFor(async () => (await chatText(bob)).includes('went into'), 'Bob is told Alice went in'),
    'Bob is told Alice went into the building',
  );

  // Chat stays inside.
  await say(alice, 'secret meeting notes');
  await say(bob, 'hello from the street');
  await sleep(1500);
  check(!(await chatText(bob)).includes('secret meeting notes'), 'Bob outside does not receive what Alice says inside');
  check(!(await chatText(alice)).includes('hello from the street'), 'Alice inside does not receive what Bob says outside');

  // Bob walks in and they can see and hear each other.
  await hook(bob, 'teleport', door.x, door.y);
  check(
    await waitFor(async () => (await hook(bob, 'positions')).me.place === door.id, 'Bob enters the building'),
    'Bob walked into the same building',
  );
  check(
    await waitFor(async () => Object.values((await hook(alice, 'positions')).remotes).some((r) => r.visible), 'Alice sees Bob'),
    'Alice can now see Bob inside',
  );
  check(
    await waitFor(async () => Object.values((await hook(bob, 'positions')).remotes).some((r) => r.visible), 'Bob sees Alice'),
    'Bob can now see Alice inside',
  );
  await say(alice, 'welcome to the meeting');
  check(await waitFor(async () => (await chatText(bob)).includes('welcome to the meeting'), 'Bob hears Alice inside'), 'chat works between people inside');
  await shot(bob, '4-inside-two');

  // Walls and furniture block you: walk west until something stops you.
  const before = (await hook(alice, 'positions')).me;
  await alice.keyboard.down('a');
  await sleep(2500);
  await alice.keyboard.up('a');
  const after = (await hook(alice, 'positions')).me;
  check(after.x >= 32 && after.place === door.id && after.x < before.x, `Alice walking west is stopped by a wall or furniture (x ${Math.round(before.x)} to ${Math.round(after.x)})`);

  // Leave the way a person would: stand just inside the door, a little off-centre, hold "down".
  const room = await hook(alice, 'room');
  await hook(alice, 'teleport', room.door.x - 14, room.door.y - 1.2 * 32);
  await alice.keyboard.down('s');
  const left = await waitFor(async () => (await hook(alice, 'positions')).me.place === '', 'Alice leaves the building');
  await alice.keyboard.up('s');
  check(left, 'Alice walked out through the door, off-centre');
  const out = (await hook(alice, 'positions')).me;
  check(Math.abs(out.x - door.x) < 40 && out.y > door.y, 'she is standing just outside the door');
  await shot(alice, '5-back-outside');
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
