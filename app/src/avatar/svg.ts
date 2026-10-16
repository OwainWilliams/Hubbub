import { ROBE_COLORS, SKIN_COLORS, type Look } from './look';

/** Size of the drawing. The feet are at the bottom centre, so it stands on the ground at (60, 152). */
export const AVATAR_W = 120;
export const AVATAR_H = 160;

const INK = '#14181f';

/**
 * Placeholder avatar art: a little robed figure drawn from simple shapes. Only fixed colours and numbers go
 * into the string, never anything a person typed, so it is safe to use as an image source.
 */
export function avatarSvg(look: Look): string {
  const robe = ROBE_COLORS[look.robe];
  const skin = SKIN_COLORS[look.skin];
  const dwarf = look.kind === 1;
  const troll = look.kind === 2;
  const headR = troll ? 17 : 13;

  let g = `<ellipse cx="60" cy="152" rx="26" ry="6" fill="#000" opacity=".3"/>`;
  // Dwarves are squat and wide; trolls are broad.
  const body = dwarf ? 'translate(60 152) scale(1.18 .82) translate(-60 -152)' : troll ? 'translate(60 152) scale(1.1 1) translate(-60 -152)' : '';
  g += `<g transform="${body}">`;
  g += `<path d="M36 150 L44 100 L76 100 L84 150Z" fill="${robe}" stroke="${INK}" stroke-width="2.5"/>`;
  g += `<rect x="50" y="112" width="20" height="5" fill="${INK}" opacity=".35"/>`;
  g += `<circle cx="60" cy="86" r="${headR}" fill="${skin}" stroke="${INK}" stroke-width="2.5"/>`;
  g += `<circle cx="55" cy="84" r="2" fill="${INK}"/><circle cx="66" cy="84" r="2" fill="${INK}"/>`;
  if (troll) g += `<path d="M52 94h16" stroke="${INK}" stroke-width="2.5"/>`;

  if (look.extra === 1) g += `<path d="M47 90 Q60 118 73 90 Q60 98 47 90Z" fill="#b5651d" stroke="${INK}" stroke-width="2"/>`;
  if (look.extra === 2) g += `<circle cx="55" cy="84" r="5" fill="none" stroke="${INK}" stroke-width="1.6"/><circle cx="66" cy="84" r="5" fill="none" stroke="${INK}" stroke-width="1.6"/><path d="M60 84h1" stroke="${INK}"/>`;

  if (look.hat === 0) {
    g += `<path d="M38 76 Q60 70 82 76 L66 70 Q62 36 70 10 Q54 28 50 70Z" fill="${robe}" stroke="${INK}" stroke-width="2.5"/>`;
    g += `<path d="M40 77 Q60 66 80 77" fill="none" stroke="${INK}" stroke-width="2.5"/><circle cx="62" cy="52" r="3" fill="#f2d66b"/>`;
  } else if (look.hat === 1) {
    g += `<path d="M47 74 Q47 54 60 54 Q73 54 73 74Z" fill="#2b2b33" stroke="${INK}" stroke-width="2.5"/>`;
    g += `<ellipse cx="60" cy="74" rx="19" ry="4" fill="#2b2b33" stroke="${INK}" stroke-width="2.5"/>`;
  } else if (look.hat === 2) {
    g += `<path d="M45 78 Q45 56 60 56 Q75 56 75 78Z" fill="#8f9aa3" stroke="${INK}" stroke-width="2.5"/><path d="M60 56v12" stroke="${INK}" stroke-width="2.5"/>`;
  }
  g += `</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${AVATAR_W} ${AVATAR_H}" width="${AVATAR_W}" height="${AVATAR_H}">${g}</svg>`;
}

export function avatarDataUrl(look: Look): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(look))}`;
}
