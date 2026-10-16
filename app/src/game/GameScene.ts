import Phaser from 'phaser';
import type { Session } from '../net/session';
import type { Hud } from '../ui/hud';
import { PLAYER_RADIUS, WORLD, smoothToward, stepPosition } from './movement';

const SEND_INTERVAL_MS = 66; // about 15 updates per second
const BUBBLE_MS = 6000;

interface Avatar {
  box: Phaser.GameObjects.Container;
  bubble: Phaser.GameObjects.Text;
  bubbleTimer?: Phaser.Time.TimerEvent;
}

interface Remote {
  avatar: Avatar;
  tx: number;
  ty: number;
  seq: number;
  seen: boolean;
}

/** Phase 1 test map: an empty grid. Players are coloured circles with name labels. */
export class GameScene extends Phaser.Scene {
  private session!: Session;
  private hud!: Hud;
  private me!: Avatar;
  private x = 0;
  private y = 0;
  private readonly remotes = new Map<string, Remote>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private lastSent = 0;
  private sentX = NaN;
  private sentY = NaN;

  constructor() {
    super('game');
  }

  init(data: { session: Session; hud: Hud }): void {
    this.session = data.session;
    this.hud = data.hud;
  }

  create(): void {
    this.drawWorld();

    this.x = WORLD.width / 2 + (Math.random() - 0.5) * 240;
    this.y = WORLD.height / 2 + (Math.random() - 0.5) * 240;
    this.me = this.makeAvatar(this.session.self.name, this.session.self.color);
    this.me.box.setPosition(this.x, this.y);

    for (const p of this.session.roster.values()) this.addRemote(p.id, p.name, p.color);

    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height).startFollow(this.me.box, true, 0.12, 0.12);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;

    this.wireSession();
    this.wireHud();
    this.refreshRoster();

    // Test hook: lets automated tests read positions without scraping the canvas.
    (window as unknown as { __hubbub: unknown }).__hubbub = {
      positions: () => ({
        me: { x: this.x, y: this.y },
        remotes: Object.fromEntries([...this.remotes].map(([id, r]) => [id, { x: r.avatar.box.x, y: r.avatar.box.y, seen: r.seen }])),
      }),
    };
  }

  private wireSession(): void {
    const h = this.session.handlers;
    h.peerJoined = (p) => {
      this.addRemote(p.id, p.name, p.color);
      this.hud.system(`${p.name} arrived.`);
      this.refreshRoster();
    };
    h.peerLeft = (id) => {
      const name = this.remotes.get(id)?.avatar.box.getData('name') as string | undefined;
      this.remotes.get(id)?.avatar.box.destroy();
      this.remotes.delete(id);
      if (name) this.hud.system(`${name} left.`);
      this.refreshRoster();
    };
    h.peerState = (id, m) => {
      const r = this.remotes.get(id);
      if (!r || m.s <= r.seq) return; // drop late or duplicate packets
      r.seq = m.s;
      r.tx = m.x;
      r.ty = m.y;
      if (!r.seen) {
        r.seen = true;
        r.avatar.box.setPosition(m.x, m.y).setVisible(true);
      }
    };
    h.chat = (id, text) => {
      const r = this.remotes.get(id);
      if (!r) return;
      this.say(r.avatar, text);
      this.hud.chat(this.session.roster.get(id)?.name ?? 'Someone', text, false);
    };
    h.linkChanged = (_id, status) => {
      this.refreshRoster();
      // Tell a newly connected peer where we are right away instead of waiting for us to move.
      if (status === 'connected') this.session.sendState(this.x, this.y);
    };
    h.serverLost = () => this.hud.system('Lost the connection to the server. People already connected still work, but nobody new can join.');
  }

  private wireHud(): void {
    this.hud.onSend = (text) => {
      this.session.sendChat(text);
      this.say(this.me, text);
      this.hud.chat(this.session.self.name, text, true);
    };
    // Typing in the chat box must not walk the character around.
    this.hud.onFocusChange = (focused) => {
      this.input.keyboard!.enabled = focused ? false : true;
      if (focused) this.input.keyboard!.resetKeys();
    };
  }

  private refreshRoster(): void {
    this.hud.setRoster([
      { name: `${this.session.self.name} (you)`, color: this.session.self.color, status: 'connected' },
      ...[...this.session.roster.values()].map((p) => ({ name: p.name, color: p.color, status: p.status })),
    ]);
  }

  private addRemote(id: string, name: string, color: string): void {
    if (this.remotes.has(id)) return;
    const avatar = this.makeAvatar(name, color);
    avatar.box.setVisible(false); // hidden until their first position arrives
    this.remotes.set(id, { avatar, tx: 0, ty: 0, seq: 0, seen: false });
  }

  private drawWorld(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x2a3645).fillRect(0, 0, 64, 64);
    g.lineStyle(1, 0x3a4a5b).strokeRect(0, 0, 64, 64);
    g.generateTexture('grid', 64, 64);
    g.destroy();
    this.add.tileSprite(0, 0, WORLD.width, WORLD.height, 'grid').setOrigin(0);
    this.add.rectangle(0, 0, WORLD.width, WORLD.height).setOrigin(0).setStrokeStyle(6, 0xd9a441);
  }

  private makeAvatar(name: string, color: string): Avatar {
    const body = this.add.circle(0, 0, PLAYER_RADIUS, Phaser.Display.Color.HexStringToColor(color).color).setStrokeStyle(3, 0x14181f);
    const label = this.add
      .text(0, PLAYER_RADIUS + 6, name, { fontFamily: 'system-ui, sans-serif', fontSize: '13px', color: '#e8dcc0', stroke: '#14181f', strokeThickness: 3 })
      .setOrigin(0.5, 0);
    const bubble = this.add
      .text(0, -PLAYER_RADIUS - 10, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#14181f',
        backgroundColor: '#e8dcc0',
        padding: { x: 8, y: 4 },
        wordWrap: { width: 200 },
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setVisible(false);
    const box = this.add.container(0, 0, [body, label, bubble]).setData('name', name);
    return { box, bubble };
  }

  private say(a: Avatar, text: string): void {
    a.bubble.setText(text).setVisible(true);
    a.bubbleTimer?.remove();
    a.bubbleTimer = this.time.delayedCall(BUBBLE_MS, () => a.bubble.setVisible(false));
  }

  update(time: number, delta: number): void {
    const dt = delta / 1000;
    const k = this.keys;
    const dx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const dy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);

    const next = stepPosition(this.x, this.y, dx, dy, dt);
    this.x = next.x;
    this.y = next.y;
    this.me.box.setPosition(this.x, this.y).setDepth(this.y);

    // Send while moving, plus one final update when we stop so others see where we ended up.
    const moved = this.x !== this.sentX || this.y !== this.sentY;
    if (moved && time - this.lastSent >= SEND_INTERVAL_MS) {
      this.session.sendState(this.x, this.y);
      this.sentX = this.x;
      this.sentY = this.y;
      this.lastSent = time;
    }

    for (const r of this.remotes.values()) {
      if (!r.seen) continue;
      const b = r.avatar.box;
      b.setPosition(smoothToward(b.x, r.tx, dt), smoothToward(b.y, r.ty, dt)).setDepth(b.y);
    }
  }
}
