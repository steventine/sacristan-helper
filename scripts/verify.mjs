// Sanity checks over the generated readings.json. Run after generate.mjs.
// These are invariants of the US Lectionary, checked independently of the
// table the data was built from, so a bad join shows up as a failure.
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('public/readings.json', 'utf8'));
const days = data.days;
let failures = 0;
const fail = (msg) => { console.log('  FAIL ' + msg); failures++; };

// Known-good values read off the USCCB page for that date.
const KNOWN = {
  '2026-08-31': { lectionary: '431', first: '1 Cor 2:1-5', gospel: 'Luke 4:16-30' },
  '2026-08-30': { lectionary: '124', gospel: 'Matt 16:21-27' },
};

console.log('records: ' + Object.keys(days).length + '  (' + data.firstYear + '-' + data.lastYear + ')');

console.log('\n1. every record resolved');
const unver = Object.entries(days).filter(([, r]) => r.unverified);
unver.length ? unver.slice(0, 10).forEach(([d, r]) => fail(d + ' ' + r.title)) : console.log('  ok');

console.log('\n2. Ordinary Time Monday lectionary numbers follow 305 + (week-1)*6');
let checked = 0;
for (const [iso, r] of Object.entries(days)) {
  const m = (r.label || '').match(/^Ord\. Time, Week (\d+), Mon$/);
  if (!m || r.source !== 'ferial') continue;
  const expected = String(305 + (+m[1] - 1) * 6);
  if (r.lectionary !== expected) fail(iso + ' week ' + m[1] + ': got ' + r.lectionary + ', expected ' + expected);
  checked++;
}
console.log('  checked ' + checked + ' ferial Ordinary Time Mondays');

console.log('\n3. Sundays have a Gospel; Mondays have a first reading and a Gospel');
for (const [iso, r] of Object.entries(days)) {
  const isSunday = new Date(iso + 'T12:00:00Z').getUTCDay() === 0;
  if (isSunday) {
    if (!r.gospel || !r.gospel.length) fail(iso + ' Sunday has no Gospel (' + r.title + ')');
  } else {
    if (!r.gospel || !r.gospel.length) fail(iso + ' Monday has no Gospel (' + r.title + ')');
    if (!r.first || !r.first.length) fail(iso + ' Monday has no first reading (' + r.title + ')');
  }
}
console.log('  done');

console.log('\n4. spot checks against USCCB');
for (const [iso, want] of Object.entries(KNOWN)) {
  const r = days[iso];
  if (!r) { fail(iso + ' missing'); continue; }
  const got = { lectionary: r.lectionary, first: r.first && r.first[0].citation, gospel: r.gospel && r.gospel[0].citation };
  for (const k of Object.keys(want)) {
    if (got[k] !== want[k]) fail(iso + ' ' + k + ': got "' + got[k] + '", want "' + want[k] + '"');
  }
  console.log('  ' + iso + '  ' + r.title);
  console.log('      Lectionary ' + r.lectionary + ' | first: ' + got.first + ' | gospel: ' + got.gospel);
}

console.log('\n5. cycle rotation is sane');
const sundayCycles = {}, weekdayCycles = {};
for (const [iso, r] of Object.entries(days)) {
  const isSunday = new Date(iso + 'T12:00:00Z').getUTCDay() === 0;
  (isSunday ? sundayCycles : weekdayCycles)[r.cycle] = ((isSunday ? sundayCycles : weekdayCycles)[r.cycle] || 0) + 1;
}
console.log('  Sunday cycles: ' + JSON.stringify(sundayCycles));
console.log('  weekday cycles: ' + JSON.stringify(weekdayCycles));
if (Object.keys(sundayCycles).some((c) => !'ABC'.includes(c))) fail('unexpected Sunday cycle');
if (Object.keys(weekdayCycles).some((c) => !'12'.includes(c))) fail('unexpected weekday cycle');

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed'));
process.exit(failures ? 1 : 0);
