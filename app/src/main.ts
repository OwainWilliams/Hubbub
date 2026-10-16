import Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import { Session } from './net/session';
import { Hud } from './ui/hud';
import { initJoin } from './ui/join';

const credits = document.getElementById('credits')!;
document.getElementById('open-credits')!.addEventListener('click', (e) => {
  e.preventDefault();
  credits.classList.add('open');
});
document.getElementById('close-credits')!.addEventListener('click', () => credits.classList.remove('open'));

initJoin(async ({ name, color, code }) => {
  const session = await Session.join({ code, name, color });
  history.replaceState(null, '', `#${code}`);
  window.addEventListener('pagehide', () => session.leave());

  const hud = new Hud(code);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#14181f',
    pixelArt: true,
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [],
  });
  game.scene.add('game', GameScene, true, { session, hud });
});
