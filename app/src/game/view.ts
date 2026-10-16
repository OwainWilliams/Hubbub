export type View = '2d' | '3d';

/** True if this browser can make a WebGL context, which the 3D view needs. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function isView(v: unknown): v is View {
  return v === '2d' || v === '3d';
}

/**
 * Which view to start in: a `?view=2d` or `?view=3d` in the address wins, then what the person chose last
 * time, then 3D on computers and 2D on phones and tablets (lighter on batteries and small screens).
 */
export function initialView(search: string, stored: string | null, coarsePointer: boolean): View {
  const fromUrl = new URLSearchParams(search).get('view');
  if (isView(fromUrl)) return fromUrl;
  if (isView(stored)) return stored;
  return coarsePointer ? '2d' : '3d';
}

/** The view to actually use: 3D quietly becomes 2D when WebGL is missing. */
export function usableView(wanted: View, webgl: boolean): View {
  return wanted === '3d' && !webgl ? '2d' : wanted;
}
