import { lookColor } from './avatar/look';
import { GameController } from './game/GameController';
import type { Renderer } from './game/renderer';
import { usableView, webglAvailable } from './game/view';
import { Session } from './net/session';
import { Hud } from './ui/hud';
import { initJoin } from './ui/join';

const credits = document.getElementById('credits')!;
document.getElementById('open-credits')!.addEventListener('click', (e) => {
  e.preventDefault();
  credits.classList.add('open');
});
document.getElementById('close-credits')!.addEventListener('click', () => credits.classList.remove('open'));

initJoin(async ({ name, look, code, view }) => {
  const session = await Session.join({ code, name, color: lookColor(look), look });
  history.replaceState(null, '', `#${code}`);
  window.addEventListener('pagehide', () => session.leave());

  const hud = new Hud(code);
  const actual = usableView(view, webglAvailable());
  // Only the renderer in use is downloaded.
  const renderer: Renderer =
    actual === '3d' ? new (await import('./game/three/ThreeRenderer')).ThreeRenderer() : new (await import('./game/phaser/PhaserRenderer')).PhaserRenderer();
  if (actual !== view) hud.system('Your browser cannot show the 3D view, so you are in the 2D view.');
  await new GameController(session, hud, renderer).start();
});
