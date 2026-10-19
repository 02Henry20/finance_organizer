# Bug review — 19 October 2026

Reviewed the app modules and their import, reporting, persistence, quote, and
offline-cache flows, along with the HTML resource references and Firebase config.
The changes also include the earlier Revolut and spending-tag fixes.

## Fixed issues

| Area | Confirmed issue and resulting behavior |
| --- | --- |
| Revolut import | Foreign currencies could land on EUR accounts. Account assignment now requires the same currency, with unmatched rows explained in the filtered preview. |
| Revolut amounts | The minus sign before `£` was dropped. Native signs and repeated native/EUR columns are now parsed correctly. |
| Import duplicates | Separate Revolut purchases with the same day, merchant, and amount were filtered. Running-balance identity now distinguishes them. |
| Opening hints | Descending exports used the latest movement to derive an opening balance, and mixed-currency hints were summed. Hints now use the earliest completed movement per ledger. |
| Calendar dates | Statement dates, today's date, monthly report keys, and rolling comparison dates shifted through UTC conversion. Calendar days and months now remain stable across timezones. Impossible dates are rejected. |
| Spending tags | The UI rechecked transfer exclusions and saves revived legacy flags. Explicit manual choices now survive saves and rule reapplication. |
| Balances | Foreign-currency manual rows were added without conversion, and historical snapshots included transactions from before a dated opening balance. Totals and import previews now share the correct balance calculation. |
| PayPal | English exports were not recognized correctly; a valid zero net amount fell back to gross. English/German headers and signed net values are handled consistently. |
| Holdings import | Generic quantities/prices received Smartbroker scaling, missing quantities became zero holdings, and trade activity could overwrite complete positions with the last trade size. Scaling is format-specific, invalid quantities are filtered, and activity imports as transactions rather than a holdings snapshot. |
| Holding edits | Editing a name or quantity cleared downloaded quotes. Existing quotes are preserved unless the holding's currency changes. Explicit manual prices take precedence over old quotes. |
| Quotes | Pence prices were treated as pounds, known-identifier fallback was unreachable after a search failure, and retry chains exceeded the overall timeout. Prices, fallbacks, and deadlines are now handled consistently. |
| Daily holding change | Missing changes appeared as zero, and a −100% change could divide by zero. Unknown/undefined changes now remain unavailable. |
| Transaction persistence | Missing timestamps compared equal, allowing an ID collision to overwrite a legacy transaction. Only actual timestamp matches or explicit edit sources authorize an update. |
| Backup replacement | Malformed or partial backups could delete data before failing. Collection shape, IDs, numeric fields, and transaction dates are validated before any writes or deletions. |
| Sync | A successful listener hid another collection's pending writes or errors. Sync state now reflects all collections and cache readiness. |
| Account switching | Stale connections and in-flight operations could update a different workspace. Session guards stop stale listeners, writes, refreshes, and repairs. |
| Offline settings | An empty offline settings cache could seed defaults over existing cloud preferences. Defaults are seeded only after checking the server. |
| Firestore identity | An embedded stale `id` could replace the actual document ID. The document path now remains authoritative. |
| Delete all | Settings deletion errors were ignored while reporting success. Failures now propagate to the existing error UI. |
| Offline cache | Error responses poisoned caches, missing scripts received HTML, failed installs discarded a usable worker, and activation deleted unrelated app caches. Cache behavior now respects response status, request type, and app ownership. |
| Configuration | Firestore rules targeted `food-tracker` instead of `finance-organizer`. The owner-only rule now matches this app. Hosting and Git exclude local statements and generated tooling output; the malformed Git ignore file is repaired. |

## Validation

- Run `node --test tests/*.test.mjs` with Node.js 24 or later.
- Set `REVOLUT_CSV` to the private source CSV to enable its full reconciliation.
- The supplied statement reconciles to 172 EUR transactions totaling −€984.52,
  21 KRW transactions totaling ₩420, and two GBP transactions totaling £0.
  EUR closes at €36.45 from €1,020.97; all 195 statement dates match.
- Firestore, quote-provider, and service-worker boundaries use local mocks.
  The configuration test checks the rules' path and owner predicate; it does
  not replace a Firebase emulator or deployed-permission test.
- No production financial records were changed and no Firebase deployment was
  performed. Existing incorrect imports still require replacement.
