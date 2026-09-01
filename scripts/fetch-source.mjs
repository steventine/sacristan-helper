// Downloads the US Lectionary index tables that data/lectionary.json is built
// from. They are not committed - the repo keeps only the derived citations and
// Lectionary numbers, not copies of the source pages.
//
// You only need this when rebuilding the lectionary table:
//   npm run fetch-source && npm run lectionary
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'https://catholic-resources.org/Lectionary/';
const PAGES = ['Index-Weekdays.htm', 'Index-Sundays.htm'];
const UA = 'Mozilla/5.0 (compatible; sacristan-helper/1.0; +https://github.com/)';
const DELAY_MS = 3000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync('data/source', { recursive: true });

for (const [i, page] of PAGES.entries()) {
  const url = BASE + page;
  process.stdout.write('fetching ' + url + ' ... ');
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) {
    console.log('FAILED ' + res.status);
    process.exit(1);
  }
  // The pages are Windows-1252; keep the bytes verbatim and let the parser decode.
  const buf = Buffer.from(await res.arrayBuffer());
  const out = 'data/source/' + page.replace(/\.htm$/, '.html');
  writeFileSync(out, buf);
  console.log(buf.length + ' bytes -> ' + out);
  if (i < PAGES.length - 1) await wait(DELAY_MS);
}

console.log('\nNow run: npm run lectionary');
