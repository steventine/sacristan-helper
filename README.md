# Sacristan Helper

A one-screen phone page for setting the books after Sunday Mass:

1. **Next Sunday Book of the Gospels** — advance the bookmark to next Sunday's Gospel
2. **Weekday Book of the Gospels** — open to Monday's Gospel
3. **Weekday Lectionary** — open to Monday's first reading

Each card shows the citation in large type, the Lectionary number underneath, a
"Done" checkbox, and a link to the USCCB page for that date so the sacristan can
confirm before Mass.

## How it works

There is no backend and no runtime dependency on any third party. A build step
produces a single static `readings.json`; the page is plain HTML and JavaScript.

```
data/source/*.html      vendored US Lectionary index tables
   |  scripts/build-lectionary.mjs
data/lectionary.json    citations + Lectionary numbers, keyed by liturgical day
   |  scripts/generate.mjs   (joined against the romcal calendar)
public/readings.json    every Sunday and Monday in the configured year range
public/index.html       the app
```

`romcal` computes *which* liturgical day a date is — including the Advent
rollover of the Sunday (A/B/C) and weekday (I/II) cycles, the Ordinary Time
week renumbering after Easter, and solemnities that displace a Sunday. It
contains no scripture citations, so the lectionary table supplies those.

## Build

```bash
npm install
npm run build
```

Options:

```bash
FIRST_YEAR=2026 LAST_YEAR=2045 npm run generate
ASCENSION_ON_SUNDAY=false npm run generate   # provinces that keep Ascension on Thursday
```

`npm run verify` checks that every record resolved, that Sundays have a Gospel
and Mondays have both readings, and that ferial Ordinary Time Monday Lectionary
numbers match the independent formula `305 + (week − 1) × 6`. It also spot-checks
two dates against values read off the USCCB site. It needs no network.

## Cross-checking against USCCB

`scripts/spot_check.py` fetches sampled dates from bible.usccb.org using the
[catholic-mass-readings](https://pypi.org/project/catholic-mass-readings/)
package and diffs them against `public/readings.json`, normalising for the two
sites' different abbreviations (`1 Cor` vs `1 Corinthians`, `Is` vs `Isaiah`).

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe scripts/spot_check.py --count 8 --delay 15
```

Two limits are worth knowing before you rely on it:

- **USCCB rate-limits hard.** A handful of automated requests trips a bot
  challenge that then returns `403` for everything, for a good while, regardless
  of spacing. Check a few dates at a time; the script aborts after four
  consecutive failures rather than hammering the site.
- **USCCB only publishes about a year ahead.** Dates beyond that return `404`,
  so most of the generated range cannot be cross-checked at all — which is
  precisely why the calendar is computed locally rather than fetched.

The script defaults to sampling the next twelve months and exits non-zero if any
citation disagrees.

## Offline

`public/sw.js` is a service worker using **network-first with a 2.5s timeout**,
falling back to cache. Fresh content wins whenever the network answers promptly;
a dead or crawling connection falls back to the last good copy rather than
hanging. Every successful response is written back to the cache.

That means **a redeployed `index.html` or `readings.json` is picked up on the
next online visit automatically** — no version bump, no cache busting. The
`VERSION` constant in `sw.js` exists only to purge old caches if the caching
logic itself changes.

Service workers require HTTPS (or localhost). Registration failure is silent and
the page still works online.

## Deploy

`public/` is a static directory — upload it anywhere.

```bash
npx wrangler pages deploy public --project-name sacristan-helper
```

Re-run `npm run build` and redeploy when the date range needs extending. Nothing
expires in the meantime: readings for a given date never change.

## Things to check before relying on it

- **Ascension.** Defaults to Sunday. If your province keeps it on Thursday,
  rebuild with `ASCENSION_ON_SUNDAY=false`.
- **Optional memorials.** The ferial readings are shown, with the memorial named
  in a flag. The celebrant may choose the memorial's proper readings instead.
- **Diocesan propers.** The build uses the General Roman Calendar plus a small US
  overlay. A diocesan patron or a parish dedication feast is not in it — those
  days will show the general-calendar readings.
- **Timezone.** "Today" is computed in `America/New_York` (`TZ` in `index.html`).

## Sources

- Liturgical calendar: [romcal](https://github.com/romcal/romcal)
- Citations and Lectionary numbers: [catholic-resources.org/Lectionary](https://catholic-resources.org/Lectionary/)
  (Felix Just, S.J.) — US Lectionary for Mass
- Verification links: [bible.usccb.org](https://bible.usccb.org/)

Only citations, Lectionary numbers, and day names are stored. No scripture text
is reproduced.
