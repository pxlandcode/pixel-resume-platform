# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Environment configuration

The AI Compatibility Checker relies on the following environment variables:

| Variable                 | Required | Description                                                         |
| ------------------------ | -------- | ------------------------------------------------------------------- |
| `OPENAI_API_KEY`         | ✅       | Used for LLM-based diagnostics.                                     |
| `LLM_MODEL`              | ➖       | Optional override for the OpenAI model (defaults to `gpt-4o-mini`). |
| `BRAVE_SEARCH_KEY`       | ➖       | Optional key to enable Brave Search ranking.                        |
| `BRAVE_AI_GROUNDING_KEY` | ➖       | Optional key to enable citation grounding results.                  |
| `ENABLE_RANKING`         | ➖       | Set to `1` to activate the presence module (`/api/presence`).       |

When `ENABLE_RANKING=1`, provide a Brave Search key to enrich the SERP presence report.

## 404 Snake leaderboard setup

The custom 404 page now hosts a Snake mini-game that persists scores through Supabase. Configure the following environment variables before deploying:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (or legacy `SUPABASE_ANON_KEY`)
- `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`)

For browser/client usage, set:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `PUBLIC_SUPABASE_ANON_KEY`)

### Demo organisation

The migration `20260429100000_demo_organisation_reset.sql` adds a resettable `Demo Organisation`
organisation with slug `demo`. It seeds one organisation admin user link, one talent user link,
one full talent profile, availability, and one main resume. The demo admin is also assigned the
`employer` role.

Run this after applying migrations to create/update the two Supabase Auth users and seed the demo:

```bash
DEMO_ADMIN_EMAIL=demo.admin@test.se \
DEMO_ADMIN_PASSWORD='set-a-stable-password' \
DEMO_TALENT_EMAIL=demo.talent@test.se \
DEMO_TALENT_PASSWORD='set-a-stable-password' \
npm run demo:setup
```

The reset function is `public.reset_demo_organisation(admin_email, talent_email)`. If `pg_cron`
is available in the database, the migration schedules it nightly at `0 2 * * *`; otherwise run the
function from Supabase Scheduled Functions/cron with the service role.

Create the leaderboard table with this schema:

```sql
create table if not exists public.snake_highscores (
    id uuid primary key default gen_random_uuid(),
    player_name text not null,
    score integer not null,
    created_at timestamptz not null default now()
);
```

Grant the `insert` and `select` privileges (or author the corresponding row-level security policies) for low-privilege clients if you choose not to supply a secret key.

## Resume share links

The resume share-link feature requires:

- `RESUME_SHARE_SECRET`

Use a high-entropy secret with at least 32 characters. This key is used to derive token/session hashing and token encryption keys for shared resume links.

Generate one locally with:

```sh
openssl rand -base64 32
```

Then add it to your local env file:

```env
RESUME_SHARE_SECRET=your_generated_secret_here
```

### Manual test plan

1. Trigger the 404 page (e.g., visit `/this-route-does-not-exist`) and confirm the Snake board renders with the interactive background in place.
2. Start the game, eat at least one ampersand food item, and verify the live score and session best counters update.
3. Crash the snake, submit a score with a test name, and confirm a success toast as well as an updated entry in the leaderboard when Supabase is reachable.
4. Temporarily disable the network or Supabase credentials, reload the 404 page, and ensure the leaderboard falls back to the local session best without breaking gameplay.

## Supabase migration order (fresh talent-native DB)

Apply migrations in this order:

1. `supabase-migrations-foundation-talent-org.sql`
2. `supabase-migrations-foundation-roles-org-links-refactor.sql`
3. `supabase-migrations-profile-availability.sql`
4. `supabase-migrations-resume-normalized-schema.sql`
5. `supabase-migrations-resume-normalized-cutover.sql`
6. `supabase-migrations-resume-import-jobs.sql`
7. `supabase-migrations-storage-buckets.sql`

### Migrations to skip in fresh setup

- `supabase-migrations-resumes.sql` (legacy employee/profile policies)
- `supabase-migrations-employee-availability.sql` (deprecated no-op)
- Any legacy migration that references `profiles`, `employee`, or `cms_admin`

## Legal, Consent, and Audit Ops

### Migration

Apply:

1. `supabase/migrations/20260301113000_legal_consent_audit_layer.sql`

This migration adds:

- versioned legal docs (`legal_documents`) with one active doc per type (`tos`, `privacy`, `ai_notice`, `data_sharing`)
- immutable acceptance snapshots (`user_legal_acceptances`) keyed by active document IDs
- employer lawful-basis assertions for talent creation without a linked user (`employer_talent_assertions`)
- explicit source->target org sharing scopes (`data_sharing_permissions`)
- append-only sensitive audit events (`audit_logs`)

### Publish a New Legal Version

1. Create a new legal document row (`doc_type`, `version`, `effective_date`, sanitized `content_html`) via:
   - `POST /legal/admin/documents`
2. Activate that version via:
   - `POST /legal/admin/documents/:id/activate`
   - or send `is_active=true` when creating

Activating a new version for any required legal doc type forces re-acceptance for all users in scope, because acceptance is validated against the currently active document ID set.

### What Triggers Re-Accept

Users are compliant only when their latest acceptance row references the exact active IDs for:

- ToS
- Privacy
- AI Notice
- Data Sharing Notice

If any active ID changes, `hasAcceptedCurrent` becomes false and protected routes/actions redirect or reject until `POST /legal/accept` is completed.

### Stored Acceptance and Audit Data

- Acceptance rows store:
  - `user_id`, `organisation_id`
  - snapshot IDs: `tos_document_id`, `privacy_document_id`, `ai_notice_document_id`, `data_sharing_document_id`
  - `accepted_at`, `ip_address`, `user_agent`
- Audit rows store:
  - `actor_user_id`, `organisation_id`, `action_type`, `resource_type`, `resource_id`, `metadata_json`, `created_at`
  - export metadata includes: `template_used`, `source_org_id`, `target_org_id`, `resume_id`

### Service-Role Exception Scope

`audit_logs` intentionally has no client insert policy. Audit inserts are written by internal server helpers using the Supabase admin/service-role client only (`src/lib/server/auditService.ts`). End users cannot insert audit records directly.
