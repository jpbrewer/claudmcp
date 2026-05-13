# claudmcp

Remote MCP server that wraps merchant-stack APIs (Stamped.io in Phase 1, ShipperHQ next) and exposes them as MCP tools for [Cowork](https://cowork.app) to consume from chat and inside artifacts.

Stateless Next.js (App Router, TypeScript) deployed to Vercel. Bearer-auth on every request. No database.

- **Design brief:** [prompts/agent-backend-plan-v2.md](prompts/agent-backend-plan-v2.md)
- **Execution plan:** [plans/phase-1-plan.md](plans/phase-1-plan.md)

## Phase 1 tools

| Tool | Description |
| --- | --- |
| `list_pending_reviews` | Stamped reviews with no merchant reply yet |
| `get_review` | Fetch a single Stamped review by id |
| `post_reply` | Post a merchant reply (public or private, with/without email) |
| `get_brand_values` | Return the brand voice + reply rules from `content/values.md` |
| `get_artifact_template` | Return a canonical Cowork artifact HTML (default: Stamped review queue) to use as a starting basis |

## Prerequisites

- Node.js 20+
- Stamped.io public + private API keys and store hash (Stamped dashboard → Settings → API Keys)
- A 32+ byte random bearer token for Cowork ↔ MCP auth

## Local development

```bash
npm install
cp .env.example .env.local
# Fill .env.local with real values:
#   COWORK_MCP_TOKEN=$(openssl rand -hex 32)
#   STAMPED_PUBLIC_KEY=...
#   STAMPED_PRIVATE_KEY=...
#   STAMPED_STORE_HASH=...
npm run dev
```

The MCP endpoint is `http://localhost:3000/api/mcp`. Hit it from the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
# Server URL: http://localhost:3000/api/mcp
# Header:     Authorization: Bearer <COWORK_MCP_TOKEN>
```

## Environment variables

| Variable | Where used | Notes |
| --- | --- | --- |
| `COWORK_MCP_TOKEN` | `lib/auth.ts` | Bearer token Cowork sends on every request. Generate with `openssl rand -hex 32`. |
| `STAMPED_PUBLIC_KEY` | `lib/stamped.ts` | Stamped API username (Basic Auth). |
| `STAMPED_PRIVATE_KEY` | `lib/stamped.ts` | Stamped API password (Basic Auth). |
| `STAMPED_STORE_HASH` | `lib/stamped.ts` | Stamped store hash, used in URL path. |

Set the real values in Vercel → Project Settings → Environment Variables (Production + Preview). Use `.env.local` for local dev. Never commit real values — `.env*` is gitignored (with `!.env.example` as the override).

## Tests

```bash
npm test            # vitest run
npm run test:watch  # vitest in watch mode
```

Unit tests cover bearer-token verification and the Stamped REST client (with mocked `fetch`). The MCP protocol layer is exercised manually via the Inspector.

## Deploy

The Vercel project at `jpbrewer/claudmcp` is already linked to this repo. To deploy:

1. Paste the env vars above into Vercel → Project Settings → Environment Variables (Production *and* Preview).
2. Push to `main` — Vercel auto-deploys.
3. Once live, register in Cowork → Settings → MCP Servers with URL `https://<project>.vercel.app/api/mcp` and the same bearer token.

## Project layout

```
app/api/[transport]/route.ts   MCP route + all tool definitions
lib/
  auth.ts                      Bearer-token verifier (used by withMcpAuth)
  stamped.ts                   Stamped REST client (Basic Auth, 429 retry)
  kb.ts                        Reads content/values.md
content/values.md              Brand voice + reply rules
tests/                         Vitest unit tests
prompts/                       Project briefs
plans/                         Execution plans
```

## Out of scope (Phase 1)

DB, multi-tenant auth, cron jobs, a frontend. See [the plan](plans/phase-1-plan.md) for the full list.
