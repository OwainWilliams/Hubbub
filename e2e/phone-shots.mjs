// Screenshots at phone size with touch emulation, for a quick visual check of the mobile layout.
//   CHROMIUM=/path/to/chromium SHOTS=/some/dir node phone-shots.mjs
import { chromium } from 'playwright-core';
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const SHOTS = process.env.SHOTS ?? '.';
const ROOM = `PHONE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const p = await phone.newPage();
await p.goto(`${APP_URL}/#${ROOM}`);
await p.fill('#name', 'Pip');
await p.screenshot({ path: `${SHOTS}/phone-join.png` });
const canScroll = await p.evaluate(() => { const j = document.getElementById('join'); return j.scrollHeight > j.clientHeight; });
await p.evaluate(() => document.getElementById('join').scrollTo(0, 99999));
await p.screenshot({ path: `${SHOTS}/phone-join-bottom.png` });
console.log('join screen scrolls:', canScroll);
await p.click('#join-button');
await p.waitForSelector('#room-info');
await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: `${SHOTS}/phone-game.png` });
const micHidden = await p.locator('#mic').isHidden();
const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('mic hidden on touch device:', micHidden, '| horizontal overflow:', overflow);
await browser.close();
