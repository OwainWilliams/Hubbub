import {
  EXTRA_NAMES,
  HAT_NAMES,
  KIND_NAMES,
  ROBE_COLORS,
  ROBE_NAMES,
  SKIN_COLORS,
  SKIN_NAMES,
  randomLook,
  type Look,
} from '../avatar/look';
import { avatarDataUrl } from '../avatar/svg';

interface Row {
  key: keyof Look;
  label: string;
  names: string[];
  /** Colours for swatch rows. Text chips when absent. */
  colors?: string[];
}

const ROWS: Row[] = [
  { key: 'kind', label: 'Kind', names: KIND_NAMES },
  { key: 'hat', label: 'Hat', names: HAT_NAMES },
  { key: 'robe', label: 'Robe', names: ROBE_NAMES, colors: ROBE_COLORS },
  { key: 'skin', label: 'Skin', names: SKIN_NAMES, colors: SKIN_COLORS },
  { key: 'extra', label: 'Extra', names: EXTRA_NAMES },
];

/** The avatar builder on the join screen: a live preview and one row of choices per part. */
export function mountAvatarPicker(root: HTMLElement, initial: Look, onChange: (l: Look) => void): { get(): Look } {
  let look = { ...initial };

  const preview = document.createElement('img');
  preview.className = 'avatar-preview';
  preview.alt = 'Preview of your avatar';
  preview.width = 120;
  preview.height = 160;

  const controls = document.createElement('div');
  controls.className = 'avatar-controls';
  root.replaceChildren(preview, controls);

  const render = () => {
    preview.src = avatarDataUrl(look);
    controls.replaceChildren(
      ...ROWS.map((row) => {
        const wrap = document.createElement('div');
        wrap.className = 'avatar-row';
        const label = document.createElement('span');
        label.textContent = row.label;
        const options = document.createElement('div');
        options.className = 'avatar-options';
        row.names.forEach((name, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('aria-pressed', String(look[row.key] === i));
          if (row.colors) {
            b.className = 'sw';
            b.style.background = row.colors[i];
            b.setAttribute('aria-label', `${row.label}: ${name}`);
            b.title = name;
          } else {
            b.className = 'chip';
            b.textContent = name;
          }
          b.onclick = () => {
            look = { ...look, [row.key]: i };
            onChange(look);
            render();
          };
          options.append(b);
        });
        wrap.append(label, options);
        return wrap;
      }),
      surprise(),
    );
  };

  const surprise = () => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = 'Surprise me';
    b.onclick = () => {
      look = randomLook();
      onChange(look);
      render();
    };
    return b;
  };

  render();
  return { get: () => look };
}
