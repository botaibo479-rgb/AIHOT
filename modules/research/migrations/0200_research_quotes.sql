-- Quote snapshots of the research module's instruments (modules/research/backend/collect.ts), kept 30 days:
-- the latest price and, for perpetual contracts, the funding rate, open interest, mark and index prices.
CREATE TABLE research_quotes (
  instrument_id text NOT NULL,
  at timestamptz NOT NULL,
  source text NOT NULL,
  price numeric NOT NULL,
  change_24h numeric,
  quote_volume_24h numeric,
  funding_rate numeric,
  open_interest numeric,
  mark_price numeric,
  index_price numeric,
  PRIMARY KEY (instrument_id, at)
);
