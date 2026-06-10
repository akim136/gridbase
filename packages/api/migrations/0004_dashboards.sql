-- Dashboards: a workspace-level report composer. Unlike a view (bound to one
-- table), a dashboard is a page of widgets that each reference any table. The
-- widgets[] array lives in config as JSON. Workspace-level (workspace_id nullable
-- for the single-tenant default), so it is NOT in meta_views (whose table_id is
-- NOT NULL).
CREATE TABLE meta_dashboards (
  dashboard_id TEXT PRIMARY KEY,
  workspace_id TEXT,
  name         TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  is_hidden    INTEGER NOT NULL DEFAULT 0,
  config       TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_meta_dashboards_ws ON meta_dashboards (workspace_id, position);
