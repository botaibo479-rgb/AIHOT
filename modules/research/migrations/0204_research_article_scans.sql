-- Which revision of a public report the catalyst step has read, so it is read once: done, or invalid when
-- the model's answer could not be used (it is not asked again).
CREATE TABLE research_article_scans (
  article_id text NOT NULL,
  revision integer NOT NULL,
  status text NOT NULL CHECK (status IN ('done', 'invalid')),
  events integer NOT NULL,
  scanned_at timestamptz NOT NULL,
  PRIMARY KEY (article_id, revision)
);
