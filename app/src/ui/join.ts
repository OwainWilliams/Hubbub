import { WORKER_URL } from '../net/config';
import { cleanName, isColor } from '../net/protocol';
import { normaliseRoomCode, randomRoomCode } from '../util/roomCode';

export interface JoinChoice {
  name: string;
  color: string;
  code: string;
}

const COLORS = ['#d9a441', '#5f7a5a', '#a9573b', '#6d4a73', '#4f6b86', '#c46f8a'];

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the app works without it.
  }
}

/** Sets up the join form. `onJoin` should reject with an Error whose message is safe to show. */
export function initJoin(onJoin: (c: JoinChoice) => Promise<void>): void {
  const root = document.getElementById('join')!;
  const form = document.getElementById('join-form') as HTMLFormElement;
  const nameInput = document.getElementById('name') as HTMLInputElement;
  const codeInput = document.getElementById('code') as HTMLInputElement;
  const swatches = document.getElementById('swatches')!;
  const errorEl = document.getElementById('join-error')!;
  const statusEl = document.getElementById('server-status')!;
  const button = document.getElementById('join-button') as HTMLButtonElement;

  nameInput.value = load('hubbub.name') ?? '';
  codeInput.value = location.hash.slice(1) ? decodeURIComponent(location.hash.slice(1)) : '';
  let color = isColor(load('hubbub.color')) ? (load('hubbub.color') as string) : COLORS[0];

  const paint = () => {
    swatches.replaceChildren(
      ...COLORS.map((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sw';
        b.style.background = c;
        b.setAttribute('aria-label', `Colour ${c}`);
        b.setAttribute('aria-pressed', String(c === color));
        b.onclick = () => {
          color = c;
          paint();
        };
        return b;
      }),
    );
  };
  paint();

  fetch(`${WORKER_URL}/health`)
    .then((r) => r.json() as Promise<{ ok?: boolean }>)
    .then((b) => {
      statusEl.textContent = b.ok ? 'Server reachable' : 'Server not reachable';
      statusEl.dataset.ok = String(!!b.ok);
    })
    .catch(() => {
      statusEl.textContent = 'Server not reachable';
      statusEl.dataset.ok = 'false';
    });

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const typed = codeInput.value.trim();
    const code = typed ? normaliseRoomCode(typed) : randomRoomCode();
    if (!code) {
      errorEl.textContent = 'Room codes need 3 to 64 letters, numbers or hyphens.';
      return;
    }
    const name = cleanName(nameInput.value);
    save('hubbub.name', name);
    save('hubbub.color', color);

    button.disabled = true;
    button.textContent = 'Joining…';
    try {
      await onJoin({ name, color, code });
      root.hidden = true;
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Could not join.';
      button.disabled = false;
      button.textContent = 'Join';
    }
  };
}
