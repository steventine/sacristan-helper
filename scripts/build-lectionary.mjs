// Parses the US Lectionary index tables (catholic-resources.org, Felix Just, S.J.)
// into data/lectionary.json. Source HTML is vendored under data/source/ so the
// build is reproducible without network access.
import { readFileSync, writeFileSync } from 'node:fs';

const CP1252 = { 0x85:'\u2026', 0x91:'\u2018', 0x92:'\u2019', 0x93:'\u201c',
                 0x94:'\u201d', 0x96:'\u2013', 0x97:'\u2014' };
const ENTITIES = { nbsp:' ', amp:'&', lt:'<', gt:'>', quot:'"', apos:"'",
                   rsquo:'\u2019', lsquo:'\u2018', ldquo:'\u201c', rdquo:'\u201d',
                   ndash:'\u2013', mdash:'\u2014', hellip:'\u2026' };

function readCp1252(path) {
  let out = '';
  for (const b of readFileSync(path))
    out += b >= 0x80 && b <= 0x9f ? (CP1252[b] ?? '\ufffd') : String.fromCharCode(b);
  return out;
}

const clean = s => s
  .replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m)
  .replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

const rows = html => [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gis)].map(m =>
  [...m[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gis)].map(c => clean(c[1])));

// Section header cell [0] -> the slot the readings in that section fill.
const SLOT = {
  'Old Testament Readings': 'first',  'Old Testament Reading': 'first',
  'New Testament Readings': 'second', 'New Testament Reading': 'second',
  'Gospel Reading': 'gospel',
  'Responsorial Psalm': null,                       // not needed by the sacristan
};

const push = (bucket, key, slot, entry) =>
  (((bucket[key] ??= {})[slot] ??= []).push(entry));

// ---- Weekday table: [passage, day, year, lec#] -------------------------
const weekdays = {};
{
  let slot = null;
  for (const r of rows(readCp1252('data/source/Index-Weekdays.html'))) {
    if (r.length < 4) continue;
    if (/^Lec\.?\s*#?$/i.test(r[3])) { slot = SLOT[r[0]] ?? null; continue; }
    if (!slot) continue;
    const [passage, day, year, lec] = r;
    if (!passage || !day || day === '.') continue;
    // Weekday "second" readings are really the first reading in NT-cycle weeks.
    const s = slot === 'second' ? 'first' : slot;
    for (const y of (year.includes('+') ? ['1', '2'] : [year.replace(/\D/g, '')])) {
      if (y === '1' || y === '2') push(weekdays, `${day}|${y}`, s, { citation: passage, lectionary: lec });
    }
  }
}

// The Lect# cell is one of: "590", "13-ABC", "572A", or a per-cycle list such
// as "43-A; 44-B; 45-C". Returns [{ lectionary, cycles }].
function parseLect(cell) {
  const out = [];
  for (const part of cell.split(/[;,]/)) {
    const m = part.trim().match(/^(\d+[A-Za-z]?)(?:\s*[-–]\s*([ABC]+))?$/);
    if (!m) continue;
    out.push({ lectionary: m[1], cycles: (m[2] || 'ABC').split('') });
  }
  return out;
}

// ---- Sunday/major-feast table: [passage, "lec#-cycle", day, ...] -------
const sundays = {};
let skipped = 0;
{
  let slot = null;
  for (const r of rows(readCp1252('data/source/Index-Sundays.html'))) {
    if (r.length < 3) continue;
    if (/^Lect\s*#/i.test(r[1])) { slot = SLOT[r[0]] ?? null; continue; }
    if (!slot) continue;
    const [passage, lecCycle, day] = r;
    if (!passage || !day) continue;
    const parsed = parseLect(lecCycle);
    if (!parsed.length) { skipped++; continue; }
    for (const { lectionary, cycles } of parsed)
      for (const cycle of cycles)
        push(sundays, `${day}|${cycle}`, slot, { citation: passage, lectionary });
  }
}
if (skipped) console.warn('WARNING: ' + skipped + ' Sunday rows had an unparseable Lect# cell');

writeFileSync('data/lectionary.json', JSON.stringify({
  source: 'catholic-resources.org/Lectionary (Felix Just, S.J.) - US Lectionary for Mass',
  built: new Date().toISOString().slice(0, 10),
  weekdays, sundays,
}, null, 1));

console.log('weekday keys:', Object.keys(weekdays).length, ' sunday keys:', Object.keys(sundays).length);
for (const k of ['Ord. Time, Week 22, Mon|2', 'Ord. Time, Week 28, Mon|1'])
  console.log(' ', k, '->', JSON.stringify(weekdays[k]));
for (const k of ['22nd Sunday in Ordinary Time|A', 'Nov 1: All Saints|A'])
  console.log(' ', k, '->', JSON.stringify(sundays[k]));
