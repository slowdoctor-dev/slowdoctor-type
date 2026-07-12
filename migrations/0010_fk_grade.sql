-- Passage difficulty (Roadmap "Passage difficulty"): Flesch-Kincaid grade,
-- filled at ingest for new passages; existing NULL rows are backfilled in
-- batches by the feeder's housekeeping pass.
ALTER TABLE passages ADD COLUMN fk_grade REAL;
