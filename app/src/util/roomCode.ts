const ADJECTIVES = ['DAMP', 'SOGGY', 'CRUSTY', 'WOBBLY', 'GRUMPY', 'SLEEPY', 'DUSTY', 'CHEEKY', 'MOSSY', 'RUSTY', 'FOGGY', 'LUMPY'];
const NOUNS = ['LANTERN', 'PIGEON', 'CABBAGE', 'BISCUIT', 'TEAPOT', 'CANDLE', 'KETTLE', 'BARREL', 'TROLLEY', 'GOBLET', 'CLOCK', 'LADDER'];

const PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

/** Turns what someone typed into a valid room code, or null if it cannot be one (3-64 chars of A-Z, 0-9, hyphen). */
export function normaliseRoomCode(input: string): string | null {
  const code = input
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return code.length >= 3 && code.length <= 64 && PATTERN.test(code) ? code : null;
}

function randomInt(n: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

/** e.g. DAMP-LANTERN-42 */
export function randomRoomCode(rand: (n: number) => number = randomInt): string {
  const adj = ADJECTIVES[rand(ADJECTIVES.length)];
  const noun = NOUNS[rand(NOUNS.length)];
  const num = 10 + rand(90);
  return `${adj}-${noun}-${num}`;
}
