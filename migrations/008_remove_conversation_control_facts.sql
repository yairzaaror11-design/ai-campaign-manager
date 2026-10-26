-- Repair only facts containing explicit chat-reset instructions from the reported bug.
-- Keep all other business facts, connection data, messages and external campaign state.
WITH affected AS (
 SELECT client_id, jsonb_object_agg(e.key,e.value) FILTER (WHERE NOT (
   jsonb_typeof(e.value->'value')='string' AND
   (e.value->>'value') ~ '(תמחק|מחק|מחקי|תמחקי|אפס|אפסי|תאפס|תאפסי)[[:space:]]+(לי[[:space:]]+)?(את[[:space:]]+)?(כל[[:space:]]+)?(השיחה|הצאט|הצ׳אט|הצ''אט|האפיון)'
 )) AS answers
 FROM marketing_profiles CROSS JOIN LATERAL jsonb_each(payload->'answers') e
 GROUP BY client_id
 HAVING bool_or(jsonb_typeof(e.value->'value')='string' AND
   (e.value->>'value') ~ '(תמחק|מחק|מחקי|תמחקי|אפס|אפסי|תאפס|תאפסי)[[:space:]]+(לי[[:space:]]+)?(את[[:space:]]+)?(כל[[:space:]]+)?(השיחה|הצאט|הצ׳אט|הצ''אט|האפיון)')
)
UPDATE marketing_profiles m SET
 payload=jsonb_set((m.payload-'ui')||jsonb_build_object('events','[]'::jsonb),'{answers}',COALESCE(a.answers,'{}'::jsonb))
   ||jsonb_build_object('version',COALESCE((m.payload->>'version')::int,0)+1,
     'journey',COALESCE(m.payload->'journey','{}'::jsonb)||jsonb_build_object(
       'draft',NULL,'creativeFeedback',NULL,'strategyApproved',false,'creativeApproved',false,'planApproved',false,
       'stage','DISCOVERY','pendingField',NULL,'revision',COALESCE((m.payload->'journey'->>'revision')::int,0)+1)),
 revision=m.revision+1,updated_at=NOW()
FROM affected a WHERE a.client_id=m.client_id;
