# Plan — Agent Backend (Phase 1, Stamped tools)

## Context

Build a stateless remote MCP server on Vercel that exposes Stamped.io merchant-API operations as MCP tools, consumable by Cowork (chat + artifacts). Source of truth: [prompts/agent-backend-plan-v2.md](../prompts/agent-backend-plan-v2.md). Phase 1 ships four tools: `list_pending_reviews`, `get_review`, `post_reply`, `get_brand_values`. The v2 brief verified the (undocumented) reply endpoint; the list-reviews shape still needs a one-shot curl probe during implementation.

The local repo `claudmcp/` is already initialised, branch `main`, remote pointed at `https://github.com/jpbrewer/claudmcp.git`. No code yet.

---

## Decisions (locked in)

1. **Project root.** Next.js app at the **root of `claudmcp/`** — no `agent-backend/` subfolder.
2. **Brand.** Transoms Direct. Sign-off `— The TD Team`. Support email `sales@transomsdirect.com`. Baked into `content/values.md` at commit time (no `<Brand>` placeholders).
3. **Setup state.** Stamped public/private keys + storeHash in hand; Vercel project for `jpbrewer/claudmcp` already exists; a test review the user owns (id `52148110`) is available to exercise all four tools end-to-end. No separate sandbox store, but the owned review covers list / get / reply paths safely.
4. **Curl probe authorised.** I will hit `GET https://stamped.io/api/v2/{storeHash}/dashboard/reviews` once during step 5 with real credentials to lock down pagination + response shape before writing the Stamped client. Read-only.

---

## Approach summary

Single Next.js (App Router, TypeScript) project at repo root. One MCP route at `app/api/mcp/route.ts`. Bearer auth via `mcp-handler`'s built-in `withMcpAuth` wrapper, validating against `COWORK_MCP_TOKEN`. Per-API client modules under `lib/`. Stateless: no Redis, no DB. Vitest for unit tests on the Stamped client (mocked `fetch`). MCP Inspector for protocol-level smoke tests.

