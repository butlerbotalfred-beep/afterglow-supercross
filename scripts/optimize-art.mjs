// Converts the PNG originals in art-source/ into the WebP textures the game ships in public/art/.
// Each texture keeps its resolution. Run it after adding or changing an original:
//   node scripts/optimize-art.mjs            convert and print the sizes
//   node scripts/optimize-art.mjs --check    fail if a shipped texture is missing
import {existsSync, mkdirSync, statSync} from 'node:fs';
import sharp from 'sharp';

// The textures the game loads, with WebP quality (0 to 100). The sky gets more because its smooth
// gradients show compression first. Originals not listed here (dusk-sky-v2) stay in art-source/ only.
const TEXTURES = [
  {name: 'dusk-sky-v3', quality: 90},
  {name: 'dirt-clay-v2', quality: 82},
  {name: 'crowd-v2', quality: 82},
  {name: 'jersey-height-v1', quality: 82},
];
const source = name => new URL(`../art-source/${name}.png`, import.meta.url).pathname;
const shipped = name => new URL(`../public/art/${name}.webp`, import.meta.url).pathname;

if (process.argv.includes('--check')) {
  const problems = TEXTURES.filter(t => !existsSync(shipped(t.name))).map(t => `${t.name}.webp is missing`);
  if (problems.length) {
    console.error('optimize-art: ' + problems.join('; ') + '. Run node scripts/optimize-art.mjs');
    process.exit(1);
  }
  console.log(`optimize-art: all ${TEXTURES.length} shipped textures are present`);
  process.exit(0);
}

mkdirSync(new URL('../public/art/', import.meta.url), {recursive: true});
let before = 0,
  after = 0;
for (const {name, quality} of TEXTURES) {
  const image = sharp(source(name));
  const {width, height} = await image.metadata();
  await image.webp({quality, effort: 6}).toFile(shipped(name));
  const [from, to] = [statSync(source(name)).size, statSync(shipped(name)).size];
  before += from;
  after += to;
  const mb = n => (n / 1e6).toFixed(2) + ' MB';
  console.log(`${name}: ${width} × ${height}, ${mb(from)} PNG to ${mb(to)} WebP at quality ${quality}`);
}
console.log(`total: ${(before / 1e6).toFixed(2)} MB to ${(after / 1e6).toFixed(2)} MB`);
