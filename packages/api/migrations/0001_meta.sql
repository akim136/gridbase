-- @gridbase/api metadata registry: schema-as-data so the UI renders any table /
-- field / view generically, and so a future connector can describe non-D1
-- sources with the same shape. Applied via its own migrations_table
-- (grid_migrations) so it can coexist with other lineages on the same database.

-- Tables in the registry. table_id is a stable opaque id (e.g. tbl_ + hex).
CREATE TABLE meta_tables (
  table_id         TEXT PRIMARY KEY,
  workspace_id     TEXT,                         -- multi-tenant seam (nullable today)
  name             TEXT NOT NULL,                -- "Companies"
  slug             TEXT NOT NULL,                -- physical table, e.g. "grid_companies"
  primary_field_id TEXT NOT NULL,                -- fld… used as the record label
  position         INTEGER NOT NULL DEFAULT 0,
  source_kind      TEXT NOT NULL DEFAULT 'd1',   -- connector seam: d1 | postgres | external
  source_ref       TEXT,                         -- connector-specific handle
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fields. field_id is a stable opaque id (e.g. fld_ + hex); the wire contract.
CREATE TABLE meta_fields (
  field_id     TEXT PRIMARY KEY,
  table_id     TEXT NOT NULL REFERENCES meta_tables(table_id),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,        -- text|longtext|number|date|datetime|select|
                                     -- multiselect|checkbox|url|email|json|formula|link
  column_name  TEXT,                 -- physical column; NULL for formula/link
  position     INTEGER NOT NULL DEFAULT 0,
  options      TEXT,                 -- JSON: select choices / link target / formula spec
  is_computed  INTEGER NOT NULL DEFAULT 0,   -- 1 for formula (read-only, computed on read)
  is_primary   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_meta_fields_table ON meta_fields(table_id, position);

-- Views. config is JSON (ViewConfig): visible fields+order, filters, sorts,
-- groupBy, kanban.stackFieldId, calendar.dateFieldId, form.fieldIds.
CREATE TABLE meta_views (
  view_id    TEXT PRIMARY KEY,
  table_id   TEXT NOT NULL REFERENCES meta_tables(table_id),
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,          -- table | kanban | calendar | form | detail
  position   INTEGER NOT NULL DEFAULT 0,
  is_hidden  INTEGER NOT NULL DEFAULT 0,
  config     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_meta_views_table ON meta_views(table_id, position);
