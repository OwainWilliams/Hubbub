/**
 * Keyboard state, shared by both views. Reads the window's key events directly, ignoring them while a text box
 * has focus so typing in chat never walks the character.
 */

export interface Axes {
  /** -1 left, 1 right. */
  strafe: number;
  /** -1 back, 1 forward. */
  forward: number;
}

const LEFT = ['a', 'arrowleft'];
const RIGHT = ['d', 'arrowright'];
const FORWARD = ['w', 'arrowup'];
const BACK = ['s', 'arrowdown'];

/** Works out movement from the set of keys currently held (lower case key names). Pure, so it can be tested. */
export function axesFromKeys(down: ReadonlySet<string>): Axes {
  const any = (keys: string[]) => keys.some((k) => down.has(k));
  return { strafe: (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0), forward: (any(FORWARD) ? 1 : 0) - (any(BACK) ? 1 : 0) };
}

function typingInTextBox(): boolean {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

export class Input {
  private readonly down = new Set<string>();
  private readonly cleanups: Array<() => void> = [];

  constructor() {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn);
      this.cleanups.push(() => window.removeEventListener(type, fn));
    };
    on('keydown', (e) => {
      if (typingInTextBox() || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      this.down.add(k);
      // Stop the arrow keys scrolling the page while playing.
      if (k.startsWith('arrow')) e.preventDefault();
    });
    on('keyup', (e) => this.down.delete(e.key.toLowerCase()));
    // Keys released while the window was not focused would otherwise stay "held" forever.
    on('blur', () => this.down.clear());
  }

  axes(): Axes {
    return axesFromKeys(this.down);
  }

  isDown(key: string): boolean {
    return this.down.has(key.toLowerCase());
  }

  /** Forgets every held key (used when a text box takes focus). */
  reset(): void {
    this.down.clear();
  }

  dispose(): void {
    for (const c of this.cleanups) c();
  }
}
