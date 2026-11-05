-- Every change to a judgment, appended and never rewritten: its card when opened or updated, a status the
-- daily check or the owner set, a review when it ended, a note. The latest revision is where it stands.
CREATE TABLE research_thesis_revisions (
  thesis_id bigint NOT NULL,
  rev integer NOT NULL,
  at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('open', 'update', 'status', 'review', 'note')),
  status text NOT NULL CHECK (status IN ('watching', 'near', 'triggered', 'invalidated', 'expired', 'withdrawn')),
  content jsonb,
  reason text,
  author text NOT NULL CHECK (author IN ('model', 'rule', 'owner')),
  receipt_id bigint,
  price numeric,
  price_at timestamptz,
  PRIMARY KEY (thesis_id, rev)
);
