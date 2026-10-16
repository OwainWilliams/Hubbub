import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Builds one mesh out of many simple shapes, each with its own colour baked into the vertices. A whole
 * square of the town (hundreds of props) becomes a handful of draw calls instead of hundreds.
 *
 * Coordinates are in tiles (1 unit = 1 tile = 1 metre-ish). `y0` is the height of the base of a shape.
 */
export class GeoBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  /** Adds an existing geometry, moved and coloured. The geometry is consumed. */
  private push(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, matrix: THREE.Matrix4): void {
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    geo.deleteAttribute('uv');
    geo.applyMatrix4(matrix);
    this.color.set(color);
    const n = geo.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = this.color.r;
      colors[i * 3 + 1] = this.color.g;
      colors[i * 3 + 2] = this.color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(geo);
  }

  /** A box centred at (cx, cz) horizontally, standing on height y0. */
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, color: THREE.ColorRepresentation): this {
    this.push(new THREE.BoxGeometry(w, h, d), color, this.matrix.makeTranslation(cx, y0 + h / 2, cz));
    return this;
  }

  /** A box described by its corners instead of its centre: x from x0 to x1, and so on. */
  span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: THREE.ColorRepresentation): this {
    return this.box((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color);
  }

  cylinder(cx: number, y0: number, cz: number, rTop: number, rBottom: number, h: number, color: THREE.ColorRepresentation, segments = 8): this {
    this.push(new THREE.CylinderGeometry(rTop, rBottom, h, segments), color, this.matrix.makeTranslation(cx, y0 + h / 2, cz));
    return this;
  }

  cone(cx: number, y0: number, cz: number, r: number, h: number, color: THREE.ColorRepresentation, segments = 8): this {
    return this.cylinder(cx, y0, cz, 0, r, h, color, segments);
  }

  sphere(cx: number, cy: number, cz: number, r: number, color: THREE.ColorRepresentation, wSeg = 8, hSeg = 6): this {
    this.push(new THREE.SphereGeometry(r, wSeg, hSeg), color, this.matrix.makeTranslation(cx, cy, cz));
    return this;
  }

  /** A flat disc lying on the ground. */
  disc(cx: number, y: number, cz: number, r: number, color: THREE.ColorRepresentation, segments = 14): this {
    const g = new THREE.CircleGeometry(r, segments);
    g.rotateX(-Math.PI / 2);
    this.push(g, color, this.matrix.makeTranslation(cx, y, cz));
    return this;
  }

  /**
   * A pitched roof with its ridge running along x. `x0..x1` and `z0..z1` are the outer edges at the eaves.
   */
  gable(x0: number, x1: number, z0: number, z1: number, y: number, rise: number, color: THREE.ColorRepresentation): this {
    const zc = (z0 + z1) / 2;
    const yt = y + rise;
    // prettier-ignore
    const v = [
      // south slope
      x0, y, z1,  x1, y, z1,  x1, yt, zc,   x0, y, z1,  x1, yt, zc,  x0, yt, zc,
      // north slope
      x1, y, z0,  x0, y, z0,  x0, yt, zc,   x1, y, z0,  x0, yt, zc,  x1, yt, zc,
      // west end
      x0, y, z0,  x0, y, z1,  x0, yt, zc,
      // east end
      x1, y, z1,  x1, y, z0,  x1, yt, zc,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    this.push(g, color, this.matrix.identity());
    return this;
  }

  /** Merges everything into one geometry, or null if nothing was added. */
  build(): THREE.BufferGeometry | null {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    return merged;
  }
}

/** A tiny deterministic number from two integers, 0 to 1. Used to vary colours and sizes without a random source. */
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Lightens or darkens a colour a little. `amount` of 0.05 is 5% towards white, -0.05 towards black. */
export function shade(hex: number, amount: number): THREE.Color {
  const c = new THREE.Color(hex);
  return amount >= 0 ? c.lerp(new THREE.Color(0xffffff), amount) : c.lerp(new THREE.Color(0x000000), -amount);
}

/** Flat floor made of one square per tile, each with its own colour: a single mesh for a whole square. */
export function tileFloor(cols: number, rows: number, colorOf: (tx: number, ty: number) => THREE.Color, y = 0): THREE.BufferGeometry {
  const pos = new Float32Array(cols * rows * 18);
  const col = new Float32Array(cols * rows * 18);
  const nor = new Float32Array(cols * rows * 18);
  let o = 0;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const c = colorOf(tx, ty);
      const x1 = tx + 1;
      const z1 = ty + 1;
      // two triangles, wound so the face points up
      const tri = [tx, y, ty, tx, y, z1, x1, y, ty, x1, y, ty, tx, y, z1, x1, y, z1];
      for (let i = 0; i < 6; i++) {
        pos.set(tri.slice(i * 3, i * 3 + 3), o);
        col[o] = c.r;
        col[o + 1] = c.g;
        col[o + 2] = c.b;
        nor[o + 1] = 1;
        o += 3;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
