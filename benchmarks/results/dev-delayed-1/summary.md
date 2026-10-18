# synthetic-local, real Jev loop

Results directory: `/Users/mikekaranja/Projects/tools/browser-automation/jev-browser/benchmarks/results/dev-delayed-1`. Stop: schedule complete; unexecuted slots: 0.

| Mode | Attempts | Verified | Completion (Wilson 95%) | Claimed | False success | Task median / p95 (ms) | Startup median (ms) | Actions median | Jev calls | Est. cost (USD) | Cost / verified success |
|---|---|---|---|---|---|---|---|---|---|---|---|
| headless | 5 | 5 | 100.0% (56.6%–100.0%) | 5 | 0 (0.0% of claims) | 6710 / 7126 | 385 | 3 | 20 | 0.0011 | 0.00022 |
| all | 5 | 5 | 100.0% (56.6%–100.0%) | 5 | 0 (0.0% of claims) | 6710 / 7126 | 385 | 3 | 20 | 0.0011 | 0.00022 |

Failure categories (all measured attempts): pass=5

| Case | headless pass/n | headless categories |
|---|---|---|
| delayed-content | 5/5 | pass, pass, pass, pass, pass |

Ledger (all phases including warm-ups): 20 outbound requests, settled estimate $0.0011, 0 with unknown billing (reserved $0.0000).
