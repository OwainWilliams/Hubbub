import { lookColor } from './avatar/look';
import { GameController } from './game/GameController';
import { PhaserRenderer } from './game/phaser/PhaserRenderer';
import { Session } from './net/session';
import { Hud } from './ui/hud';
import { initJoin } from './ui/join';

const credits = document.getElementById('credits')!;
document.getElementById('open-credits')!.addEventListener('click', (e) => {
  e.preventDefault();
  credits.classList.add('open');
});
document.getElementById('close-credits')!.addEventListener('click', () => credits.classList.remove('open'));

initJoin(async ({ name, look, code }) => {
  const session = await Session.join({ code, name, color: lookColor(look), look });
  history.replaceState(null, '', `#${code}`);
  window.addEventListener('pagehide', () => session.leave());

  const hud = new Hud(code);
  const renderer = new PhaserRenderer();
  await new GameController(session, hud, renderer).start();
});
