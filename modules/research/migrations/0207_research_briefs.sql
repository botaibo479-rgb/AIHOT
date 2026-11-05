-- The daily research brief, one per Beijing date, written once and never rewritten.
CREATE TABLE research_briefs (
  day date PRIMARY KEY,
  generated_at timestamptz NOT NULL,
  content jsonb NOT NULL,
  receipt_ids bigint[] NOT NULL DEFAULT '{}'
);
