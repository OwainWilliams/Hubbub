import Phaser from 'phaser';
import { CHUNK, T, TILE, type Building, type Chunk } from '../../world/generate';
import { I, type Interior } from '../../world/interior';

/**
 * Placeholder art, drawn from rectangles and circles. This is the only file that knows how the town looks,
 * so a Kenney tileset can replace it later without touching world generation or game logic: keep the two
 * exported functions and what they return.
 */

const GRASS = 0x4f6b4f;
const STREET = 0x5a5148;
const STREET_DOT = 0x6a6056;
const PLAZA = 0x7a7060;
const PATH = 0x8a7a62;
const WALLS = [0x7a5a48, 0x6c6a5c, 0x5d6b73, 0x8a6552];
const ROOFS = [0x6b3f36, 0x3b4656, 0x5a4a3a, 0x4a5a3e];
const INK = 0x14181f;

const BASE_BY_CHUNK: Record<Chunk['type'], number> = { houses: GRASS, park: GRASS, plaza: PLAZA, market: PLAZA };
const FAR_BELOW = -1e9;
const FAR_ABOVE = 1e9;

export interface ChunkArt {
  destroy(): void;
}

export function drawChunk(scene: Phaser.Scene, chunk: Chunk): ChunkArt {
  const ox = chunk.cx * CHUNK * TILE;
  const oy = chunk.cy * CHUNK * TILE;
  const size = CHUNK * TILE;
  // Drawn once into a texture, so the cost of ~1000 tiles is paid on load, not every frame.
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const base = BASE_BY_CHUNK[chunk.type];
  const texts: Phaser.GameObjects.Text[] = [];

  for (let ty = 0; ty < CHUNK; ty++) {
    for (let tx = 0; tx < CHUNK; tx++) {
      const t = chunk.tiles[ty * CHUNK + tx];
      const x = tx * TILE;
      const y = ty * TILE;
      let ground = base;
      if (t === T.STREET) ground = STREET;
      else if (t === T.PATH) ground = PATH;
      else if (t === T.PLAZA) ground = PLAZA;
      else if (t === T.GRASS) ground = GRASS;
      g.fillStyle(ground).fillRect(x, y, TILE, TILE);
      if (t === T.STREET && (tx * 7 + ty * 13) % 5 === 0) g.fillStyle(STREET_DOT).fillRect(x + 8, y + 10, 10, 6);
      drawProp(g, t, x, y);
    }
  }

  for (const b of chunk.buildings) drawBuilding(scene, g, b, ox, oy, texts);

  // Lamp glow goes on last so the tiles drawn after a lamp do not paint over it.
  for (let ty = 0; ty < CHUNK; ty++) {
    for (let tx = 0; tx < CHUNK; tx++) {
      if (chunk.tiles[ty * CHUNK + tx] === T.LAMP) g.fillStyle(0xf2d66b, 0.12).fillCircle(tx * TILE + TILE / 2, ty * TILE + TILE / 2 - 6, 34);
    }
  }

  const key = `chunk:${chunk.cx},${chunk.cy}`;
  if (scene.textures.exists(key)) scene.textures.remove(key);
  g.generateTexture(key, size, size);
  g.destroy();
  const image = scene.add.image(ox, oy, key).setOrigin(0).setDepth(FAR_BELOW);

  return {
    destroy() {
      image.destroy();
      scene.textures.remove(key);
      for (const t of texts) t.destroy();
    },
  };
}

function drawProp(g: Phaser.GameObjects.Graphics, t: number, x: number, y: number): void {
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;
  switch (t) {
    case T.TREE:
      g.fillStyle(0x4a3a2a).fillRect(cx - 3, cy + 2, 6, 12);
      g.fillStyle(0x3a5a3a).fillCircle(cx, cy - 2, 13).lineStyle(2, INK).strokeCircle(cx, cy - 2, 13);
      break;
    case T.LAMP:
      g.fillStyle(INK).fillRect(cx - 2, cy - 2, 4, 16);
      g.fillStyle(0xf2d66b).fillCircle(cx, cy - 6, 6).lineStyle(2, INK).strokeCircle(cx, cy - 6, 6);
      break;
    case T.BENCH:
      g.fillStyle(0x6b4a36).fillRect(x + 2, y + 10, TILE - 4, 12).lineStyle(2, INK).strokeRect(x + 2, y + 10, TILE - 4, 12);
      break;
    case T.FOUNTAIN:
      g.fillStyle(0x3d5a73).fillRect(x, y, TILE, TILE);
      g.fillStyle(0x6a8fb0, 0.5).fillCircle(cx, cy, 8);
      break;
    case T.STALL: {
      const stripe = ((x / TILE + y / TILE) | 0) % 2 === 0 ? 0xa9573b : 0xe8dcc0;
      g.fillStyle(stripe).fillRect(x, y, TILE, TILE).lineStyle(1, INK).strokeRect(x, y, TILE, TILE);
      break;
    }
  }
}

