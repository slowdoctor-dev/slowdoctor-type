-- Track rename (Director 2026-07-12): aesthetic → pmc. The PMC query returns
-- general medical-research abstracts, not aesthetics-specific content, so the
-- track is now named after its source (consistent with `federal`).
-- Covers both predecessors: 'medical' (pre-0005 rows) and 'aesthetic'.
UPDATE articles SET track = 'pmc' WHERE track IN ('medical', 'aesthetic');
