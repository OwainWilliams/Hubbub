// Checks the server-side limits: the 13th person is turned away, and an unknown origin is refused.
// Needs the Worker running locally (npm run dev in worker/) and the app dev server (for a page with a
// trusted origin).
import { chromium } from 'playwright-core';

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const WORKER = process.env.WORKER_URL ?? 'http://localhost:8787';
const ROOM = `LIMIT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true });
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(APP_URL);

  const result = await page.evaluate(
    async ({ worker, room }) => {
      const url = `${worker.replace(/^http/, 'ws')}/room/${room}`;
      const open = (n) =>
        new Promise((resolve) => {
          const ws = new WebSocket(url);
          ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'hello', name: `P${n}`, color: '#d9a441' }));
          };
          ws.onmessage = (e) => {
            const m = JSON.parse(e.data);
            if (m.type === 'welcome') resolve({ ws, welcomed: true });
          };
          ws.onclose = (e) => resolve({ ws, welcomed: false, code: e.code });
        });
      const sockets = [];
      for (let i = 0; i < 12; i++) sockets.push(await open(i));
      const thirteenth = await open(12);
      const welcomed = sockets.filter((s) => s.welcomed).length;
      sockets.forEach((s) => s.ws.close());
      return { welcomed, thirteenth: { welcomed: thirteenth.welcomed, code: thirteenth.code } };
    },
    { worker: WORKER, room: ROOM },
  );
  check(result.welcomed === 12, '12 people are welcomed');
  check(!result.thirteenth.welcomed && result.thirteenth.code === 4001, 'the 13th is closed with code 4001 (room full)');

  // A browser page on another origin must be refused. Load a blank page on a different origin and try.
  const other = await (await browser.newContext()).newPage();
  await other.route('https://untrusted.example/', (r) => r.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await other.goto('https://untrusted.example/');
  const refused = await other.evaluate(
    (worker) =>
      new Promise((resolve) => {
        const ws = new WebSocket(`${worker.replace(/^http/, 'ws')}/room/REFUSED-TEST`);
        ws.onopen = () => resolve(false);
        ws.onerror = () => resolve(true);
        ws.onclose = () => resolve(true);
      }),
    WORKER,
  );
  check(refused, 'a page on an unknown origin cannot open a room socket');
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
