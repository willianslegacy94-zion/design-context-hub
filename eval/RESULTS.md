# Retrieval evaluation

20 labelled questions over 15 documents (47 chunks). Context budget: 800 tokens. Model: `Xenova/all-MiniLM-L6-v2` running locally on CPU.

| Mode | Hit@1 | Recall@3 | MRR | Expected doc in packed context | Avg context tokens | p50 ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bm25 | 85% | 90% | 0.88 | 90% | 221 | 0.1 | 0.5 |
| vector | 90% | 100% | 0.95 | 100% | 146 | 3.9 | 5.6 |
| hybrid | 90% | 100% | 0.95 | 100% | 227 | 3.6 | 5.1 |

Hit@1: the expected document ranks first. Recall@3: it is in the top 3 documents. MRR: mean reciprocal rank of the expected document. Latency includes embedding the query.

## Hybrid misses

| Question | Expected | Ranked first | Rank of expected |
| --- | --- | --- | --- |
| Why do people give up during sign up? | onboarding-dropoff-study | campaign-localization | 2 |
| screen reader reads money amounts digit by digit | accessibility-audit-2026 | typography | 2 |
