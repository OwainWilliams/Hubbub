import Phaser from 'phaser';
import { BootScene } from './game/BootScene';
import { WORKER_URL } from './net/config';

const credits = document.getElementById('credits')!;
document.getElementById('open-credits')!.addEventListener('click', (e) => {
  e.preventDefault();
  credits.classList.add('open');
});
document.getElementById('close-credits')!.addEventListener('click', () => credits.classList.remove('open'));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#14181f',
  pixelArt: true,
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [BootScene],
});

// Handy while developing: inspect the game and Worker URL from the console.
(window as unknown as { hubbub: unknown }).hubbub = { game, WORKER_URL };
