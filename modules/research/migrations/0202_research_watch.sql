-- Where an instrument stands on the watchlist: nominated by how much it is reported, then watched or dropped
-- by the owner. No row: not on the list.
CREATE TABLE research_watch (
  instrument_id text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('nominated', 'watching', 'dropped')),
  reason text,
  changed_by text NOT NULL CHECK (changed_by IN ('auto', 'owner')),
  changed_at timestamptz NOT NULL
);
