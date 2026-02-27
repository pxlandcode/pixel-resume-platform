-- Deprecated migration intentionally kept as a no-op for fresh talent-native databases.
-- Availability is out of scope in the current schema cutover.
-- Do not add legacy profile_availability tables in fresh environments.

DO $$
BEGIN
	RAISE NOTICE 'supabase-migrations-employee-availability.sql is deprecated and intentionally does nothing.';
END
$$;
