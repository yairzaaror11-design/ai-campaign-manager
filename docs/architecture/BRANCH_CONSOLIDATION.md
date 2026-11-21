# Branch consolidation

Start from the verified current production tree. No automatic merges. Preserve recent WhatsApp fixes, current portal/auth and provider gates.

| PR | Decision |
|---|---|
|1|Current production changes; do not merge them into the older release branch.|
|4|Older conflicting adviser; compare selectively, preserve current deterministic tools.|
|5|Older conflicting portal/auth; preserve current owner identity and portal.|
|7|Legacy src fix; do not replace root runtime.|
|9|Security/restore overlap; retain tested equivalents and add missing regressions.|
|10|Frontend-specific patch; live Hostinger source is still unverified.|
|11|Tenant-worker regression; preserve corresponding current coverage.|
|13|Proposed app ID differs from the owner-approved live app; do not apply.|
|14|Older menu/voice fix; preserve current verified equivalents.|

The refreshed branch SHA/entrypoint/tree comparison and PR dependency graph are recorded below. A mergeable flag alone is not evidence a merge is appropriate.

| Branch | SHA | Entrypoint | Delta from base |
|---|---|---|---|
| architecture/scorpio-agent-core-v2 | db1f6aa1365edd8bb626859074445ee4b64de040 | index.js | 131 files changed, 863 insertions(+), 2942 deletions(-) |
| audit-security-hardening-20261025 | add62da437fac1e508a7ef43568c3c9b626d80a8 | index.js | identical tree |
| audit/task-001-20261027 | 6ac85dc5272b969bca6590d75097da268133f2c4 | src/index.js | 249 files changed, 3174 insertions(+), 22783 deletions(-) |
| docs/system-audit-20261027 | aed7eac3790c53a0d62ddcba759c0371755c88ec | index.js | 113 files changed, 522 insertions(+), 2937 deletions(-) |
| feature/chat-resilience-20261028 | 829a1a622918d83afce33dcbdaa304a64317f2b1 | index.js | 135 files changed, 1172 insertions(+), 2956 deletions(-) |
| feature/dashboard-rtl | 6f55a4d8562a2f19a7c3009607cbf763ec0eba1f | index.js | 189 files changed, 2286 insertions(+), 5677 deletions(-) |
| feature/marketing-brain-v1-20261026 | b6bb6b3bffee84845e8a620e5993bdb8fc8d3185 | index.js | 161 files changed, 315 insertions(+), 7265 deletions(-) |
| feature/marketing-question-bank-20261026 | 2a108789dad508ede76422c8d97bc2a34b7f35b9 | index.js | 161 files changed, 227 insertions(+), 7381 deletions(-) |
| feature/scorpio-frontend-agent2 | 57d2ee7d44f1fc313cb0a2cd17abbc343b7aeaee | index.js | 208 files changed, 8087 insertions(+), 5677 deletions(-) |
| fix/dashboard-fit-without-cramping | 79e000b2bd90ed267159110a68a6d5e3e2d23ac2 | index.js | 108 files changed, 285 insertions(+), 2937 deletions(-) |
| fix/dashboard-functional-completion | ee980df3a60c16782e9a42ad970fc9a01410af82 | index.js | 211 files changed, 8240 insertions(+), 5677 deletions(-) |
| fix/immediate-processing-replies-20261026 | 866358435d6994839aff4c5e6e6ec7b2afa953e1 | index.js | 160 files changed, 223 insertions(+), 7272 deletions(-) |
| fix/launch-gate-worker-tenant-regression-20261028 | 2f9d5f8d95342b2ef3b31ba305acb404f9f82a13 | index.js | 130 files changed, 844 insertions(+), 2942 deletions(-) |
| fix/meta-app-id-alignment-20261031 | b731233ce1be2dc4bf7ee06f9119926c82bea060 | index.js | 109 files changed, 209 insertions(+), 2943 deletions(-) |
| fix/scorpio-whatsapp-regressions-20261031 | 68bd81dcb11241fc5a246586a68f8ab4c5075f0c | index.js | 135 files changed, 1201 insertions(+), 2956 deletions(-) |
| fix/webhook-security-render-20261025 | ac766ea2d7c04d57a066cf57d8cd5f31a50d89ec | index.js | 231 files changed, 1385 insertions(+), 21571 deletions(-) |
| fix/whatsapp-context-and-approval-20261026 | fb066c117ed7a93a899723fe7fde332cfb143c33 | src/index.js | 237 files changed, 613 insertions(+), 22785 deletions(-) |
| main | 0694a9f89ae05f9b998bca4ef04c0e9d8de3a115 | src/index.js | 235 files changed, 598 insertions(+), 22783 deletions(-) |
| release/agent-flexibility-20261027 | 9789d0328e9bac50dc7202f3e5efe51f4e5aa855 | index.js | 108 files changed, 285 insertions(+), 2937 deletions(-) |
| render-safe-deploy | 833559fd95a8a87d04018cf83e97a774ccba73bb | index.js | 230 files changed, 1373 insertions(+), 21571 deletions(-) |
| security/phase1-manual-review-20261028 | 9cc4482bf1b66f28dcdba2e7f78fbea8a18b103b | index.js | 130 files changed, 844 insertions(+), 2942 deletions(-) |
| task-2/stabilization-security-20261027 | 869a3226912cf4315548b55c59e10e3fb1c66f85 | index.js | 128 files changed, 759 insertions(+), 2942 deletions(-) |

| PR | Head → base | Mergeable |
|---|---|---|
| #1 | audit-security-hardening-20261025 → render-safe-deploy | True |
| #4 | feature/marketing-brain-v1-20261026 → audit-security-hardening-20261025 | False |
| #5 | feature/dashboard-rtl → audit-security-hardening-20261025 | False |
| #7 | fix/whatsapp-context-and-approval-20261026 → main | True |
| #9 | task-2/stabilization-security-20261027 → audit-security-hardening-20261025 | False |
| #10 | fix/dashboard-functional-completion → feature/scorpio-frontend-agent2 | True |
| #11 | fix/launch-gate-worker-tenant-regression-20261028 → task-2/stabilization-security-20261027 | True |
| #13 | fix/meta-app-id-alignment-20261031 → audit-security-hardening-20261025 | False |
| #14 | fix/scorpio-whatsapp-regressions-20261031 → feature/chat-resilience-20261028 | True |
