import * as THREE from 'three';
import { ROBE_COLORS, SKIN_COLORS, type Look } from '../../avatar/look';

/**
 * The 3D version of a look: a small robed figure built from simple solids, using the same choices (kind, hat,
 * robe, skin, extra) as the 2D picture. This file is the 3D counterpart of avatar/svg.ts and, like it, is
 * where real character models would plug in later.
 */

export interface AvatarModel {
  /** Stand it on the ground at the origin, facing +z (south). */
  group: THREE.Group;
  /** Pivot at the shoulder, so rotating them swings the arm. */
  arms: [THREE.Group, THREE.Group];
  /** The part that bobs up and down while walking. */
  body: THREE.Group;
  /** Height of the top of the head or hat, for placing labels. */
  height: number;
}

const INK = 0x14181f;

/** Overall size of each kind: [width, height, depth] multipliers. */
const KIND_SCALE: Array<[number, number, number]> = [
  [1, 1, 1], // human
  [1.15, 0.8, 1.15], // dwarf: short and wide
  [1.2, 1.12, 1.2], // troll: big
];

export function buildAvatarModel(look: Look): AvatarModel {
  const robe = new THREE.Color(ROBE_COLORS[look.robe]);
  const skin = new THREE.Color(SKIN_COLORS[look.skin]);
  const mat = (c: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const robeMat = mat(robe);
  const skinMat = mat(skin);
  const inkMat = mat(INK);

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  const troll = look.kind === 2;
  const headR = troll ? 0.29 : 0.24;
  const headY = 1.22;

  // Robe, belt and head.
  add(body, new THREE.CylinderGeometry(0.2, 0.42, 1.0, 10), robeMat, 0, 0.5, 0);
  add(body, new THREE.CylinderGeometry(0.29, 0.3, 0.08, 10), mat(robe.clone().multiplyScalar(0.6)), 0, 0.72, 0);
  add(body, new THREE.SphereGeometry(headR, 12, 9), skinMat, 0, headY, 0);
  for (const sx of [-1, 1]) add(body, new THREE.SphereGeometry(0.035, 6, 5), inkMat, sx * 0.09, headY + 0.04, headR - 0.02);
  if (troll) {
    add(body, new THREE.BoxGeometry(0.36, 0.06, 0.1), skinMat, 0, headY + 0.12, headR - 0.05);
    for (const sx of [-1, 1]) add(body, new THREE.ConeGeometry(0.035, 0.12, 5), mat(0xe8dcc0), sx * 0.1, headY - 0.14, headR - 0.04).rotation.x = Math.PI;
  }

  // Arms hang from the shoulders and swing when walking.
  const arms: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  arms.forEach((arm, i) => {
    arm.position.set(i === 0 ? -0.32 : 0.32, 0.96, 0);
    add(arm, new THREE.CylinderGeometry(0.07, 0.085, 0.5, 6), robeMat, 0, -0.25, 0);
    add(arm, new THREE.SphereGeometry(0.075, 6, 5), skinMat, 0, -0.52, 0);
    body.add(arm);
  });

  // Hat.
  let top = headY + headR;
  if (look.hat === 0) {
    add(body, new THREE.CylinderGeometry(0.42, 0.42, 0.04, 12), robeMat, 0, headY + 0.17, 0);
    const cone = add(body, new THREE.ConeGeometry(0.3, 0.85, 10), robeMat, 0, headY + 0.6, 0);
    cone.rotation.z = -0.12;
    add(body, new THREE.SphereGeometry(0.045, 6, 5), mat(0xf2d66b), 0.02, headY + 0.52, 0.28);
    top = headY + 1.05;
  } else if (look.hat === 1) {
    add(body, new THREE.CylinderGeometry(0.36, 0.36, 0.04, 12), mat(0x2b2b33), 0, headY + 0.17, 0);
    const dome = add(body, new THREE.SphereGeometry(0.25, 10, 8), mat(0x2b2b33), 0, headY + 0.2, 0);
    dome.scale.y = 0.85;
    top = headY + 0.45;
  } else if (look.hat === 2) {
    add(body, new THREE.SphereGeometry(headR + 0.04, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(0x8f9aa3), 0, headY + 0.02, 0);
    add(body, new THREE.BoxGeometry(0.05, 0.2, 0.04), mat(0x8f9aa3), 0, headY + 0.02, headR + 0.03);
    top = headY + headR + 0.08;
  }

  // Extras.
  if (look.extra === 1) {
    const beard = add(body, new THREE.ConeGeometry(0.17, 0.5, 8), mat(0xb5651d), 0, headY - 0.3, headR - 0.1);
    beard.rotation.x = Math.PI;
  } else if (look.extra === 2) {
    for (const sx of [-1, 1]) {
      const ring = add(body, new THREE.TorusGeometry(0.07, 0.013, 5, 12), inkMat, sx * 0.09, headY + 0.04, headR + 0.005);
      ring.rotation.y = 0;
    }
    add(body, new THREE.BoxGeometry(0.06, 0.012, 0.012), inkMat, 0, headY + 0.045, headR + 0.005);
  }

  const [sx, sy, sz] = KIND_SCALE[look.kind] ?? KIND_SCALE[0];
  group.scale.set(sx, sy, sz);
  return { group, arms, body, height: top * sy };
}

/** Frees the geometry and materials of anything built here. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh | THREE.Sprite;
    const geometry = (m as THREE.Mesh).geometry;
    geometry?.dispose();
    const material = (m as THREE.Mesh).material;
    for (const mt of Array.isArray(material) ? material : material ? [material] : []) {
      (mt as THREE.MeshBasicMaterial).map?.dispose();
      mt.dispose();
    }
  });
}
