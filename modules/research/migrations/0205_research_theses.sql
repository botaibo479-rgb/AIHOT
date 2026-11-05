-- A judgment about an instrument (modules/research/backend/theses.ts): opened by the daily brief from a
-- candidate card, or by the owner. What it says and where it stands live in its revisions.
CREATE TABLE research_theses (
  id bigserial PRIMARY KEY,
  instrument_id text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('brief', 'owner')),
  opened_at timestamptz NOT NULL
);
