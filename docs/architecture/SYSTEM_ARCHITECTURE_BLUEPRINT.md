# System architecture

Status: isolated integration, not a production release.

Continue the root Node/Express modular monolith, PostgreSQL source of truth and leased SQL queues. Reuse identity, OAuth, media, task and execution modules. No extra microservices, Kafka, Redis or duplicate CRM.

```mermaid
flowchart TD
 WA[Verified WhatsApp] --> C[Conversation controller]
 WEB[Authenticated portal] --> C
 C --> T[Durable task manager]
 T --> P[Structured planner]
 P --> R[Read tools]
 P --> V[Validated action proposal]
 V --> G[Approval and execution gateway]
 M[Owner scoped mandate] --> G
 A[Exact action approval] --> G
 G --> X[Tenant scoped provider adapter]
 X --> Q[Readback or manual review]
 Q --> T
 DB[(PostgreSQL and audit)] --- T
 DB --- G
```

Tenant identity comes from channel/session authentication, never model text. Existing Meta preparation, approval hashes, connection generations, execution permit and readback remain authoritative. The portal can opt into the same controller and task; default-off flags preserve existing behavior.

The first standing authority supports enumerated non-spending actions. Creation remains paused. Launch/resume/budget changes retain exact separate approval. Expiry, account/resource scope, quotas, reviewed artifacts, leases and revocation apply at execution.

Current tenant is clients.id; this does not implement full organization/brand/branch RBAC. Generated-media storage still uses the existing WhatsApp asset adapter; independent storage is S5 work. Provider eligibility and real pilot acceptance are distinct gates.
