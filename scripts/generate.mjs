// Joins the romcal liturgical calendar to the lectionary table and emits
// public/readings.json - the only data file the web app loads.
//
//   node scripts/generate.mjs
//   FIRST_YEAR=2026 LAST_YEAR=2035 node scripts/generate.mjs
//   ASCENSION_ON_SUNDAY=false node scripts/generate.mjs   (provinces keeping Thursday)
import { readFileSync, writeFileSync } from 'node:fs';
import Romcal from 'romcal';

// A rolling twenty-year window from the current year, so every rebuild extends
// the range on its own and the data never quietly runs out.
const FIRST_YEAR = Number(process.env.FIRST_YEAR) || new Date().getFullYear();
const LAST_YEAR = Number(process.env.LAST_YEAR) || FIRST_YEAR + 19;
const ASCENSION_ON_SUNDAY = process.env.ASCENSION_ON_SUNDAY !== 'false';

const lect = JSON.parse(readFileSync('data/lectionary.json', 'utf8'));

const ord = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const DOW = ['Sun', 'Mon', 'Tues', 'Wed', 'Thurs', 'Fri', 'Sat'];
const dowOf = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
const usccbUrl = (iso) => {
  const [y, m, d] = iso.split('-');
  return 'https://bible.usccb.org/bible/readings/' + m + d + y.slice(2) + '.cfm';
};

// ---------------------------------------------------------------- indexes
const MONTHS = { jan: 1, feb: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
                 jul: 7, july: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

// Sanctoral entries in both tables are prefixed with their fixed date, e.g.
// "Sept 21: St. Matthew, Apostle and Evangelist". Index them by month/day so
// feasts resolve by date rather than by a hand-maintained id map.
function indexByDate(bucket) {
  const out = {};
  for (const key of Object.keys(bucket)) {
    const [label, cycle] = key.split('|');
    const m = label.match(/^([A-Za-z]+)\.?\s+(\d{1,2}):\s*(.*)$/);
    if (!m) continue;
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) continue;
    const mmdd = String(month).padStart(2, '0') + '-' + String(+m[2]).padStart(2, '0');
    (out[mmdd] ??= []).push({ label, cycle, rest: m[3], readings: bucket[key] });
  }
  return out;
}
const byDate = { sundays: indexByDate(lect.sundays), weekdays: indexByDate(lect.weekdays) };

