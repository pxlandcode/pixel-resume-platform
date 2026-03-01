# Required Refactor Notes: Foundation Talent + Organisations Schema

This project now includes a fresh-start migration:

- `supabase-migrations-foundation-talent-org.sql`

It intentionally removes legacy naming (`profiles`, `employee`, `cms_admin`) and introduces:

- `user_profiles`
- `talents`
- `organisations`
- `organisation_users`
- `organisation_talents`
- role set: `admin | talent | employer | broker`

## Important

The current app code still references legacy naming in many places (`profiles`, `employee`, `employees`, `cms_admin`).  
Because of that, the app will not work against a DB that only has the new foundation schema until a follow-up refactor is done.

## Follow-up Refactor Checklist

1. Replace DB table usage:
   - `profiles` -> `user_profiles` and/or `talents` depending on feature
   - all employee-facing routes/components -> talent naming
2. Replace role literals and guards:
   - `employee` -> `talent`
   - `cms_admin` -> `broker`
3. Update SQL helper function usage in app expectations:
   - `is_employee()` -> `is_talent()`
4. Introduce organisation-aware filtering in server queries:
   - constrain talent/resume reads by `organisation_users` + `organisation_talents` membership
5. Update auth/authorization code paths and UI labels:
   - menu access, role badges, route permissions, form defaults
6. Adapt resume-domain migrations and foreign keys:
   - current resume migrations reference legacy tables/roles and must be ported to `talents` and organisation scoping.

## Operational Sequence

1. Apply `supabase-migrations-foundation-talent-org.sql` to a fresh DB.
2. Create initial admin user.
3. Insert admin role row into `public.user_roles`.
4. Run the planned app refactor migration package.
5. Smoke test role gating, talent lifecycle, and organisation scoping.
