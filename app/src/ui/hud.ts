import type { LinkStatus } from '../net/session';

export interface RosterLine {
  name: string;
  color: string;
  status: LinkStatus;
  /** Where they are, e.g. "in The Damp Lantern". Empty when outdoors. */
  where?: string;
}

const STATUS_LABEL: Record<LinkStatus, string> = {
  connecting: 'connecting…',
  connected: 'connected',
  failed: 'could not connect',
};

/** DOM overlay: room info, roster and chat. Text is always set with textContent, never as HTML. */
export class Hud {
  onSend: (text: string) => void = () => {};
  onMic: () => void = () => {};
  onShare: () => void = () => {};
  onFocusChange: (focused: boolean) => void = () => {};

  private readonly root = document.getElementById('hud')!;
  private readonly log = document.getElementById('chat-log')!;
  private readonly input = document.getElementById('chat-input') as HTMLInputElement;
  private readonly roster = document.getElementById('roster')!;

  constructor(code: string) {
    document.getElementById('room-code')!.textContent = code;

    const copy = document.getElementById('copy-link') as HTMLButtonElement;
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${code}`);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy it from the address bar';
      }
      window.setTimeout(() => (copy.textContent = 'Copy invite link'), 2500);
    };

    (document.getElementById('mic') as HTMLButtonElement).onclick = () => this.onMic();
    (document.getElementById('share') as HTMLButtonElement).onclick = () => this.onShare();
    (document.getElementById('watch') as HTMLButtonElement).onclick = () => this.toggleTheatre();
    (document.getElementById('theatre-close') as HTMLButtonElement).onclick = () => this.closeTheatre();

    const form = document.getElementById('chat-form') as HTMLFormElement;
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (text) this.onSend(text);
      this.input.value = '';
    };
    this.input.onfocus = () => this.onFocusChange(true);
    this.input.onblur = () => this.onFocusChange(false);
    this.input.onkeydown = (e) => {
      if (e.key === 'Escape') this.input.blur();
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && document.activeElement !== this.input && !this.root.hidden) {
        e.preventDefault();
        this.input.focus();
      }
    });

    const rosterBox = document.getElementById('roster-box')!;
    rosterBox.querySelector('h2')!.addEventListener('click', () => rosterBox.classList.toggle('open'));

    this.root.hidden = false;
    this.syncControls();
  }

  /** Hides the controls panel when none of its buttons are showing (phones have no mic or share buttons). */
  private syncControls(): void {
    const panel = document.getElementById('controls')!;
    panel.style.display = '';
    const anyVisible = [...panel.querySelectorAll('button')].some((b) => b.offsetParent !== null);
    panel.style.display = anyVisible ? '' : 'none';
  }

  chat(name: string, text: string, self: boolean): void {
    const row = document.createElement('p');
    const who = document.createElement('span');
    who.className = self ? 'who me' : 'who';
    who.textContent = `${name}: `;
    row.append(who, document.createTextNode(text));
    this.append(row);
  }

  system(text: string): void {
    const row = document.createElement('p');
    row.className = 'sys';
    row.textContent = text;
    this.append(row);
  }

  setRoster(lines: RosterLine[]): void {
    this.roster.replaceChildren(
      ...lines.map((l) => {
        const li = document.createElement('li');
        li.dataset.status = l.status;
        const dot = document.createElement('i');
        dot.style.background = l.color;
        const name = document.createElement('span');
        name.textContent = l.name;
        const status = document.createElement('small');
        status.textContent = l.where ? `${STATUS_LABEL[l.status]} · ${l.where}` : STATUS_LABEL[l.status];
        li.append(dot, name, status);
        return li;
      }),
    );
    document.getElementById('roster-count')!.textContent = `${lines.length} / 12`;
  }

  /** A message pinned to the top of the screen, with an optional button. Replaces any earlier banner. */
  banner(text: string, action?: { label: string; run: () => void }): void {
    const el = document.getElementById('banner')!;
    el.replaceChildren(document.createTextNode(text));
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.onclick = action.run;
      el.append(b);
    }
    el.hidden = false;
  }

  /** The line of help text under the chat box. */
  setHint(text: string): void {
    document.getElementById('hint')!.textContent = text;
  }

  setMic(state: 'off' | 'on' | 'muted'): void {
    const b = document.getElementById('mic') as HTMLButtonElement;
    b.dataset.state = state;
    b.textContent = state === 'off' ? 'Mic off' : state === 'on' ? 'Mic on' : 'Muted';
    b.setAttribute('aria-pressed', String(state === 'on'));
  }

  private theatreStream: MediaStream | null = null;

  /** `inside`: you are in a building and can share. `watching`: the name of whoever is sharing to you. */
  setShare(state: { inside: boolean; sharing: boolean; watching: { name: string; stream: MediaStream } | null }): void {
    const share = document.getElementById('share') as HTMLButtonElement;
    share.hidden = !state.inside;
    share.dataset.state = state.sharing ? 'sharing' : 'off';
    share.textContent = state.sharing ? 'Stop sharing' : 'Share screen';
    const watch = document.getElementById('watch') as HTMLButtonElement;
    watch.hidden = !state.watching;
    if (state.watching) watch.textContent = `Watch ${state.watching.name}'s screen`;
    this.syncControls();
    this.theatreStream = state.watching?.stream ?? null;
    document.getElementById('theatre-title')!.textContent = state.watching ? `${state.watching.name}'s screen` : '';
    const video = document.getElementById('theatre-video') as HTMLVideoElement;
    if (!state.watching) this.closeTheatre();
    else if (!document.getElementById('theatre')!.hidden) video.srcObject = state.watching.stream;
  }

  private toggleTheatre(): void {
    const theatre = document.getElementById('theatre')!;
    if (!theatre.hidden) return this.closeTheatre();
    if (!this.theatreStream) return;
    const video = document.getElementById('theatre-video') as HTMLVideoElement;
    video.srcObject = this.theatreStream;
    void video.play().catch(() => {});
    theatre.hidden = false;
  }

  private closeTheatre(): void {
    (document.getElementById('theatre-video') as HTMLVideoElement).srcObject = null;
    document.getElementById('theatre')!.hidden = true;
  }

  /** Shows where you are, e.g. "Outside, square 0,0" or "Inside The Damp Lantern". */
  setPlace(text: string): void {
    document.getElementById('place')!.textContent = text;
  }

  private append(row: HTMLElement): void {
    this.log.append(row);
    while (this.log.childElementCount > 100) this.log.firstElementChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}
