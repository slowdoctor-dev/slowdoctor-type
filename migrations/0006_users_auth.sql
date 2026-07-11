-- Social sign-in (Director 2026-07-11): Google / Kakao / GitHub via OAuth,
-- one local user with N linked provider identities. No email collection —
-- provider uid + display name only.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '⌨️|160',  -- '<emoji>|<bg hue>', randomized at signup
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,              -- 'google' | 'kakao' | 'github'
  provider_uid TEXT NOT NULL,          -- provider's stable user id
  user_id INTEGER NOT NULL REFERENCES users(id),
  display TEXT,                        -- provider-side name at link time
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, provider_uid)
);
CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- future ranking: tag anonymous aggregate rows with the signed-in user
ALTER TABLE results ADD COLUMN user_id INTEGER;
