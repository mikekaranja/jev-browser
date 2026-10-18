# live-public, real Jev loop

Results directory: `/Users/mikekaranja/Projects/tools/browser-automation/jev-browser/benchmarks/results/public-smoke-5rep`. Stop: schedule complete; unexecuted slots: 0.

| Mode | Attempts | Verified | Completion (Wilson 95%) | Claimed | False success | Task median / p95 (ms) | Startup median (ms) | Actions median | Jev calls | Est. cost (USD) | Cost / verified success |
|---|---|---|---|---|---|---|---|---|---|---|---|
| headless | 15 | 15 | 100.0% (79.6%–100.0%) | 15 | 0 (0.0% of claims) | 4092 / 13205 | 751 | 1 | 38 | 0.0218 | 0.00145 |
| headed | 15 | 15 | 100.0% (79.6%–100.0%) | 15 | 0 (0.0% of claims) | 3779 / 7471 | 1129 | 1 | 35 | 0.0197 | 0.00131 |
| all | 30 | 30 | 100.0% (88.6%–100.0%) | 30 | 0 (0.0% of claims) | 3954 / 13147 | 909.5 | 1 | 73 | 0.0415 | 0.00138 |

Failure categories (all measured attempts): pass=30

| Case | headless pass/n | headed pass/n | headless categories | headed categories |
|---|---|---|---|---|
| live-wiki-search | 5/5 | 5/5 | pass, pass, pass, pass, pass | pass, pass, pass, pass, pass |
| live-wiki-coffee-espresso | 5/5 | 5/5 | pass, pass, pass, pass, pass | pass, pass, pass, pass, pass |
| live-example-iana | 5/5 | 5/5 | pass, pass, pass, pass, pass | pass, pass, pass, pass, pass |

Paired headed/headless: 15 pairs; both pass 15, headed only 0, headless only 0, both fail 0; exact McNemar p=n/a; reported-status agreement 100.0%; median task-time difference (headed − headless) -327 ms. Small sample (fewer than 30 pairs): treat as descriptive.

Ledger (all phases including warm-ups): 90 outbound requests, settled estimate $0.0447, 0 with unknown billing (reserved $0.0000).
