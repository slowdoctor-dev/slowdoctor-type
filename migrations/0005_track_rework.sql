-- Track rework (Director 2026-07-11):
--   classic retired (Gutenberg seed removed; script kept in git history),
--   medical renamed to aesthetic (derm/plastic-surgery paper abstracts),
--   federal added (fed by cron — no seed rows needed).
DELETE FROM passages WHERE article_id IN (SELECT id FROM articles WHERE track = 'classic');
DELETE FROM articles WHERE track = 'classic';
UPDATE articles SET track = 'aesthetic' WHERE track = 'medical';
