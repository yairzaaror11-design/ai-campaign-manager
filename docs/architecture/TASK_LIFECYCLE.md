# Task lifecycle

Preserve READY/RUNNING/WAITING_INPUT/WAITING_MODEL/WAITING_REVIEW/WAITING_APPROVAL/BLOCKED/PAUSED/HUMAN_PAUSED/MANUAL_REVIEW/COMPLETE/CANCELLED. One active task per client remains enforced. New goals replace prior work only when no live lease or unknown external result prevents it. Review and authority bind to current steps and hashes.

Initial planning is determined by the persisted plan, not message count. Structured output and one bounded pre-step correction cannot replay accepted plans or executors. Assistant questions now remain in bounded task context; evidence checks still read user messages only.

Portal and WhatsApp pilot turns share task identity, leases, results and history. Portal actions do not send WhatsApp replies. Human handover pauses both. Pending codes stay out of history and busy replies are not permanently cached as completed turns.

A scoped action persists WAITING_APPROVAL under its lease, atomically reserves a matching use and invokes the unchanged executor. The executor rechecks revocation under the client lock. Known revoked/stale permission is BLOCKED before provider activity; uncertain provider effects remain MANUAL_REVIEW. Paid activation is separate.

Remaining work includes parent/child tasks, manager conflicts, richer reference resolution and proactive scheduling. Timers cannot reopen terminal tasks.

A full regression exposed an inherited queue race: SKIP LOCKED could skip the first same-sender event and claim its successor before the first claimant acquired the sender lock. Admission now locks senders in sorted order before sequence allocation, and claim queries exclude pending predecessors. A real PostgreSQL regression deliberately holds the first row lock and verifies another sender may progress while the later same-sender event cannot.
