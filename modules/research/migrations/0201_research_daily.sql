-- Daily closes of the research module's instruments, kept for good: a crypto pair's UTC day, a stock's or
-- a FRED series' own trading date. Open interest only for perpetual contracts.
CREATE TABLE research_daily (
  instrument_id text NOT NULL,
  day date NOT NULL,
  source text NOT NULL,
  close numeric NOT NULL,
  volume numeric,
  open_interest numeric,
  PRIMARY KEY (instrument_id, day)
);
