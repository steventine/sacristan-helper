// Sanity checks over the generated readings.json. Run after generate.mjs.
// These are invariants of the US Lectionary, checked independently of the
// table the data was built from, so a bad join shows up as a failure.
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('public/readings.json', 'utf8'));
const days = data.days;
let failures = 0;
const fail = (msg) => { console.log('  FAIL ' + msg); failures++; };

// Known-good values read off the USCCB page for that date.
// Solemnities whose Old Testament reading sits on a "(1st reading)" row of its
// own are here because an earlier join duplicated the epistle into both slots.
const KNOWN = {
  '2026-08-31': { lectionary: '431', first: '1 Cor 2:1-5', gospel: 'Luke 4:16-30' },
  '2026-08-30': { lectionary: '124', gospel: 'Matt 16:21-27' },
  '2026-11-01': { lectionary: '667', first: 'Rev 7:2-4, 9-14', second: '1 John 3:1-3', gospel: 'Matt 5:1-12a' },
  '2026-06-29': { lectionary: '591', first: 'Acts 12:1-11', second: '2 Tim 4:6-8, 17-18', gospel: 'Matt 16:13-19' },
  '2027-08-15': { lectionary: '622', first: 'Rev 11:19a; 12:1-6a, 10ab', second: '1 Cor 15:20-27', gospel: 'Luke 1:39-56' },
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

console.log('\n3. Sundays and Mondays each have a first reading and a Gospel');
for (const [iso, r] of Object.entries(days)) {
  const isSunday = new Date(iso + 'T12:00:00Z').getUTCDay() === 0;
  if (isSunday) {
    if (!r.gospel || !r.gospel.length) fail(iso + ' Sunday has no Gospel (' + r.title + ')');
    if (!r.first || !r.first.length) fail(iso + ' Sunday has no first reading (' + r.title + ')');
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
  const got = {
    lectionary: r.lectionary,
    first: r.first && r.first[0].citation,
    second: r.second && r.second[0].citation,
    gospel: r.gospel && r.gospel[0].citation,
  };
  for (const k of Object.keys(want)) {
    if (got[k] !== want[k]) fail(iso + ' ' + k + ': got "' + got[k] + '", want "' + want[k] + '"');
  }
  console.log('  ' + iso + '  ' + r.title);
  console.log('      Lectionary ' + r.lectionary + ' | first: ' + got.first + ' | gospel: ' + got.gospel);
}

console.log('\n5. no first reading merely repeats the second');
let dupes = 0;
for (const [iso, r] of Object.entries(days)) {
  if (!r.first || !r.second) continue;
  if (r.first[0].citation === r.second[0].citation) {
    fail(iso + ' ' + r.title + ': first and second are both ' + r.first[0].citation);
    dupes++;
  }
}
if (!dupes) console.log('  ok');

console.log('\n6. cycle rotation is sane');
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