// Lower score wins. Vigils and response-only rows are never the day's readings.
function score(cand) {
  const l = cand.label;
  let s = l.length / 100;
  if (/vigil/i.test(l)) s += 100;
  if (/respons/i.test(l)) s += 100;
  if (/\(opt(?:ion)?\.?\s*2|\(opt\.?\s*[B-Z]\b/i.test(l)) s += 10;
  if (/\(opt(?:ion)?\.?\s*(?:1|A)\b/i.test(l)) s += 1;
  return s;
}

// A single celebration's readings are often split across sibling rows -
// "Sept 8: Nativity of the BVMary (option 1)" holds the first reading while
// "Sept 8: Nativity of the BVMary" holds the Gospel. Merge them per slot,
// taking each slot from the best-scoring variant that supplies it.
function feastByDate(iso, cycle, need) {
  const mmdd = iso.slice(5);
  const pool = [...(byDate.sundays[mmdd] || []), ...(byDate.weekdays[mmdd] || [])]
    .filter((c) => !c.cycle || c.cycle === cycle || c.cycle === '1' || c.cycle === 'A')
    .sort((a, b) => score(a) - score(b));
  if (!pool.length) return null;

  const merged = {};
  const sources = [];
  for (const slot of ['first', 'second', 'gospel']) {
    const hit = pool.find((c) => c.readings[slot]);
    if (!hit) continue;
    merged[slot] = hit.readings[slot];
    if (!sources.includes(hit.label)) sources.push(hit.label);
  }
  if (!need.every((slot) => merged[slot])) return null;
  return { key: sources.join(' + '), ...merged };
}

// ------------------------------------------------------- explicit mappings
// Movable celebrations, which carry no fixed date to index on.
const MOVABLE = {
  easter_sunday: 'Easter Sunday: Resurrection of the Lord (opt. 1)',
  divine_mercy_sunday: '2nd Sunday of Easter',
  palm_sunday_of_the_passion_of_the_lord: 'Palm Sunday Mass',
  pentecost_sunday: 'Pentecost Sunday',
  most_holy_trinity: 'Sunday after Pentecost: Holy Trinity',
  most_holy_body_and_blood_of_christ: 'Sunday after Trinity Sun: Body & Blood of Christ',
  our_lord_jesus_christ_king_of_the_universe: '34th Sunday in Ord. Time: Christ the King',
  sunday_of_the_word_of_god: '3rd Sunday in Ordinary Time',
  holy_family_of_jesus_mary_and_joseph: 'Sunday in Octave of Christmas: Holy Family',
  epiphany_of_the_lord: 'The Epiphany of the Lord',
  baptism_of_the_lord: 'Sunday after Epiphany: Baptism of the Lord',
  ascension_of_the_lord: 'Ascension of the Lord',
  easter_monday: 'Easter Octave, Mon',
  monday_after_epiphany: 'Mon after Epiphany, or Jan. 7',
  mary_mother_of_the_church: 'Mon after Pentecost: BVMary, Mother of the Church (option 1)',
  advent_december_24: 'Advent, Dec. 24 (morning Mass)',
};

function sundayLabel(day) {
  if (MOVABLE[day.id]) return MOVABLE[day.id];
  let m;
  if ((m = day.id.match(/^ordinary_time_(\d+)_sunday$/))) return ord(+m[1]) + ' Sunday in Ordinary Time';
  if ((m = day.id.match(/^advent_(\d+)_sunday$/))) return ord(+m[1]) + ' Sunday of Advent';
  if ((m = day.id.match(/^lent_(\d+)_sunday$/))) return ord(+m[1]) + ' Sunday of Lent';
  if ((m = day.id.match(/^easter_time_(\d+)_sunday$/))) return ord(+m[1]) + ' Sunday of Easter';
  return null;
}

// The ferial (seasonal) weekday slot a date occupies, regardless of which
// memorial may happen to be celebrated on it.
function ferialLabel(day, iso) {
  const w = day.calendar && day.calendar.weekOfSeason;
  const dow = DOW[dowOf(iso)];
  const season = (day.seasons || [])[0];
  const periods = day.periods || [];
  const [, mm, dd] = iso.split('-').map(Number);

  if (periods.includes('HOLY_WEEK')) return 'Holy Week, ' + dow;
  if (periods.includes('EASTER_OCTAVE')) return 'Easter Octave, ' + dow;
  if (season === 'ADVENT') {
    if (mm === 12 && dd === 24) return 'Advent, Dec. 24 (morning Mass)';
    return mm === 12 && dd >= 17 ? 'Advent, Dec. ' + dd : 'Advent, Week ' + w + ', ' + dow;
  }
  if (season === 'CHRISTMAS_TIME' || season === 'CHRISTMASTIDE') {
    if (mm === 12 && dd >= 29) return ord(dd - 24) + ' Day in Xmas Octave, Dec. ' + dd;
    if (mm === 1 && dd >= 2 && dd <= 7) return 'Mon after Epiphany, or Jan. 7';
    return null;
  }
  if (season === 'LENT') return 'Lent, Week ' + w + ', ' + dow;
  if (season === 'EASTER_TIME' || season === 'EASTERTIDE') return 'Easter, Week ' + w + ', ' + dow;
  if (season === 'ORDINARY_TIME') return 'Ord. Time, Week ' + w + ', ' + dow;
  return null;
}

const pick = (bucket, ...keys) => {
  for (const k of keys) if (k && bucket[k]) return { key: k, ...bucket[k] };
  return null;
};

// Some seasonal days are split into option variants too ("Advent, Dec. 21
// (opt. 1)"). Merge every variant of one base label the same way feasts merge.
function mergeVariants(bucket, base, cycle) {
  if (!base) return null;
  const pool = Object.keys(bucket)
    .map((k) => ({ k, label: k.split('|')[0], cyc: k.split('|')[1] }))
    .filter((c) => c.cyc === cycle && (c.label === base || c.label.startsWith(base + ' (')))
    .map((c) => ({ label: c.label, readings: bucket[c.k] }))
    .sort((a, b) => score(a) - score(b));
  if (!pool.length) return null;

  const merged = {};
  const sources = [];
  for (const slot of ['first', 'second', 'gospel']) {
    const hit = pool.find((c) => c.readings[slot]);
    if (!hit) continue;
    merged[slot] = hit.readings[slot];
    if (!sources.includes(hit.label)) sources.push(hit.label);
  }
  return Object.keys(merged).length ? { key: sources.join(' + '), ...merged } : null;
}

// ------------------------------------------------------------------ titles
// The national calendar bundles are an abandoned alpha and will not load
// against romcal 3.x, so day names are composed here instead. The wording
// follows the USCCB daily-readings headings the sacristan will cross-check.
const WORDS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh',
  'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth',
  'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth',
  'Twenty-first', 'Twenty-second', 'Twenty-third', 'Twenty-fourth', 'Twenty-fifth',
  'Twenty-sixth', 'Twenty-seventh', 'Twenty-eighth', 'Twenty-ninth', 'Thirtieth',
  'Thirty-first', 'Thirty-second', 'Thirty-third', 'Thirty-fourth'];
const SMALL = new Set(['of', 'the', 'and', 'in', 'a', 'to', 'for']);

const humanize = (id) =>
  id.split('_').map((w, i) => (i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');

// "Sept 21: St. Matthew, Apostle and Evangelist (option 1)" -> "St. Matthew, Apostle and Evangelist"
const fromLabel = (label) =>
  label.split(' + ')[0]
    .replace(/^[A-Za-z]+\.?\s+\d{1,2}:\s*/, '')
    .replace(/^(Solemnity|Feast):\s*/i, '')
    .replace(/\s*\((?:option|opt\.?|Year|Response|responsorial|note)[^)]*\)\s*$/i, '')
    .trim();

const SEASON_WORD = { ordinary_time: 'Ordinary Time', advent: 'Advent', lent: 'Lent', easter_time: 'Easter' };

// Titles that read poorly when derived from a table label or an id.
const TITLE_OVERRIDES = {
  easter_monday: 'Monday within the Octave of Easter',
  monday_after_epiphany: 'Monday after Epiphany',
  mary_mother_of_the_church: 'Blessed Virgin Mary, Mother of the Church',
  advent_december_24: 'December 24 (morning Mass)',
};

// "3rd Sunday in Ordinary Time" -> "Third Sunday in Ordinary Time", so titles
// taken from table labels match the ones composed here.
const wordify = (s) => s.replace(/^(\d+)(?:st|nd|rd|th)\b/, (m0, n) => WORDS[+n] || m0);

function titleFor(day, iso, label, source) {
  if (TITLE_OVERRIDES[day.id]) return TITLE_OVERRIDES[day.id];
  // Plain seasonal days compose from season + week + weekday.
  const m = day.id.match(/^(ordinary_time|advent|lent|easter_time)_(\d+)_(sunday|monday)$/);
  if (m && source !== 'proper') {
    const which = WORDS[+m[2]] || m[2];
    const season = SEASON_WORD[m[1]];
    const joiner = m[1] === 'ordinary_time' ? 'in' : 'of';
    return m[3] === 'sunday'
      ? which + ' Sunday ' + joiner + ' ' + season
      : 'Monday of the ' + which + ' Week ' + joiner + ' ' + season;
  }
  if (source === 'proper' && label) return wordify(fromLabel(label));
  if (source === 'sunday' && label) return wordify(label);
  return humanize(day.id);
}

// The US national calendar raises a handful of days above the general calendar.
// Only those that change the readings on a Sunday or Monday matter here.
const US_OVERRIDES = { '12-12': 'FEAST' }; // Our Lady of Guadalupe

// ------------------------------------------------------------------- main
const romcal = new Romcal({
  scope: 'gregorian',
  epiphanyOnSunday: true,
  corpusChristiOnSunday: true,
  ascensionOnSunday: ASCENSION_ON_SUNDAY,
});

const days = {};
const unresolved = [];

for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
  const cal = await romcal.generateCalendar(y);
  for (const [iso, entries] of Object.entries(cal)) {
    const dow = dowOf(iso);
    if (dow !== 0 && dow !== 1) continue; // the sacristan only ever needs these
    const day = entries[0];
    const cycles = day.cycles || {};
    const sundayCycle = (cycles.sundayCycle || '').replace('YEAR_', '');
    const weekdayCycle = (cycles.weekdayCycle || '').replace('YEAR_', '');
    const isProper = day.rank === 'SOLEMNITY' || day.rank === 'FEAST' || Boolean(US_OVERRIDES[iso.slice(5)]);

    // A Sunday needs its Gospel; a Monday needs a first reading and a Gospel.
    const need = dow === 0 ? ['gospel'] : ['first', 'gospel'];
    const complete = (r) => r && need.every((s) => r[s] && r[s].length);

    let readings = null;
    let label = null;
    let source = null;
    let firstFromFerial = false;

    if (dow === 0) {
      source = 'sunday';
      label = sundayLabel(day);
      readings = pick(lect.sundays, label && label + '|' + sundayCycle);
      if (!complete(readings)) {
        const byFeast = feastByDate(iso, sundayCycle, need);
        if (byFeast) { readings = byFeast; label = byFeast.key; source = 'proper'; }
      }
    } else if (isProper) {
      source = 'proper';
      label = MOVABLE[day.id] || null;
      readings =
        pick(lect.sundays, label && label + '|' + sundayCycle, label && label + '|A') ||
        pick(lect.weekdays, label && label + '|' + weekdayCycle, label && label + '|1');
      if (!complete(readings)) {
        const byFeast = feastByDate(iso, weekdayCycle, need) || feastByDate(iso, weekdayCycle, ['gospel']);
        if (byFeast) { readings = byFeast; label = byFeast.key; }
      }
    }

    if (!complete(readings) && dow === 1) {
      // Memorials keep the ferial readings unless the celebrant chooses propers.
      // A proper Gospel with no proper first reading also falls back here.
      const fLabel = ferialLabel(day, iso);
      const ferial = mergeVariants(lect.weekdays, fLabel, weekdayCycle);
      if (readings && readings.gospel && ferial && ferial.first) {
        readings = { ...readings, first: ferial.first };
        firstFromFerial = true;
      } else if (ferial) {
        readings = ferial;
        label = fLabel;
        source = 'ferial';
      }
    }

    const rec = {
      title: titleFor(day, iso, label, source),
      rank: day.rank,
      cycle: dow === 0 ? sundayCycle : weekdayCycle,
      usccb: usccbUrl(iso),
      source,
      label,
    };
    if (readings) {
      if (readings.first) rec.first = readings.first;
      if (readings.second) rec.second = readings.second;
      if (readings.gospel) rec.gospel = readings.gospel;
      const from = readings.gospel || readings.first || [];
      rec.lectionary = from.length ? from[0].lectionary : null;
      if (firstFromFerial) rec.firstFromFerial = true;
    }
    if (!complete(readings)) {
      rec.unverified = true;
      unresolved.push(iso + '  ' + String(day.rank).padEnd(9) + ' ' + day.id + '  (label: ' + (label || 'none') + ')');
    }

    // A memorial keeps the ferial readings, but its own propers may be chosen
    // by the celebrant. Surface them so the sacristan knows to ask.
    if (dow === 1 && source === 'ferial' && day.rank !== 'WEEKDAY') {
      const proper = feastByDate(iso, weekdayCycle, ['gospel']);
      if (proper) rec.properOption = { label: proper.key, first: proper.first, gospel: proper.gospel };
    }
    const optional = entries.slice(1).map((e) => humanize(e.id));
    if (optional.length) rec.optionalMemorials = optional;

    days[iso] = rec;
  }
}

writeFileSync('public/readings.json', JSON.stringify({
  built: new Date().toISOString(),
  firstYear: FIRST_YEAR,
  lastYear: LAST_YEAR,
  ascensionOnSunday: ASCENSION_ON_SUNDAY,
  lectionarySource: lect.source,
  days,
}));

const total = Object.keys(days).length;
console.log('generated ' + total + ' Sunday/Monday records for ' + FIRST_YEAR + '-' + LAST_YEAR);
console.log('resolved: ' + (total - unresolved.length) + '   unresolved: ' + unresolved.length);
if (unresolved.length) {
  console.log('\n--- unresolved (rendered as "verify on USCCB") ---');
  console.log(unresolved.slice(0, 40).join('\n'));
}
