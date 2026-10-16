import type { Look } from '../avatar/look';
import type { Interior } from '../world/interior';
import type { World } from '../world/world';

/**
 * Everything the game logic needs from "the thing that draws". There is a Phaser (2D) and a Three.js (3D)
 * implementation. Positions are always world pixels (32 per tile), the same numbers the network carries, so
 * the game logic, collision, voice and screen sharing do not know which view is in use.
 */

/** The id the renderer uses for the local player's own avatar. */
export const ME = 'me';

/** What the on-wall screen in a building shows. `key` identifies the source so a repeat call changes nothing. */
export type ScreenContent = { kind: 'text'; text: string } | { kind: 'video'; stream: MediaStream; key: string };

/** Called by the renderer. */
export interface RendererHost {
  /** Once per frame. `time` and `deltaMs` are in milliseconds. */
  onFrame(time: number, deltaMs: number): void;
  /** The person clicked or tapped the ground, at this world position. */
  onPointerWalk(x: number, y: number): void;
}

export interface Renderer {
  readonly kind: '2d' | '3d';

  /** Creates the canvas and starts the frame loop. */
  start(host: RendererHost): Promise<void>;

  // ---- places
  /** Shows the town around (x, y), replacing any interior. */
  showOutdoors(world: World, x: number, y: number): void;
  /** Call as the player moves outdoors so squares load and unload. Returns the square they are in. */
  moveOutdoors(x: number, y: number): { cx: number; cy: number };
  loadedChunks(): number;
  /** Shows the inside of a building, replacing the town. */
  showInterior(room: Interior): void;
  /** Sets what the wall screen shows. Does nothing outdoors. */
  setScreen(content: ScreenContent): void;
  /** True while a shared video is on the wall screen. */
  screenShowsVideo(): boolean;

  // ---- people
  addAvatar(id: string, name: string, look: Look): void;
  removeAvatar(id: string): void;
  /** Puts an avatar exactly here, with no gliding. */
  placeAvatar(id: string, x: number, y: number): void;
  /** Called every frame for each visible avatar: where it is, whether it is walking, and which way it moves. */
  animateAvatar(id: string, x: number, y: number, moving: boolean, dirX: number, dirY: number): void;
  setAvatarVisible(id: string, visible: boolean): void;
  avatarVisible(id: string): boolean;
  /** True once the avatar's real picture or model has loaded (until then a stand-in is drawn). */
  avatarReady(id: string): boolean;
  say(id: string, text: string): void;
  setSpeaking(id: string, on: boolean): void;

  // ---- camera and input
  /** Jumps the camera to the player straight away (after entering a building, teleporting, and so on). */
  snapCamera(x: number, y: number): void;
  /**
   * Turns "strafe" and "forward" (each -1, 0 or 1) into a direction in world space. In 2D this is just
   * right and up; in 3D it follows the way the camera is facing.
   */
  inputToWorld(strafe: number, forward: number): { dx: number; dy: number };
}
