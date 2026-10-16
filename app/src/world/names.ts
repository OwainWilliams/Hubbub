const ADJECTIVES = ['Damp', 'Soggy', 'Crusty', 'Wobbly', 'Grumpy', 'Sleepy', 'Dusty', 'Cheeky', 'Mossy', 'Rusty', 'Foggy', 'Lumpy', 'Leaky', 'Squeaky', 'Merry', 'Crooked'];
const NOUNS = ['Lantern', 'Pigeon', 'Cabbage', 'Biscuit', 'Teapot', 'Candle', 'Kettle', 'Barrel', 'Trolley', 'Goblet', 'Clock', 'Ladder', 'Anchor', 'Bucket', 'Whistle', 'Parrot'];

/** "The Damp Lantern" style name from a random source. */
export function buildingName(rnd: () => number): string {
  return `The ${ADJECTIVES[Math.floor(rnd() * ADJECTIVES.length)]} ${NOUNS[Math.floor(rnd() * NOUNS.length)]}`;
}
