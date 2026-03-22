-- Charter Road: World Traders (server-side simulation)
-- Run this in Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS world_traders (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  personality     TEXT NOT NULL,
  color           TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'in_city',   -- 'traveling' | 'in_city'
  from_id         TEXT NOT NULL DEFAULT 'valdenmere',
  to_id           TEXT NOT NULL DEFAULT 'valdenmere',
  item_id         TEXT NOT NULL DEFAULT 'ore',
  inv             JSONB NOT NULL DEFAULT '{}',
  gold            INT NOT NULL DEFAULT 80,
  start_gold      INT NOT NULL DEFAULT 80,
  total_profit    INT NOT NULL DEFAULT 0,
  trips_completed INT NOT NULL DEFAULT 0,
  progress        FLOAT NOT NULL DEFAULT 0,          -- 0.0–1.0 trip progress
  city_timer      FLOAT NOT NULL DEFAULT 30,         -- seconds until depart
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE world_traders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read world_traders"
  ON world_traders FOR SELECT USING (true);

CREATE POLICY "public upsert world_traders"
  ON world_traders FOR ALL USING (true);

-- Strategy decision log
CREATE TABLE IF NOT EXISTS trader_strategy_log (
  id          BIGSERIAL PRIMARY KEY,
  trader_id   TEXT NOT NULL,
  trader_name TEXT NOT NULL,
  trips_at    INT NOT NULL,
  decision    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  profit_rate FLOAT,
  old_strategy JSONB,
  new_strategy JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trader_strategy_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read trader_strategy_log"
  ON trader_strategy_log FOR SELECT USING (true);
CREATE POLICY "public insert trader_strategy_log"
  ON trader_strategy_log FOR INSERT WITH CHECK (true);

-- Add strategy columns to world_traders
ALTER TABLE world_traders
  ADD COLUMN IF NOT EXISTS preferred_item  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS review_at_trips INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS profit_history  JSONB NOT NULL DEFAULT '[]';
