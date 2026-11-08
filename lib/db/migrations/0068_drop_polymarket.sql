-- Polymarket feature removed: pages, ingest endpoint and schema are gone.
-- Apply only after the code that reads these tables has been deployed.
DROP TABLE IF EXISTS polymarket_wallet_scores;
DROP TABLE IF EXISTS polymarket_trades;
DROP TABLE IF EXISTS polymarket_events;
DROP TABLE IF EXISTS polymarket_wallets;
