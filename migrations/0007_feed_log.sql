-- Feeder observability: one row per feeder run (cron or POST /api/feed).
-- Latest row is exposed as `last_feed` in /api/health so silent extraction
-- breakage (e.g. VOA DOM drift → articles_new stuck at 0) is visible.
CREATE TABLE IF NOT EXISTS feed_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  feeds_ok INTEGER NOT NULL,
  items_seen INTEGER NOT NULL,
  articles_new INTEGER NOT NULL,
  passages_new INTEGER NOT NULL,
  errors TEXT NOT NULL DEFAULT '[]'   -- JSON array of per-source error strings
);
