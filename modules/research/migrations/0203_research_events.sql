-- Future events for the calendar (modules/research/backend/events.ts): the owner's official calendar
-- (calendar.json, by key), events read out of public reports by the catalyst model step, and the owner's
-- own. A withdrawn event stays, with why.
CREATE TABLE research_events (
  id bigserial PRIMARY KEY,
  key text UNIQUE,
  title text NOT NULL,
  entity_ids text[] NOT NULL DEFAULT '{}',
  starts_on date,
  date_precision text NOT NULL CHECK (date_precision IN ('day', 'month', 'quarter', 'unknown')),
  confirmation text NOT NULL CHECK (confirmation IN ('official', 'tentative', 'speculative')),
  origin text NOT NULL CHECK (origin IN ('calendar', 'article', 'owner')),
  url text,
  quote text,
  article_ids text[] NOT NULL DEFAULT '{}',
  receipt_ids bigint[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  withdrawn_reason text
);
