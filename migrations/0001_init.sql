-- slowdoctor-type initial schema
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,              -- source-native id (VOA numeric id; PMC id later)
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,             -- 'voa' | 'pmc' | 'gutenberg'
  track TEXT NOT NULL,              -- 'news' | 'medical' | 'classic'
  license TEXT NOT NULL,            -- 'public-domain' | 'cc-by'
  attribution TEXT NOT NULL,        -- rendered credit line
  published_at TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS passages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id TEXT NOT NULL REFERENCES articles(id),
  seq INTEGER NOT NULL,             -- order within the article
  text TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  UNIQUE(article_id, seq)
);

-- anonymous aggregate results (personal history lives in localStorage)
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  passage_id INTEGER,
  wpm REAL NOT NULL,
  raw_wpm REAL NOT NULL,
  accuracy REAL NOT NULL,
  consistency REAL NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_passages_article ON passages(article_id);
