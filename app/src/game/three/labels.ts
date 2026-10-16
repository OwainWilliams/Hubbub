import * as THREE from 'three';

/** Canvas pixels per world unit for name tags and bubbles. */
const PPU = 110;

function sprite(canvas: HTMLCanvasElement, anchorY: number): THREE.Sprite {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.center.set(0.5, anchorY);
  s.scale.set(canvas.width / PPU, canvas.height / PPU, 1);
  s.renderOrder = 20;
  return s;
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return [c, c.getContext('2d')!];
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** A name tag that always faces the camera. */
export function nameTag(text: string): THREE.Sprite {
  const [probe, pctx] = canvasOf(10, 10);
  pctx.font = `600 30px ${FONT}`;
  const w = pctx.measureText(text).width + 24;
  void probe;
  const [c, ctx] = canvasOf(w, 46);
  ctx.font = `600 30px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#14181f';
  ctx.strokeText(text, c.width / 2, c.height / 2 + 1);
  ctx.fillStyle = '#e8dcc0';
  ctx.fillText(text, c.width / 2, c.height / 2 + 1);
  return sprite(c, 0.5);
}

/** Splits text into lines no wider than `maxWidth` pixels. Exported for testing with a fake measurer. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const trial = line ? `${line} ${word}` : word;
    if (measure(trial) <= maxWidth || !line) {
      // A single word wider than the line is cut into pieces so it cannot overflow the bubble.
      if (!line && measure(word) > maxWidth) {
        let piece = '';
        for (const ch of word) {
          if (measure(piece + ch) > maxWidth && piece) {
            lines.push(piece);
            piece = '';
          }
          piece += ch;
        }
        line = piece;
      } else {
        line = trial;
      }
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 6);
}

/** A speech bubble whose tail points down at the speaker. Anchored by the tip of its tail. */
export function speechBubble(text: string): THREE.Sprite {
  const [probe, pctx] = canvasOf(10, 10);
  pctx.font = `500 26px ${FONT}`;
  void probe;
  const lines = wrapText(text, 320, (s) => pctx.measureText(s).width);
  const widest = Math.max(...lines.map((l) => pctx.measureText(l).width));
  const pad = 14;
  const lineH = 32;
  const tail = 14;
  const bw = widest + pad * 2;
  const bh = lines.length * lineH + pad * 2 - 6;
  const [c, ctx] = canvasOf(bw + 4, bh + tail + 4);
  ctx.fillStyle = '#e8dcc0';
  ctx.strokeStyle = '#14181f';
  ctx.lineWidth = 3;
  const x = 2;
  const y = 2;
  const r = 12;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + bw, y, x + bw, y + bh, r);
  ctx.arcTo(x + bw, y + bh, x, y + bh, r);
  ctx.lineTo(x + bw / 2 + 10, y + bh);
  ctx.lineTo(x + bw / 2, y + bh + tail);
  ctx.lineTo(x + bw / 2 - 10, y + bh);
  ctx.arcTo(x, y + bh, x, y, r);
  ctx.arcTo(x, y, x + bw, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#14181f';
  ctx.font = `500 26px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x + bw / 2, y + pad + lineH * i + lineH / 2 - 3));
  return sprite(c, 0);
}

/** A texture with centred text, used on the wall screen when nobody is sharing. */
export function screenTextTexture(text: string): THREE.CanvasTexture {
  const [c, ctx] = canvasOf(640, 360);
  ctx.fillStyle = '#10161d';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#243040';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, c.width - 20, c.height - 20);
  ctx.fillStyle = '#4a5c70';
  ctx.font = `500 38px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
