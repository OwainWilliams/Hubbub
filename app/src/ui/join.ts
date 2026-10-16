import { defaultLook, parseLook, randomLook, type Look } from '../avatar/look';
import { initialView, type View } from '../game/view';
import { WORKER_URL } from '../net/config';
import { cleanName } from '../net/protocol';
import { normaliseRoomCode, randomRoomCode } from '../util/roomCode';
import { mountAvatarPicker } from './avatarPicker';

export interface JoinChoice {
  name: string;
  look: Look;
  code: string;
  view: View;
}

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
  const errorEl = document.getElementById('join-error')!;
  const statusEl = document.getElementById('server-status')!;
  const button = document.getElementById('join-button') as HTMLButtonElement;

  nameInput.value = load('hubbub.name') ?? '';
  codeInput.value = location.hash.slice(1) ? decodeURIComponent(location.hash.slice(1)) : '';
  let saved: Look;
  try {
    const raw = load('hubbub.look');
    saved = raw ? parseLook(JSON.parse(raw)) : randomLook();
  } catch {
    saved = defaultLook();
  }
  const picker = mountAvatarPicker(document.getElementById('avatar-picker')!, saved, () => {});

  let view: View = initialView(location.search, load('hubbub.view'), window.matchMedia('(pointer: coarse)').matches);
  const viewBox = document.getElementById('view-picker')!;
  const paintView = () => {
    viewBox.replaceChildren(
      ...(['3d', '2d'] as const).map((v) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = v === '3d' ? '3D' : '2D';
        b.setAttribute('aria-pressed', String(v === view));
        b.onclick = () => {
          view = v;
          paintView();
        };
        return b;
      }),
    );
  };
  paintView();

  // After a dropped server connection the page reloads itself; join again without asking.
  let autoRejoin = false;
  try {
    autoRejoin = sessionStorage.getItem('hubbub.rejoin') === '1';
    sessionStorage.removeItem('hubbub.rejoin'); // once only, so a join that keeps failing cannot loop
  } catch {
    // no storage, no auto rejoin
  }

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
    const look = picker.get();
    save('hubbub.look', JSON.stringify(look));
    save('hubbub.view', view);

    button.disabled = true;
    button.textContent = 'Joining…';
    try {
      await onJoin({ name, look, code, view });
      root.hidden = true;
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Could not join.';
      button.disabled = false;
      button.textContent = 'Join';
    }
  };

  if (autoRejoin && nameInput.value && codeInput.value) form.requestSubmit();
}
