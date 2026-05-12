# Agent Backend — Project Plan (v2)

A remote MCP server, deployed on Vercel, that wraps merchant-stack APIs (Stamped.io first, ShipperHQ next, more later) and exposes them as MCP tools for Cowork to consume in chat and inside Cowork artifacts.

This document is the project brief. Hand it to Claude Code at the start of the first session and treat it as the source of truth for scope and architecture until we explicitly amend it.

**What's new in v2:** The Stamped reply endpoint has been verified by hand (URL, payload, auth, response shape). Section 7's `post_reply` spec is now concrete, and section 14's "verify the endpoint" item has been retired. Implement against the verified spec — do not re-verify.

---

## 1. Mission

Build a single Next.js app, deployed to Vercel, that:

1. Speaks MCP over Streamable HTTP at a single URL (e.g. `https://<project>.vercel.app/api/mcp`).
2. Exposes one tool per external API operation we care about (list, fetch, post, etc.).
3. Authenticates incoming MCP requests with a shared bearer token (single-user setup; one token; rotate when needed).
4. Stores all upstream API credentials (Stamped keys, ShipperHQ keys, etc.) as Vercel environment variables — never in code, never returned to the client.
5. Stays stateless in v1. No database. Add one later (Vercel Postgres or Neon) only if a feature actually needs it.

The Cowork side will use this MCP server in two ways:
- **Chat:** Claude in Cowork can call any tool directly when the conversation calls for it.
- **Artifacts:** Cowork artifacts can call tools via `window.cowork.callMcpTool(name, args)` to power persistent UIs like the review-reply queue and the shipping-rate calculator.

This is intended as a **hub for many integrations**, not a one-trick server. Stamped first because we need to ship something end-to-end. ShipperHQ second. Each new integration is a new client file + new tool definitions in the same project. Sequencing is single-integration; architecture is multi-integration.

---

## 2. Architecture

```
Cowork (desktop or web)
   ├── chat ── calls MCP tools
   └── artifacts ── window.cowork.callMcpTool(...)
                          │
                          ▼
        https://<project>.vercel.app/api/mcp
                          │
                  Next.js App Router route
                  (uses `mcp-handler` from Vercel)
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   Stamped.io        ShipperHQ        (future APIs)
```

Vercel Functions (serverless) handle the route. The MCP server is stateless: every request authenticates via bearer, dispatches to the right upstream API, returns the response.

The knowledge base (brand voice / reply rules) lives as `content/values.md` committed to the repo. It's served as a tool response so the artifact can fetch it on load and pass it into `window.cowork.askClaude()` when drafting replies. Updating the values doc is a git commit — no redeploy of the artifact needed.

---

## 3. Stack

- **Framework:** Next.js (App Router) — Vercel's first-class deploy target.
- **Language:** TypeScript.
- **MCP adapter:** `mcp-handler` (the package formerly known as `@vercel/mcp-adapter`).
  - Repo: https://github.com/vercel/mcp-handler
  - **Action for Claude Code:** read this repo's README before scaffolding. The API surface has changed; trust the current README over any older blog post.
- **HTTP client:** native `fetch` (Vercel runtime supports it). No need for axios.
- **Validation:** `zod` for tool input schemas.
- **Testing:** `vitest` for unit tests on the API clients. MCP protocol can be tested manually with the MCP Inspector (`npx @modelcontextprotocol/inspector`).

---

## 4. Repository layout

```
agent-backend/
├── app/
│   └── api/
│       └── mcp/
│           └── route.ts          # The MCP handler — all tool definitions live here
├── lib/
│   ├── auth.ts                   # Bearer-token validation
│   ├── stamped.ts                # Stamped API client (typed wrapper)
│   ├── shipperhq.ts              # (Phase 2)
│   └── kb.ts                     # Reads content/values.md at build/runtime
├── content/
│   └── values.md                 # Brand voice + reply rules. Edit freely.
├── tests/
│   ├── stamped.test.ts
│   └── auth.test.ts
├── .env.example                  # Documents every required env var
├── .env.local                    # Gitignored; for local dev
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.mjs
├── README.md
└── PLAN.md                       # This file
```

---

## 5. Authentication (Cowork → MCP server)

Single shared bearer token. Cowork sends it on every request:

```
Authorization: Bearer <COWORK_MCP_TOKEN>
```

`lib/auth.ts` reads the expected token from `process.env.COWORK_MCP_TOKEN` and rejects any request that doesn't match. Constant-time comparison, 401 on mismatch.

Token generation: any 32+ byte random string. Generate once locally (`openssl rand -hex 32`), paste into Vercel env vars, paste into Cowork's MCP settings. Rotate by generating a new one and updating both sides.

Do **not** roll OAuth in v1. Single user, single token is fine. If the project ever serves more than one Cowork user, revisit.

---

## 6. Environment variables

Document everything in `.env.example`:

```
# Cowork ↔ MCP auth
COWORK_MCP_TOKEN=

# Stamped.io (verified)
STAMPED_PUBLIC_KEY=
STAMPED_PRIVATE_KEY=
STAMPED_STORE_HASH=          # required. Find in Stamped dashboard → Settings → API Keys.

# (Phase 2) ShipperHQ
SHIPPERHQ_API_KEY=
SHIPPERHQ_API_TOKEN=
```

