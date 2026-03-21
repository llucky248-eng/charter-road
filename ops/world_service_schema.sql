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