**Verified externals (don't re-research):**
- `mcp-handler@^1.1.0` + `@modelcontextprotocol/sdk@^1.26.0` (SDK ≥1.26.0 required — earlier had a vuln). Import: `createMcpRouteHandler` (the brief's older `createMcpHandler` reference is stale). Auth: wrap handler with `withMcpAuth`. Tools defined via `server.tool(name, desc, zodShape, async handler)`. Export `{ handler as GET, handler as POST }`. Omit `redisUrl` for stateless mode.
- Stamped reply endpoint: `POST https://stamped.io/api/v2/{storeHash}/dashboard/reviews/{reviewId}/reply?isPrivate=<bool>&isEmail=<bool>` with body `{ "reply": "<text>" }` and Basic Auth `public:private`. Response: reply text echoed back as a bare JSON string. Per v2 §7 + §14.

---

## Repository layout (at root of `claudmcp/`)

```
claudmcp/
├── app/api/mcp/route.ts        # MCP route + all tool definitions
├── lib/
│   ├── auth.ts                 # Bearer-token verifier (passed to withMcpAuth)
│   ├── stamped.ts              # Stamped REST client (typed)
│   └── kb.ts                   # Reads content/values.md
├── content/values.md           # Brand voice + reply rules
├── tests/
│   ├── stamped.test.ts         # Unit tests, mocked fetch
│   └── auth.test.ts            # Token compare, 401 path
├── prompts/                    # Already exists; planning docs
├── plans/                      # This plan + future plans
├── .env.example
├── .env.local                  # gitignored
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.mjs
├── vitest.config.ts
└── README.md                   # Short: setup, dev, deploy. Link to plan + brief.
```

---

## Implementation steps (execution order)

0. **Persist this plan into the repo.** Create `claudmcp/plans/` and copy the accepted plan there as `claudmcp/plans/phase-1-plan.md` so it sits alongside `prompts/agent-backend-plan-v2.md` and is version-controlled with the code.

1. **Scaffold Next.js + TypeScript.** `npx create-next-app@latest .` with App Router, TS, no Tailwind, no `src/`, no ESLint customisation beyond defaults. Strip the example landing page (`app/page.tsx` → minimal placeholder or delete). Confirm `npm run dev` boots.

2. **Add deps.** `mcp-handler`, `@modelcontextprotocol/sdk@^1.26.0`, `zod`. Dev: `vitest`, `@types/node` (if not already), `tsx` (optional, for ad-hoc scripts).

3. **`.env.example` + `.env.local`.** Populate from v2 §6 (COWORK_MCP_TOKEN, STAMPED_PUBLIC_KEY, STAMPED_PRIVATE_KEY, STAMPED_STORE_HASH; ShipperHQ keys commented out as Phase 2). `.gitignore` already excludes `.env.local` via Next.js defaults — verify.

4. **`lib/auth.ts`.** Export `verifyToken(token: string)` for `withMcpAuth`. Constant-time compare against `process.env.COWORK_MCP_TOKEN`. Returns the auth-info object on success, null on mismatch. Throws if env var is unset (fail-loud on misconfig).

5. **`lib/stamped.ts`.** Typed client with:
   - `listReviews({ limit, since, cursor? })` → calls `GET /api/v2/{storeHash}/dashboard/reviews` with Basic Auth. **First step in implementation: hit endpoint with curl once to lock down pagination param + response shape.** Maps Stamped's response to the brief's output shape. Filters unanswered (`!reviewReply` / no `dateReplied`) — server-side via query if available, else client-side after fetch.
   - `getReview(id)` → if Stamped exposes a single-review endpoint, use it; otherwise fetch list and filter (acceptable for v1).
   - `postReply({ reviewId, message, isPrivate=false, notifyByEmail=true })` → POSTs per v2 §7 verified spec. Always passes `isPrivate` and `isEmail` as explicit booleans (no `undefined` string). Returns `{ ok, message }` where `ok = response status 200 && body matches input`.
   - Internal `request()` helper: Basic Auth header from env, `Content-Type: application/json`, retry-on-429 with `Retry-After` honouring (single retry, then surface error). Throws typed errors that the route can convert to MCP tool errors.

6. **`lib/kb.ts`.** `readBrandValues()` returns `{ markdown, updatedAt }`. Reads `content/values.md` via `fs/promises` (Node runtime — safe on Vercel functions). `updatedAt` = file's mtime ISO. No build-time inlining; runtime read is fine and stays current with hot edits in dev.

7. **`content/values.md`.** Commit the v2 §8 skeleton with real Transoms Direct values substituted: brand = "Transoms Direct", sign-off = `— The TD Team`, support email = `sales@transomsdirect.com`. All other rules (tone, length, don'ts) carry over from the skeleton verbatim — user will edit later if needed.

8. **`app/api/mcp/route.ts`.** The MCP entry point. Skeleton:
   ```ts
   import { createMcpRouteHandler, withMcpAuth } from 'mcp-handler';
   import { z } from 'zod';
   import { verifyToken } from '@/lib/auth';
   import * as stamped from '@/lib/stamped';
   import { readBrandValues } from '@/lib/kb';

   const handler = createMcpRouteHandler(
     (server) => {
       server.tool('list_pending_reviews', '...desc...',
         { limit: z.number().int().positive().max(100).optional(),
           since: z.string().datetime().optional() },
         async (input) => ({ content: [{ type: 'text',
           text: JSON.stringify(await stamped.listPending(input)) }] }));
       server.tool('get_review', '...', { id: z.string() },
         async ({ id }) => ({ content: [{ type: 'text',
           text: JSON.stringify(await stamped.getReview(id)) }] }));
       server.tool('post_reply', '...',
         { reviewId: z.string(), message: z.string().min(1),
           isPrivate: z.boolean().optional(),
           notifyByEmail: z.boolean().optional() },
         async (input) => ({ content: [{ type: 'text',
           text: JSON.stringify(await stamped.postReply(input)) }] }));
       server.tool('get_brand_values', '...', {},
         async () => ({ content: [{ type: 'text',
           text: JSON.stringify(await readBrandValues()) }] }));
     },
     { capabilities: {} },
     { basePath: '/api/mcp' }
   );

   const authed = withMcpAuth(handler, {
     required: true,
     verifyToken: async (token) => verifyToken(token),
   });

   export { authed as GET, authed as POST };
   ```
   Tool descriptions need to be specific enough for Claude (in Cowork) to pick the right tool from chat — write them in plain language, mention the upstream system ("Stamped review …").

9. **Tests.**
   - `tests/auth.test.ts`: verifies `verifyToken` accepts correct token, rejects mismatch (constant-time path), throws when env unset.
   - `tests/stamped.test.ts`: mocks `fetch`, asserts URL/headers/body for each method, asserts unanswered filter, asserts 429 retry, asserts response mapping.
   - `package.json` scripts: `dev`, `build`, `start`, `test` (vitest), `test:watch`.

10. **Manual smoke test.** `npm run dev`, then `npx @modelcontextprotocol/inspector`. Add server: URL `http://localhost:3000/api/mcp`, header `Authorization: Bearer <token>`. Verify:
    - Tools list returns exactly 4.
    - `list_pending_reviews` with `{limit:5}` returns real reviews from the Transoms Direct store.
    - `get_review` with `id: "52148110"` returns the user-owned test review.
    - `post_reply` with `{ reviewId: "52148110", message: "test reply, please ignore", isPrivate: true, notifyByEmail: false }` returns `{ ok: true }`; confirm in Stamped dashboard; user deletes the test reply.
    - Then re-run `post_reply` with `isPrivate: false, notifyByEmail: false` (public reply, no email) for one final visible-replier sanity check on the same review; user deletes again.
    - `get_brand_values` returns the Transoms Direct values markdown.

11. **README.md.** ≤1 page: prerequisites (Node 20+, Stamped keys, Cowork token), local dev, env vars table, deploy summary, link back to `prompts/agent-backend-plan-v2.md` for full design.

12. **First commit.** Single commit "Phase 1: Stamped MCP server scaffold + 4 tools" — or split into 2–3 logical commits (scaffold; stamped client; mcp route + tests). Push to `origin/main` after you confirm.

13. **Deploy.** Vercel project for `jpbrewer/claudmcp` already exists, so the one-time setup in v2 §10 is mostly done. Remaining: paste real env vars (`COWORK_MCP_TOKEN`, `STAMPED_*`) into the Vercel project's Environment Variables for Production + Preview. Plan stops at "first commit pushed to `origin/main`" — the push itself I'll ask permission for; Vercel's auto-deploy you'll watch in the dashboard.

---

## Verification

End-to-end checks (matches v2 §12 acceptance criteria):

- `npm run dev` succeeds; `npm test` green.
- MCP Inspector lists exactly 4 tools (`list_pending_reviews`, `get_review`, `post_reply`, `get_brand_values`).
- `list_pending_reviews` returns real, unanswered reviews from the Transoms Direct store (sanity-check by cross-referencing the Stamped dashboard).
- `get_review` with `id: "52148110"` returns the user-owned test review.
- `post_reply` with `isPrivate=true` and review id `52148110` returns `{ ok: true }` AND the (private) reply is visible in the Stamped dashboard's review detail (then user deletes it).
- Inspector with the **wrong** bearer token returns 401 (not 500, not 200).
- `get_brand_values` returns the markdown text of `content/values.md` and a plausible `updatedAt`.

---

## Out of scope (re-stating v2 §15 for execution discipline)

DB, multi-tenant auth, cron jobs, any frontend, anything beyond the four tools. Temptations → `BACKLOG.md`.
