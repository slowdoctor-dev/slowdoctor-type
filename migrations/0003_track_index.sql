-- passages are always selected via a track filter through the articles join
CREATE INDEX IF NOT EXISTS idx_articles_track ON articles(track);
