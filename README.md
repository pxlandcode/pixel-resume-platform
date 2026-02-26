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

| Variable | Required | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | ✅ | Used for LLM-based diagnostics. |
| `LLM_MODEL` | ➖ | Optional override for the OpenAI model (defaults to `gpt-4o-mini`). |
| `BRAVE_SEARCH_KEY` | ➖ | Optional key to enable Brave Search ranking. |
| `BRAVE_AI_GROUNDING_KEY` | ➖ | Optional key to enable citation grounding results. |
| `ENABLE_RANKING` | ➖ | Set to `1` to activate the presence module (`/api/presence`). |

When `ENABLE_RANKING=1`, provide a Brave Search key to enrich the SERP presence report.

## 404 Snake leaderboard setup

The custom 404 page now hosts a Snake mini-game that persists scores through Supabase. Configure the following environment variables before deploying:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (optional but recommended for server-side inserts; otherwise ensure RLS policies allow anonymous writes to the table below)

Create the leaderboard table with this schema:

```sql
create table if not exists public.snake_highscores (
    id uuid primary key default gen_random_uuid(),
    player_name text not null,
    score integer not null,
    created_at timestamptz not null default now()
);
```

Grant the `insert` and `select` privileges (or author the corresponding row-level security policies) for the anon role if you choose not to supply a service role key.

### Manual test plan

1. Trigger the 404 page (e.g., visit `/this-route-does-not-exist`) and confirm the Snake board renders with the interactive background in place.
2. Start the game, eat at least one ampersand food item, and verify the live score and session best counters update.
3. Crash the snake, submit a score with a test name, and confirm a success toast as well as an updated entry in the leaderboard when Supabase is reachable.
4. Temporarily disable the network or Supabase credentials, reload the 404 page, and ensure the leaderboard falls back to the local session best without breaking gameplay.
