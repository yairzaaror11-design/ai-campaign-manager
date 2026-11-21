ALTER TABLE workspace_items DROP CONSTRAINT workspace_items_kind_check;
ALTER TABLE workspace_items ADD CONSTRAINT workspace_items_kind_check
 CHECK(kind IN ('products','content','tasks','expenses','personas','research'));
