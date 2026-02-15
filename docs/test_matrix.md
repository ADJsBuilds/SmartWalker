# Test Matrix

This matrix maps required raw backend validation to automated tests.

## Legend

- **Type:** API, DB, WS, Integration, Load
- **Expected:** primary pass criteria

## Planned/Implemented Coverage

| ID | Area | Type | Case | Expected |
|---|---|---|---|---|
| T1 | DB boot | DB | Tables created in temp DB | Core tables exist |
| T2 | DB constraints | DB | `daily_reports` unique `(resident_id,date)` | second insert fails |
| T3 | DB constraints | DB | `daily_metric_rollups` unique `(resident_id,date)` | second insert fails |
| T4 | Walker validation | API | minimal valid walker payload | `200 {"ok": true}` |
| T5 | Walker validation | API | missing required fields | `422` |
| T6 | Walker validation | API | wrong types | `422` |
| T7 | Walker validation | API | unknown extra fields | accepted, no crash |
| T8 | Vision validation | API | minimal valid vision payload | `200 {"ok": true}` |
| T9 | Vision validation | API | wrong types | `422` |
| T10 | Vision validation | API | unknown extra fields | accepted, no crash |
| T11 | Merge/state | API | walker-only state shape | `/api/state` has walker + metrics |
| T12 | Merge/state | API | vision step priority over walker step | merged `metrics.steps` uses vision |
| T13 | Merge/state | API | reliance/balance with fsr totals | numeric computed values valid |
| T14 | Merge/state | API | fall rule (`vision` OR `tilt>=60`) | merged `fallSuspected` correct |
| T15 | Persistence throttle | Integration | quick repeated ingest | writes are sampled, not every packet |
| T16 | Persistence payload mode | Integration | full payload every N samples | compact/full JSON cadence matches config |
| T17 | Normalized persistence | DB/API | `exercise_metric_samples` populated | row exists after persisted ingest |
| T18 | WS snapshot | WS | `/ws` connect | receives `type=snapshot`, list payload |
| T19 | WS resident snapshot | WS | `/ws/live?residentId=r1` | snapshot scoped to resident |
| T20 | WS updates | WS | ingest after WS connect | receives `type=merged_update` |
| T21 | WS filter | WS | resident-scoped connection + other resident ingest | no unrelated resident updates |
| T22 | Rollup/events | Integration | critical packet (`tilt>=60`/fall true) | rollup rows and/or events created |
| T23 | Stats API | API | `/api/reports/stats` after ingest | non-empty daily/hourly for resident |
| T24 | Reports placeholder | API/FS | generate report with `usePlaceholder=true` | report row exists + non-empty PDF |
| T25 | Reports seeded | API/FS | seed data then generate non-placeholder report | report row exists + non-empty PDF |
| T26 | Burst robustness | Load/API | 200 fast packets | no exceptions, persisted rows present |

## Out-of-scope for this raw suite

- LLM quality correctness (Gemini/OpenEvidence output semantics)
- External provider uptime/credentials tests
- Frontend behavior

## Notes

- Tests run against temporary SQLite DB via dependency override.
- No hardware dependencies.
- Dummy packet generators cover walker + vision realistic ranges and edge cases.
