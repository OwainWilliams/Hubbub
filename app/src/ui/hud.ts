import type { LinkStatus } from '../net/session';

export interface RosterLine {
  name: string;
  color: string;
  status: LinkStatus;
}

const STATUS_LABEL: Record<LinkStatus, string> = {
  connecting: 'connecting…',
  connected: 'connected',
  failed: 'could not connect',
};

/** DOM overlay: room info, roster and chat. Text is always set with textContent, never as HTML. */
export class Hud {
  onSend: (text: string) => void = () => {};
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

    this.root.hidden = false;
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
        status.textContent = STATUS_LABEL[l.status];
        li.append(dot, name, status);
        return li;
      }),
    );
    document.getElementById('roster-count')!.textContent = `${lines.length} / 12`;
  }

  private append(row: HTMLElement): void {
    this.log.append(row);
    while (this.log.childElementCount > 100) this.log.firstElementChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}
