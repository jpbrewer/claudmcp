# Plan — Two Cowork Skills for claudmcp

## Context

Phase 1 of `claudmcp` is shipped (`origin/main`, deployed to https://claudmcp.vercel.app). Four MCP tools are live: `list_pending_reviews`, `get_review`, `post_reply`, `get_brand_values`. Through smoke-testing we learned that getting Cowork to consistently build a working artifact or run a clean reply-drafting workflow requires carefully-shaped prompts: handling the MCP envelope, declaring host-API fallbacks, baking brand-voice context, separating chat-fetch from artifact-render. We want to bottle that learning as **two reusable Cowork skills** so the user never has to hand-craft those prompts again.

Cowork auto-discovers skills from `~/.claude/skills/` (per the Anthropic format the user confirmed: each skill is a subdirectory containing `SKILL.md` with required YAML frontmatter — `name` matching dir name, `description` ≤ 1024 chars). No registration step; restart Cowork to pick them up.

---

## Decisions (locked in)

1. **Three skills:**
   - **`stamped-review-workflow`** (specific): Stamped-aware. Knows the 4 tool names, the brand-voice fetch pattern, the artifact + chat-only flows for review handling. Highest probability of working artifacts for review work.
   - **`claudmcp-artifact`** (generic): Generic playbook for building any Cowork artifact that consumes the `claudmcp` MCP server. Envelope-unwrap helper, host-API discovery helper, error-handling patterns — no assumption about which tool.
   - **`claude-skills-admin`** (meta): Dual-mode skill that manages the shared-skills folder itself. Admin mode (John) inventories/validates/scaffolds; self-onboarding mode (Harrison or any new user, post-install) verifies their setup and helps troubleshoot.

2. **Brand voice stays in the MCP repo.** `claudmcp/content/values.md` is the single source of truth, served via `get_brand_values`. Skills *never* hardcode brand name, sign-off, or rules — always fetch live. Editing the voice = git commit + push, ~30–60s Vercel redeploy.

3. **Reply composition happens in Cowork (Claude), not on the MCP server.** The server is a data layer (returns reviews, returns markdown, posts replies). Cowork's Claude reads the markdown as guidance, reads the review as context, and writes the draft. Skills tell Claude *how* to do this.

4. **Storage architecture — Dropbox source of truth with per-skill symlinks:**
   - Shared skills live in a Dropbox folder (canonical, synced across the user's machines and shareable to teammates).
   - Each user's `~/.claude/skills/` is a real directory containing per-skill symlinks for the shared skills they want, plus regular subdirectories for personal/dev skills (not synced).
   - This lets John develop a skill privately (`~/.claude/skills/dev-thing/`), promote it to shared when ready (`mv` into Dropbox + new symlink), and lets Harrison run an install script to receive only the shared ones — keeping his own personal skills separate.

---

## Execution order (high-level)

0. **Persist this plan into the claudmcp repo** as `claudmcp/plans/cowork-skills-plan.md` (alongside the existing `phase-1-plan.md`) so it's version-controlled with the rest of the project.
1. Create the shared Dropbox folder and its three skill subdirectories.
2. Write each `SKILL.md` per the specs below.
3. Write `install.sh` (executable) in the shared folder.
4. Generate an initial `ONBOARDING.md` (by hand for this first time — claude-skills-admin will own future regenerations).
5. Run `install.sh` on this machine to create the three symlinks under `~/.claude/skills/`.
6. Restart Cowork (you'll do this manually) and run the verification checks at the bottom of this plan.

---

## Storage layout

```
/Users/john/Business Dropbox/Transoms Common/claude-skills-shared/                    ← canonical, Dropbox-synced
├── stamped-review-workflow/
│   └── SKILL.md
├── claudmcp-artifact/
│   └── SKILL.md
├── claude-skills-admin/
│   └── SKILL.md
├── ONBOARDING.md                                  ← human-readable setup doc (managed by claude-skills-admin)
└── install.sh                                     ← idempotent symlinker

~/.claude/skills/                                  ← real dir on each machine
├── stamped-review-workflow  ─symlink─►  shared/stamped-review-workflow
├── claudmcp-artifact        ─symlink─►  shared/claudmcp-artifact
├── claude-skills-admin      ─symlink─►  shared/claude-skills-admin
└── <user's personal skills>/                      ← regular dirs, NOT synced
    └── SKILL.md
```

**Dropbox setup notes (to include as comments in `install.sh`):**
- Set the `claude-skills-shared` folder to "Available offline" / "Local" — Smart Sync online-only files will break Cowork's discovery.
- Avoid simultaneous edits across machines (Dropbox creates "(conflicted copy)" files that confuse Cowork).
- When a new shared skill is added, each user re-runs `install.sh` to pick it up.
- Restart Cowork after running `install.sh` for the first time.

---

## `install.sh` (in the shared folder)

```bash
#!/usr/bin/env bash
# Idempotent symlinker: links every shared skill in this folder into
# ~/.claude/skills/. Skips any name that already exists locally so
# personal/dev skills with the same name aren't clobbered.
set -euo pipefail
SHARED="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL="$HOME/.claude/skills"
mkdir -p "$LOCAL"
for dir in "$SHARED"/*/; do
  name="$(basename "$dir")"
  target="$LOCAL/$name"
  if [ -e "$target" ] || [ -L "$target" ]; then
    echo "skip   $name (already present)"
  else
    ln -s "$dir" "$target"
    echo "linked $name"
  fi
done
echo "Restart Cowork (or open a new session) to load new skills."
```

---

## Skill A — `stamped-review-workflow`

**Frontmatter:**
```yaml
---
name: stamped-review-workflow
description: Use this when the user wants to work with Stamped.io product reviews via the claudmcp MCP server — listing pending reviews, drafting on-brand replies, posting replies, or fetching brand-voice rules. Triggers on mentions of Stamped, pending reviews, review replies, or the Transoms Direct brand voice.
---
```

**Body (~700–900 words):**

1. **What this skill does.** Stamped review workflows: list pending reviews, draft on-brand replies, post replies, fetch brand values. Use for both chat-only flows and artifact builds.

2. **MCP server context.** Endpoint `https://claudmcp.vercel.app/api/mcp`. Bearer auth already configured client-side. The server is registered in Cowork as `my-vercel-server`, so tool names are namespaced as `mcp__my-vercel-server__<tool>`.

3. **Tool catalog (verified response shapes):**
   - `list_pending_reviews({ limit?: number, since?: ISO string })` → `{ reviews: Review[], scannedPages, totalReviewsInStore }`. **Cap warning:** scans first 500 most-recent reviews; older backlog is invisible.
   - `get_review({ id: string })` → single `Review` object (flat, not nested).
   - `post_reply({ reviewId, message, isPrivate?, notifyByEmail? })` → `{ ok: true, message }`. Defaults: `isPrivate=false`, `notifyByEmail=true`.
   - `get_brand_values({})` → `{ markdown, updatedAt }`. Markdown contains tone, sign-off, do/don't rules.
   - `Review` shape: `{ id, author, authorEmail?, rating, title, body, productName?, productId?, createdAt, hasReply, replyText?, repliedAt?, isPublicReply? }`.

4. **Critical: MCP envelope unwrap.** Every tool response in artifacts is wrapped as `{ content: [{ type: "text", text: "<JSON string>" }] }`. Always parse `response.content[0].text` as JSON. Fallback chain: `raw.reviews` → `raw.result?.reviews` → `raw.content[0].text` parsed. (Chat-side, Claude reads the text directly; no manual unwrap needed.)

5. **Artifact-build playbook:**
   - Use namespaced tool name `mcp__my-vercel-server__list_pending_reviews`.
   - Always unwrap the envelope.
   - Host-API discovery for tool calls: try `window.cowork.callMcpTool` → `window.claude.callMcpTool` → `window.host.callMcpTool` → `window.callMcpTool`.
   - For "Draft reply" buttons:
     1. Call `get_brand_values` once; cache the markdown for the artifact's lifetime.
     2. Try `window.cowork.askClaude` / `window.host.askClaude` / `window.askClaude`. Pass the brand markdown as a leading instruction block (treat as system-level guidance), then the review's author, rating, title, body. Constrain: "Write a reply under 100 words that obeys every rule in the brand voice document above."
     3. Fallback when no askClaude exists: build a template draft — greeting (`"Hi <FirstName>,"`), one acknowledgment sentence keyed off rating (≥4 → thank + reference one thing said; ≤3 → acknowledge concern + offer support@-email from the doc), then the exact sign-off line pulled from the markdown.
   - Reply UI: prefilled textarea + isPrivate checkbox (off by default) + email-customer checkbox (on by default) + Send button.
   - On post success: replace card with "✓ Reply posted" and remove from queue.
   - HTML-decode review titles/bodies once (Stamped sometimes double-encodes).
   - Sort `createdAt` descending defensively.
   - Empty state: "All caught up — no pending reviews."

6. **Chat-only playbook (for when an artifact isn't wanted or isn't working):**
   - "Show me my pending reviews" → call `list_pending_reviews({ limit: 20 })`, render as a markdown table: Author, Rating, Product, Title, Body excerpt, Date.
   - "Draft a reply to review X":
     1. Call `get_review({ id: 'X' })`.
     2. Call `get_brand_values` (once-per-session, then cache).
     3. Compose a draft under 100 words that follows every rule in the brand markdown: tone, "Always" list, praise-vs-complaint branching, "Don'ts" list, exact sign-off line. Output inline in chat.
   - "Post that reply" → confirm with the user, then call `post_reply` with the drafted text. Default `isPrivate: false, notifyByEmail: true`.
   - Test posts: always use `isPrivate: true` and remind user to delete the test reply afterward.

7. **Brand-voice rule (applies everywhere).** Markdown returned by `get_brand_values` is the single source of truth for tone, sign-off, escalation thresholds, prohibited phrasings. Never invent a sign-off or tone — read it from the doc. Doc itself is editable at `claudmcp/content/values.md` (commit + push refreshes what the tool serves). Skills must *not* hardcode brand name, sign-off, or any rule — always fetch live.

8. **Known caveats.**
   - Cowork's artifact build pipeline has historically hung when the artifact declares `mcp_tools` metadata. If it hangs, drop that metadata and rely on host-API discovery at render time. If still hung, fall back to the chat-only flow.
   - Tool responses can be large (100 reviews ≈ 200KB). Prefer `limit: 20` for artifacts unless the user explicitly asks for more.

---

## Skill B — `claudmcp-artifact`

**Frontmatter:**
```yaml
---
name: claudmcp-artifact
description: Use this when the user wants to build a Cowork artifact that consumes their claudmcp MCP server (any tool, any layout). Provides the envelope-unwrap and host-API-discovery patterns that make claudmcp tools reliably callable from inside artifacts. Triggers on mentions of building an artifact with their MCP server.
---
```

**Body (~300–500 words):**

1. **What this skill does.** Generic playbook for any artifact that calls `claudmcp` MCP tools — regardless of which tool or layout. Not specific to Stamped or reviews. For Stamped-specific workflows, defer to `stamped-review-workflow`.

2. **MCP server identity.** Same endpoint and namespacing as `stamped-review-workflow`. For the full tool catalog, see that skill — this one assumes the consumer knows which tool to call.

3. **Envelope-unwrap helper (drop into any artifact verbatim):**
   ```js
   function unwrap(raw) {
     if (!raw) return null;
     if (raw.reviews) return raw;
     if (raw.result) return raw.result;
     if (raw.data) return raw.data;
     if (Array.isArray(raw.content)) {
       for (const part of raw.content) {
         if (part && typeof part.text === "string") {
           try { return JSON.parse(part.text); } catch {}
         }
       }
     }
     return raw;
   }
   ```

4. **Host-API caller helper (drop in verbatim):**
   ```js
   function getCaller() {
     const host = window.cowork || window.claude || window.host || {};
     if (typeof host.callMcpTool === "function") return (n,a) => host.callMcpTool(n,a);
     if (typeof window.callMcpTool === "function") return (n,a) => window.callMcpTool(n,a);
     return null;
   }
   ```

5. **Required artifact patterns.**
   - Always render a loading state, an error state (with raw `<pre>` dump on failure), and an empty state.
   - Always include a Refresh button that re-calls the tool.
   - Sort data defensively before rendering.
   - Cache rarely-changing reads (like `get_brand_values`) for the artifact's lifetime.

6. **Known failure modes (one-liners with fix):**
   - Build pipeline hangs → drop `mcp_tools` from artifact metadata; rely on host-API discovery at render time.
   - Response shows zero items despite chat saying otherwise → almost always envelope unwrap was skipped. Re-check `unwrap()` call.
   - `askClaude` unavailable → fall back to template logic; don't fail the whole artifact.
   - Tool response too large → reduce `limit` and add pagination (Refresh button).

---

## Skill C — `claude-skills-admin`

**Frontmatter:**
```yaml
---
name: claude-skills-admin
description: |
  Use this skill any time the user mentions managing, sharing, updating, distributing, installing, or troubleshooting Claude skills — especially the shared team skills in the claude-skills-shared Dropbox folder. Cast a wide net on triggers: "what shared skills do I have", "how do I add a new skill", "I added a skill, how do I update the team", "tell me what to send my team", "set me up with the team skills", "onboard a new teammate", "my skills aren't loading", "verify my skill setup", "create a new shared skill", "draft an announcement about a skill update", "what should I tell Harrison about the new skill", or anything else that sounds like skill admin or distribution. Two modes inside: admin (folder owner) and self-onboarding (new user / verification). Detect mode from user intent, don't require exact phrasing.
---
```

**Body (~500–700 words):**

1. **What this skill does.** Manages the shared-skills folder at `/Users/john/Business Dropbox/Transoms Common/claude-skills-shared/`. Has two modes that you should detect from the user's intent:
   - **Admin mode** (default for the folder owner): inventory, validation, regeneration, scaffolding.
   - **Self-onboarding mode** (when the user identifies as a new teammate or asks "set me up"): verify their local install matches the shared folder, diagnose problems, walk through restart.

2. **Locating the shared folder.** Resolve via the user's `~/.claude/skills/claude-skills-admin` symlink target — the parent directory is the shared folder. (Fallback: ask the user for the path if the symlink isn't there.)

3. **Intent detection** — when the user invokes this skill with a natural-language query, route to one of the operations below based on intent, not exact wording. Examples:
   - "what skills do I have" / "list my shared skills" → **Inventory**
   - "is my skills setup okay" / "check my skills" / "my skills aren't working" → **Validate** (admin) or **Verify local install** (self-onboarding)
   - "add a new skill called X" / "scaffold a new shared skill" → **Scaffold**
   - "I added a skill, what do I send the team" / "draft an update" / "how do I tell Harrison" / "how do I update the team" → **Update announcement**
   - "rewrite the onboarding doc" / "update ONBOARDING.md" → **Regenerate `ONBOARDING.md`**
   - "set me up" / "I'm new, help" → **Self-onboarding mode** (run verify, fix anything missing, walk through restart)
   If intent is ambiguous, ask one clarifying question. Don't refuse to act because the phrasing is loose.

4. **Admin mode operations:**
   - **Inventory**: list every subdirectory in the shared folder, read each `SKILL.md`'s frontmatter, output a table of `name` + `description` + `path`. Mention any folder that's missing a `SKILL.md`.
   - **Validate**: for each `SKILL.md`, check (a) valid YAML frontmatter, (b) `name` matches dir name exactly, (c) `description` present and ≤ 1024 chars, (d) no two skills share a `name`. Report problems with file paths and suggested fixes.
   - **Regenerate `install.sh`**: the current script (in the same folder) is dynamic — it auto-discovers every subdirectory. Usually nothing to do. If the script's behavior needs to change (new flags, additional checks), confirm with the user before overwriting.
   - **Regenerate `ONBOARDING.md`**: a human-readable doc for a new teammate. Includes (a) what they need (Dropbox access to the shared folder), (b) one-time setup commands, (c) what to expect after restart, (d) how to verify, (e) who to ask for help. Re-derive content from the live inventory so the list of skills stays accurate. Always ask before overwriting an existing `ONBOARDING.md`.
   - **Scaffold a new shared skill**: on request, create `<shared>/<new-name>/SKILL.md` with a frontmatter template and a "## What this skill does" header ready to fill in. Confirm the chosen name doesn't collide with an existing skill.
   - **Update announcement**: when the user wants to tell the team about a change, walk the shared folder, compare each skill's SKILL.md `mtime` against a tracked baseline (a simple `.last-announced` file in the shared folder, written each time an announcement is generated). Classify each skill as: *new since last announcement* / *updated since last announcement* / *unchanged* / *removed*. Draft a copy-paste-ready message tailored to the diff. Output as plain text the user can paste into Slack, email, iMessage, etc. After the user confirms they've sent the announcement, update `.last-announced` so the next run shows only newer changes. Sample shapes:
     - New skill: *"I added a new shared skill called `<name>`. To pick it up: run `cd '<shared-path>' && ./install.sh` then restart Cowork. Once it's loaded, you can invoke it by mentioning `<key trigger phrase from description>`."*
     - Existing skill updated: *"I updated `<name>` — `<one-line summary if the user provides one>`. Just restart Cowork to pick up the new instructions; no install command needed."*
     - Skill removed: *"I removed `<name>`. On your end: `rm ~/.claude/skills/<name>` then restart Cowork."*
   The user can ask for the announcement in many ways; this skill must match generously (see "Intent detection" above).

5. **Self-onboarding mode operations:**
   - Confirm `~/.claude/skills/` exists (create it if missing).
   - For each shared skill, confirm a symlink exists pointing into the shared folder. If any are missing, offer to run `install.sh` (show the command, confirm before executing).
   - Verify the shared folder is "Available offline" in Dropbox — if it can't be opened or any file shows as "online-only," instruct the user to right-click → Smart Sync → Local.
   - Detect "(conflicted copy)" files in the shared folder and report them (these break Cowork's discovery — user must resolve manually).
   - Remind the user to restart Cowork after installation. Provide the verification prompt: *"Ask in chat: 'List my pending Stamped reviews.' If Claude calls the tool, you're set up correctly."*

6. **Things to never do.** Don't auto-modify files in the shared folder without explicit confirmation — those changes affect everyone. Don't delete personal skills (real directories) under `~/.claude/skills/`. Don't symlink anything outside the configured shared folder. If the user asks to add a skill from a different source, hand them off to manual steps.

7. **Bootstrap note (for John when onboarding Harrison).** This skill can't bootstrap itself — Harrison needs `install.sh` to run once before he has any skills locally, including this one. Give him a one-time shell command to copy/paste: `cd "/Users/john/Business Dropbox/Transoms Common/claude-skills-shared" && ./install.sh && echo "Now restart Cowork."` After that, this skill is available and can handle ongoing verification.

---

## Verification (after files exist)

1. Confirm files exist and frontmatter parses:
   ```
   ls -la /Users/john/Business Dropbox/Transoms Common/claude-skills-shared/stamped-review-workflow/SKILL.md
   ls -la /Users/john/Business Dropbox/Transoms Common/claude-skills-shared/claudmcp-artifact/SKILL.md
   ls -la /Users/john/Business Dropbox/Transoms Common/claude-skills-shared/install.sh
   ```
2. Run `install.sh` on John's machine; confirm three symlinks appear in `~/.claude/skills/`:
   ```
   ls -la ~/.claude/skills/
   # Expect: stamped-review-workflow -> ..., claudmcp-artifact -> ..., claude-skills-admin -> ...
   ```
3. **Cowork smoke test:**
   - Restart Cowork (or open a new session).
   - In fresh chat, ask: *"List my pending Stamped reviews."* Expect Claude to invoke `stamped-review-workflow` and call the tool.
   - Ask: *"Build me an artifact showing my pending Stamped reviews with a draft-reply button."* Expect a working artifact on first try.
   - Ask: *"What shared skills do I have?"* Expect Claude to invoke `claude-skills-admin` and list the three skills with their descriptions.
   - Ask: *"Generate an onboarding doc for a new teammate."* Expect `claude-skills-admin` to propose an `ONBOARDING.md` body and ask for confirmation before writing.
4. **Personal-skill smoke test:** create `~/.claude/skills/my-test-skill/SKILL.md` (real dir, not symlink) and confirm it loads alongside the shared ones — proves the layout supports private dev work.
5. **Onboarding dry-run (optional but valuable):** on a second machine of yours (or by reverting `~/.claude/skills/` temporarily), invoke `claude-skills-admin` in self-onboarding mode and confirm the flow walks correctly to a working setup.

---

## Out of scope

- ShipperHQ skill (Phase 2 — extend `stamped-review-workflow` pattern when Phase 2 ships).
- Skills for non-Cowork environments (Claude Code CLI, raw API).
- Versioning / changelog inside skill files — keep them lean.
- A skill marketplace or remote-distribution mechanism.
- Cleaning up `~/.claude/skills/` if it already exists with conflicting names (the install script's "skip" behavior is intentional — user must rename their personal skill if it collides).
