# Data contracts

clients.id remains the server-owned operational tenant. Actions bind tenant, account, app, generation, plan hash and leased task. Business facts preserve source/evidence/status. businessCase uses exact arithmetic and explicit currency/period; unknown values stay unknown. Reported revenue, actual cash and lifetime estimates stay distinct.

Migration022 adds immutable mandate policy/hash, DRAFT/ACTIVE/REVOKED status/revision, authenticated owner identity/time, tenant-bound proposal replay, action-use reservations and audit. Models cannot supply verified owner context. The first scope excludes paid launch/resume/budget changes. A paused daily-budget cap is not a guarantee of future platform spend. Quota reservations count attempts, and unknown effects do not refund quota and replay.

Migration023 adds authenticated channel/input text to durable task turns without fabricated backfill. Approval inputs are redacted; pending approval replies remain encrypted. Bounded assistant context excludes secret codes. Shared history combines real turns and portal controls without duplicate request IDs. Existing task-turn retention and client-deletion cascades apply.

Migration024 adds a partial sender/order index. Enqueue and claim serialize per sender with the same advisory-lock namespace; consumers cannot skip a locked or delayed pending predecessor and process a later turn first. Different senders remain independently claimable.

Future contracts must separate organization/brand/branch/actor, event/ingestion time, revenue/cash/refunds, mature cohorts and descriptive attribution. Existing manually reported CRM revenue is not verified advertising revenue.
