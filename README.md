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