Set the real values in Vercel's project settings → Environment Variables. Use `.env.local` for local dev. Never commit real values.

---

## 7. Phase 1 scope — Stamped.io tools only

Build these four tools. Nothing else. Resist scope creep.

### `list_pending_reviews`

- **Input:** `{ limit?: number (default 20), since?: ISO date string }`
- **Behavior:** Calls Stamped's reviews-list endpoint, filters to reviews that don't have a merchant reply yet, returns them.
- **Endpoint base (verified):** `https://stamped.io/api/v2/{STAMPED_STORE_HASH}/dashboard/reviews` with Basic Auth.
- **Output shape:**
  ```ts
  { reviews: Array<{
      id: string,
      author: string,
      authorEmail?: string,
      rating: number,        // 1–5
      title: string,
      body: string,
      productName?: string,
      productId?: string,
      createdAt: string      // ISO
  }> }
  ```
- **Note for Claude Code:** Confirm pagination shape (query params for page/cursor/offset — Stamped's docs are thin) by hitting the endpoint once with curl and inspecting. Webhook payloads show each review object includes `reviewReply` and `dateReplied` fields — verify the list endpoint exposes the same so you can filter to unanswered reviews. If server-side filtering isn't available, filter client-side after fetch.

### `get_review`

- **Input:** `{ id: string }`
- **Behavior:** Fetch a single review by id. Useful if a tool consumer (chat) wants to drill in.
- **Output:** same single-review shape as above.

### `post_reply` (verified)

- **Input:**
  ```ts
  {
    reviewId: string,           // e.g. "52148110"
    message: string,            // reply text
    isPrivate?: boolean,        // default false. true = do NOT display on storefront
    notifyByEmail?: boolean     // default true.  true = email the customer
  }
  ```
- **Behavior:** POSTs to this verified (undocumented but stable) endpoint:
  ```
  POST https://stamped.io/api/v2/{STAMPED_STORE_HASH}/dashboard/reviews/{reviewId}/reply
       ?isPrivate={isPrivate}&isEmail={notifyByEmail}
  Headers:  Content-Type: application/json
            Authorization: Basic <base64(STAMPED_PUBLIC_KEY:STAMPED_PRIVATE_KEY)>
  Body:     { "reply": "<message>" }
  ```
- **Output:** `{ ok: boolean, message: string }`
- **Verified response shape:** Stamped returns the reply text echoed back as a bare JSON string (e.g. `"thanks for the review!"`). No reply id, no timestamp. Treat a 200 with an echoed body matching the input as success.
- **Notes:**
  - This endpoint is **undocumented** in Stamped's public REST API docs. It was verified by capturing the dashboard's network call (which authenticates via session cookie) and confirming the same URL accepts Basic Auth with the public+private API keys. Behavior could change without notice — file an issue if it breaks, and consider emailing Stamped support to ask them to document it.
  - The dashboard SPA passes `isEmail=undefined` as a literal string when unchecked. Don't replicate that — always pass `true` or `false` explicitly.
  - For a "normal" public merchant reply that emails the customer: `isPrivate=false, notifyByEmail=true`.

### `get_brand_values`

- **Input:** none
- **Behavior:** Returns the contents of `content/values.md` as a string. Lets the artifact embed the current values doc in `askClaude` prompts without hardcoding it.
- **Output:** `{ markdown: string, updatedAt: string }` (use the file's mtime or commit timestamp)

---

## 8. Knowledge base (values.md)

Skeleton to commit on day one. Fill in real content during/after first review pass.

```markdown
# <Brand> — Voice & Reply Rules

## Tone
Warm, conversational, plainspoken. No corporate hedging.
Short paragraphs. Contractions are fine.

## Always
- Thank the reviewer by first name.
- Sign off as: — The <Brand> Team

## For praise
- Express gratitude.
- Reference one specific thing they mentioned.

## For complaints
- Acknowledge the problem directly. No "we're sorry you feel that way."
- Take responsibility where appropriate.
- Offer a concrete next step: replacement, refund, or follow-up at support@<brand>.example.

## Don'ts
- Don't offer refunds above $50 without escalation.
- Don't argue with the reviewer publicly.
- Don't reveal internal processes.

## Length
Under 100 words. Two short paragraphs at most.
```

---

## 9. Local development workflow

1. `npm install`
2. `cp .env.example .env.local` and fill in real values (use test Stamped credentials if available; otherwise be careful not to send replies during dev — use `isPrivate=true` for any test reply).
3. `npm run dev` — Next.js dev server on `http://localhost:3000`.
4. In a separate terminal: `npx @modelcontextprotocol/inspector` and point it at `http://localhost:3000/api/mcp` with the bearer header set. Confirm tools list, call each tool with sample input.
5. Write Vitest tests for the Stamped API client (`lib/stamped.ts`) using mocked `fetch`. Don't unit-test the MCP plumbing — Inspector covers it.

---

## 10. Deployment workflow

One-time setup:
1. Push the repo to GitHub.
2. In Vercel dashboard: "Add New → Project" → select the GitHub repo → accept defaults.
3. In Vercel project settings → Environment Variables: paste every var from `.env.example` with real values. Apply to Production *and* Preview (so PR previews work).
4. Trigger first deploy.

Per-change:
1. Make changes locally, commit, push.
2. Vercel auto-deploys (production for `main` branch, preview for any other branch / PR).
3. Test the preview URL with MCP Inspector before merging to `main`.

---

## 11. Cowork registration (one-time, on the Cowork side)

Once the Vercel deploy is live:

1. In Cowork → Settings → MCP Servers → Add Remote Server.
2. URL: `https://<project>.vercel.app/api/mcp`
3. Auth header: `Authorization: Bearer <COWORK_MCP_TOKEN>`
4. Save. Cowork should detect the tools listed by the server (`list_pending_reviews`, `get_review`, `post_reply`, `get_brand_values`).

Sanity check from chat: ask Claude in Cowork "list pending Stamped reviews" — it should call `list_pending_reviews` and return them. If that works end-to-end, the plumbing is good.

---

## 12. Acceptance criteria for Phase 1

- [ ] `npm run dev` works and Inspector can list all 4 tools.
- [ ] `list_pending_reviews` returns real, unanswered reviews from the live Stamped account.
- [ ] `post_reply` successfully posts a reply (test with `isPrivate=true` first, then delete the test reply from the Stamped dashboard).
- [ ] `get_brand_values` returns the markdown content of `content/values.md`.
- [ ] Bearer auth rejects requests with a missing or wrong token (return 401, never 500).
- [ ] Deployed at production URL on Vercel.
- [ ] Registered in Cowork; tools callable from chat.
- [ ] Tests pass: `npm test`.

When all eight check, Phase 1 ships. We then build the Cowork artifact (review queue UI) as a separate piece of work that consumes these tools.

---

## 13. Phase 2 preview — ShipperHQ

Same pattern, new tools. Probably:

- `quote_shipping_rates({ from: ZIP, to: ZIP, weightLbs, lengthIn, widthIn, heightIn })` — returns array of rates across configured carriers.
- `list_saved_boxes()` — preset SKU box dimensions (would need a tiny DB; defer until needed).

Adding ShipperHQ means: a new `lib/shipperhq.ts` client, new tool definitions in `app/api/mcp/route.ts`, new env vars in `.env.example` and Vercel. The existing auth, deploy, and registration infrastructure doesn't change.

---

## 14. Decisions for Claude Code to confirm before coding

1. **Stamped reviews-list endpoint shape.** Verified base is `https://stamped.io/api/v2/{storeHash}/dashboard/reviews`, Basic Auth with public+private keys. Confirm the exact query params for filtering and pagination by hitting it once from curl and inspecting the response shape — don't rely on docs alone, they're thin.
2. **Pagination.** Does the reviews-list endpoint paginate? If so, `list_pending_reviews` should accept a `cursor` (or `page` / `offset`, whatever Stamped uses) and surface it in output.
3. **Filtering for "unanswered."** The webhook payload shows `reviewReply` and `dateReplied` on each review object. Confirm whether the list endpoint exposes these too, and whether server-side filtering exists. Otherwise, filter client-side after fetching.
4. **`mcp-handler` v current.** Check the README on the day of building — the exported APIs (`createMcpHandler` vs. other names) have changed over versions.
5. **Rate limits.** Note Stamped's rate limit and add a basic retry-on-429 in the client.

Verified during planning (don't re-litigate):
- Reply endpoint: `POST https://stamped.io/api/v2/{storeHash}/dashboard/reviews/{reviewId}/reply?isPrivate=<bool>&isEmail=<bool>` with body `{ "reply": "<text>" }`, Basic Auth via public+private keys. Response is the reply text echoed back as a JSON string. Endpoint is undocumented but works.

Surface remaining questions as the first thing in the first Claude Code session — don't guess.

---

## 15. Out of scope (explicitly)

- Persistence / database
- Multi-tenant or multi-user auth
- Background workers / cron polling (no laptop-was-on issue when Vercel hosts)
- A frontend in this repo (Cowork artifacts are separate)
- Anything beyond the four tools above

If a temptation to add scope comes up, write it down in a `BACKLOG.md` and keep going.

---

## 16. References

- Vercel MCP docs: https://vercel.com/docs/mcp
- Deploy MCP servers to Vercel: https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel
- `mcp-handler` GitHub: https://github.com/vercel/mcp-handler
- MCP spec: https://modelcontextprotocol.io
- MCP Inspector: https://github.com/modelcontextprotocol/inspector
- Stamped.io REST API help article: https://stampedsupport.stamped.io/hc/en-us/articles/10152777765659-Stamped-REST-API
- Stamped.io Webhooks (shows review schema): https://stampedsupport.stamped.io/hc/en-us/articles/10152800778395-Webhooks
- ShipperHQ developer docs: https://shipperhq.com/docs (verify current URL)
