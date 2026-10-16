import Phaser from 'phaser';
import { WORKER_URL } from '../net/config';

type Status = 'checking' | 'ok' | 'unreachable';

/** Phase 0 placeholder: proves the app is deployed and can reach the signalling Worker. */
export class BootScene extends Phaser.Scene {
  private title!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super('boot');
  }

  create(): void {
    this.title = this.add
      .text(0, 0, 'Hubbub', { fontFamily: 'Georgia, serif', fontSize: '56px', color: '#d9a441' })
      .setOrigin(0.5);
    this.status = this.add
      .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '18px', color: '#9aa7b2' })
      .setOrigin(0.5);

    this.scale.on('resize', () => this.layout());
    this.layout();
    this.setStatus('checking');
    void this.checkWorker();
  }

  private layout(): void {
    const { width, height } = this.scale;
    this.title.setPosition(width / 2, height / 2 - 20);
    this.status.setPosition(width / 2, height / 2 + 30);
  }

  private setStatus(s: Status): void {
    const text: Record<Status, string> = {
      checking: 'Checking signalling server…',
      ok: 'Signalling server reachable',
      unreachable: 'Signalling server not reachable (set VITE_WORKER_URL)',
    };
    this.status.setText(text[s]).setColor(s === 'ok' ? '#5f7a5a' : s === 'unreachable' ? '#a9573b' : '#9aa7b2');
  }

  private async checkWorker(): Promise<void> {
    try {
      const res = await fetch(`${WORKER_URL}/health`);
      const body = (await res.json()) as { ok?: boolean };
      this.setStatus(body.ok ? 'ok' : 'unreachable');
    } catch {
      this.setStatus('unreachable');
    }
  }
}
