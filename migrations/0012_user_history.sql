-- Cross-device history sync: one JSON blob of HistoryEntry[] per signed-in
-- user (client merges local+remote by timestamp; last write wins per device).
CREATE TABLE IF NOT EXISTS user_history (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
