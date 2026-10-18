# synthetic-local, real Jev loop

Results directory: `/Users/mikekaranja/Projects/tools/browser-automation/jev-browser/benchmarks/results/fixes-headless-1`. Stop: schedule complete; unexecuted slots: 0.

| Mode | Attempts | Verified | Completion (Wilson 95%) | Claimed | False success | Task median / p95 (ms) | Startup median (ms) | Actions median | Jev calls | Est. cost (USD) | Cost / verified success |
|---|---|---|---|---|---|---|---|---|---|---|---|
| headless | 60 | 57 | 95.0% (86.3%–98.3%) | 55 | 0 (0.0% of claims) | 2844 / 6790 | 379 | 2 | 239 | 0.0163 | 0.00029 |
| all | 60 | 57 | 95.0% (86.3%–98.3%) | 55 | 0 (0.0% of claims) | 2844 / 6790 | 379 | 2 | 239 | 0.0163 | 0.00029 |

Failure categories (all measured attempts): unsafe_write=3, pass=57

| Case | headless pass/n | headless categories |
|---|---|---|
| unavailable-target | 2/5 | unsafe_write, unsafe_write, unsafe_write, pass, pass |
| pagination | 5/5 | pass, pass, pass, pass, pass |
| form-no-submit | 5/5 | pass, pass, pass, pass, pass |
| search-keyboard | 5/5 | pass, pass, pass, pass, pass |
| nav-new-tab | 5/5 | pass, pass, pass, pass, pass |
| offscreen-lazy | 5/5 | pass, pass, pass, pass, pass |
| filter-sort | 5/5 | pass, pass, pass, pass, pass |
| stop-before-submit | 5/5 | pass, pass, pass, pass, pass |
| extract-annual-price | 5/5 | pass, pass, pass, pass, pass |
| dropdowns | 5/5 | pass, pass, pass, pass, pass |
| ambiguous-save | 5/5 | pass, pass, pass, pass, pass |
| delayed-content | 5/5 | pass, pass, pass, pass, pass |

Ledger (all phases including warm-ups): 262 outbound requests, settled estimate $0.0165, 0 with unknown billing (reserved $0.0000).
