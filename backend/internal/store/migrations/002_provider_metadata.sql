-- Keep simulation and live remote IDs from accidentally sharing one database.
-- IF NOT EXISTS also supports early development databases bootstrapped before this migration.
CREATE TABLE IF NOT EXISTS app_metadata (
 key text PRIMARY KEY,
 value text NOT NULL
);
