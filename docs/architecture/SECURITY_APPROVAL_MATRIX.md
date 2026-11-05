# Security and approval matrix

| Operation | Required authority |
|---|---|
|Owned read/analysis|Verified tenant, tool allowlist, source scope.|
|Content draft|Task, quotas and content review.|
|Mandate proposal/approval|Revalidated owner portal session, CSRF, immutable hash/revision and explicit confirmation.|
|Covered non-spending task action|Exact approval OR active mandate; account/resource scope, quota, reviewed artifacts and current lease.|
|Launch/resume/budget change|Existing exact per-action approval; never first-version mandate coverage.|
|Revoke|Owner/current revision, serialized with execution.|
|Production/migration/flags|Separate release approval for reviewed tested commit and rollback.|
|New provider cost or media spend|Separate covered financial authority.|
|Real outbound test|Approved recipient/purpose and channel policy.|

Unknown effects enter manual review; there is no blanket rollback guarantee. Revocation stops work not yet started and cannot undo completed effects. Both new flags default false. Existing production flags are not modified. Multi-user organization RBAC remains incomplete. Meta Tech Provider classification, advanced permissions and WhatsApp commercial eligibility are separate unresolved gates.

Scoped creation of forms/creatives/bundles/ads additionally requires an exact canonical match between proposed parameters and a reviewed JSON artifact. Image upload must reference the reviewed owned image. If content cannot be bound, the system falls back to exact per-action approval; an action-type mandate alone cannot approve different content. Later creative lifecycle work can add richer typed bindings without weakening this check.