function drawBuilding(
  scene: Phaser.Scene,
  g: Phaser.GameObjects.Graphics,
  b: Building,
  ox: number,
  oy: number,
  texts: Phaser.GameObjects.Text[],
): void {
  const x = b.x * TILE - ox;
  const y = b.y * TILE - oy;
  const w = b.w * TILE;
  const h = b.h * TILE;
  const roofH = Math.round(h * 0.4);

  g.fillStyle(WALLS[b.style]).fillRect(x, y, w, h);
  g.fillStyle(ROOFS[b.style]).fillRect(x - 4, y - 6, w + 8, roofH + 6);
  g.lineStyle(3, INK).strokeRect(x, y, w, h).strokeRect(x - 4, y - 6, w + 8, roofH + 6);

  // Windows along the wall below the roof.
  const wallTop = y + roofH + 10;
  for (let wx = x + 20; wx < x + w - 30; wx += 44) {
    const lit = ((wx + b.x) | 0) % 3 !== 0;
    g.fillStyle(lit ? 0xf2d66b : 0x1a222c).fillRect(wx, wallTop, 18, 22).lineStyle(2, INK).strokeRect(wx, wallTop, 18, 22);
  }

  const dx = b.doorX * TILE - ox;
  const dy = b.doorY * TILE - oy;
  if (b.enterable) {
    g.fillStyle(0x3a2a20).fillRect(dx + 3, dy + 4, TILE * 2 - 6, TILE - 4).lineStyle(2, INK).strokeRect(dx + 3, dy + 4, TILE * 2 - 6, TILE - 4);
    g.lineStyle(2, INK).lineBetween(dx + TILE, dy + 4, dx + TILE, dy + TILE);
    g.fillStyle(0xd9a441).fillCircle(dx + TILE - 6, dy + TILE / 2 + 4, 2).fillCircle(dx + TILE + 6, dy + TILE / 2 + 4, 2);
    const label = scene.add
      .text(ox + x + w / 2, oy + y - 16, b.name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#e8dcc0',
        stroke: '#14181f',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(FAR_ABOVE);
    texts.push(label);
  }
}

export interface InteriorArt extends ChunkArt {
  /** The wall screen in room pixels, where shared screens get drawn. */
  screenRect: { x: number; y: number; w: number; h: number };
  /** Text on the dark screen, or null to hide it (when a picture is showing). */
  setScreenText(text: string | null): void;
}

export function drawInterior(scene: Phaser.Scene, room: Interior): InteriorArt {
  const g = scene.add.graphics().setDepth(FAR_BELOW);
  const FLOOR_A = 0x7a5a44;
  const FLOOR_B = 0x6f513c;
  const WALL_FACE = 0x4a3a30;

  for (let ty = 0; ty < room.h; ty++) {
    for (let tx = 0; tx < room.w; tx++) {
      const t = room.tiles[ty * room.w + tx];
      const x = tx * TILE;
      const y = ty * TILE;
      if (t === I.WALL || t === I.SCREEN) {
        g.fillStyle(ty < 2 ? WALL_FACE : 0x3a2c24).fillRect(x, y, TILE, TILE);
        if (ty < 2) g.lineStyle(1, INK, 0.5).strokeRect(x, y, TILE, TILE);
        continue;
      }
      g.fillStyle((tx + ty) % 2 === 0 ? FLOOR_A : FLOOR_B).fillRect(x, y, TILE, TILE);
      g.lineStyle(1, INK, 0.25).strokeRect(x, y, TILE, TILE);
      switch (t) {
        case I.RUG:
          g.fillStyle(0x8c3f3a, 0.85).fillRect(x, y, TILE, TILE);
          break;
        case I.DOOR:
          g.fillStyle(0x3a2a20).fillRect(x, y, TILE, TILE);
          g.fillStyle(0xe8dcc0, 0.25).fillRect(x, y + TILE - 6, TILE, 6);
          break;
        case I.TABLE:
          g.fillStyle(0x9a7048).fillRect(x, y, TILE, TILE).lineStyle(2, INK).strokeRect(x, y, TILE, TILE);
          break;
        case I.BAR:
          g.fillStyle(0x5b3b28).fillRect(x, y, TILE, TILE).lineStyle(2, INK).strokeRect(x, y, TILE, TILE);
          g.fillStyle(0xd9a441, 0.6).fillRect(x + 4, y + 4, TILE - 8, 4);
          break;
        case I.BARREL:
          g.fillStyle(0x6b4a36).fillCircle(x + TILE / 2, y + TILE / 2, 13).lineStyle(2, INK).strokeCircle(x + TILE / 2, y + TILE / 2, 13);
          break;
        case I.SHELF:
          g.fillStyle(0x5b3b28).fillRect(x, y, TILE, TILE).lineStyle(2, INK).strokeRect(x, y, TILE, TILE);
          g.fillStyle([0xa9573b, 0x5f7a5a, 0xd9a441, 0x4f6b86][(tx + ty) % 4]).fillRect(x + 6, y + 6, TILE - 12, 8);
          break;
      }
    }
  }

  const sr = { x: room.screen.x * TILE, y: room.screen.y * TILE, w: room.screen.w * TILE, h: room.screen.h * TILE };
  g.fillStyle(INK).fillRect(sr.x - 4, sr.y + 2, sr.w + 8, sr.h - 2);
  g.fillStyle(0x1a222c).fillRect(sr.x, sr.y + 6, sr.w, sr.h - 10);
  const label = scene.add
    .text(sr.x + sr.w / 2, sr.y + sr.h / 2 + 1, 'No one is sharing', { fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#3a4a5b' })
    .setOrigin(0.5)
    .setDepth(FAR_BELOW + 1);

  return {
    screenRect: { x: sr.x, y: sr.y + 6, w: sr.w, h: sr.h - 10 },
    setScreenText(text) {
      label.setVisible(text !== null);
      if (text !== null) label.setText(text);
    },
    destroy() {
      g.destroy();
      label.destroy();
    },
  };
}
