# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single Node.js codebase (Indonesian-language "Teleshop") that runs as **two processes** sharing one Supabase/Postgres database:

- **Web admin dashboard** — `dashboard.js`, Express + EJS, serves `http://localhost:3000`. Run with `npm run dashboard`.
- **Telegram bot** — `index.js`, long-polls the Telegram API. Run with `node index.js`.
- `npm run dev` / `npm start` run **both** together via `concurrently`.
- Tests: `npm test` (Node's built-in `node --test`; suites in `test/`). There is **no lint and no build step** (plain CommonJS JS).

The install script (`.cursor/install.sh`, invoked by `.cursor/environment.json`) installs **Node deps**, the **Railway CLI**, the **Supabase CLI**, and runs `railway setup agent -y` for Cursor MCP/skills. Docker is baked into the environment image. The steps below are per-session startup steps, not things to reinstall.

### CLI tooling (Railway + Supabase)

Both CLIs are installed automatically on every Cloud Agent Build. Authenticate via **Cursor Secrets** (recommended for headless agents) or interactive login.

| Tool | Verify | Auth (headless) | Auth (interactive) |
|------|--------|-----------------|-------------------|
| Railway | `railway --version` | Set `RAILWAY_API_TOKEN` in [Cloud Agents → Secrets](https://cursor.com/dashboard/cloud-agents) | `railway login` |
| Supabase | `supabase --version` | Set `SUPABASE_ACCESS_TOKEN` in Secrets ([create token](https://supabase.com/dashboard/account/tokens)) | `supabase login` |

**Railway common commands:**
```bash
railway whoami --json          # verify auth
railway status --json          # linked project/env/service
railway up --detach            # deploy cwd
railway logs --lines 200       # recent logs
railway variable list --json   # env vars
```

**Supabase common commands:**
```bash
supabase projects list                    # hosted projects
supabase link --project-ref <ref>         # link hosted project
supabase db push                          # apply migrations to linked project
supabase migration list                   # local migration status
supabase start                            # local Docker stack (see below)
supabase status                           # local keys/URLs
```

**MCP servers** (configured in `.mcp.json`):
- **Supabase** — `https://mcp.supabase.com/mcp` (OAuth; complete auth in the agent session)
- **Railway** — installed by `railway setup agent` (local `railway mcp` stdio server; also available remotely at `https://mcp.railway.com`)

For hosted Supabase work, prefer linking the project (`supabase link`) or using the Supabase MCP `execute_sql` tool. For schema changes committed to git, use `supabase migration new <name>` then `supabase db push`.

### Local Supabase is required (biggest gotcha)

Both processes talk to Supabase via `lib/supabase.js` (`SUPABASE_URL` + `SUPABASE_KEY`). The dashboard's `/login` and every data page query Postgres, so nothing meaningful works without a database. Use the local Supabase CLI stack:

1. Start the Docker daemon (systemd is not available here, so start it manually):
   ```bash
   sudo dockerd >/tmp/dockerd.log 2>&1 &
   sudo chmod 666 /var/run/docker.sock   # let the `ubuntu` user reach the daemon
   ```
2. Start Supabase (applies `supabase/migrations/*` automatically, then `supabase/seed.sql`):
   ```bash
   cd /workspace && supabase start
   ```
   API: `http://127.0.0.1:54321` · Postgres: `127.0.0.1:54322` · Studio: `http://127.0.0.1:54323`.
   Get keys any time with `supabase status`.

**Non-obvious DB grant issue:** the local Postgres image does NOT auto-grant `SELECT/INSERT/UPDATE/DELETE` on public tables to the `anon`/`authenticated`/`service_role` roles the way hosted Supabase does, so the app otherwise fails with `permission denied for table ...`. `supabase/seed.sql` fixes this and is applied automatically by `supabase start` / `supabase db reset`. If you ever see a permission-denied error, re-apply it manually:
```bash
docker exec -i supabase_db_workspace psql -U postgres -d postgres < supabase/seed.sql
```

### `.env` (gitignored — recreate if missing)

`settings.js` loads config via `dotenv`. `.env` is gitignored, so create it if absent. Minimum for the dashboard (the local Supabase keys below are the standard deterministic CLI demo keys — the `service_role` key bypasses RLS):

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<service_role key from `supabase status`>
PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
SESSION_SECRET=dev-local-session-secret-change-me
```

Dashboard login uses the `Admin` table first, then falls back to `ADMIN_USERNAME`/`ADMIN_PASSWORD` when no matching admin row exists — so `admin` / `admin123` works on a fresh DB.

### Running the Telegram bot

`index.js` needs a real bot token to poll Telegram. With an empty `TOKEN_BOT` it still boots and connects to Supabase fine, but logs `EFATAL: Telegram Bot Token not provided!` polling errors. To exercise the bot end-to-end, set `TOKEN_BOT` (from @BotFather) and `OWNER_ID` in `.env`. The **dashboard runs fully without any Telegram token**, so use it for most dev/testing.

### Optional integrations

`Pakasir` payment gateway (`pakasir.js`) is optional (unit-tested with a mocked HTTP client) and only needed for top-up/checkout flows.
