# Plan — Consolidate Brand Voice / Content Rules into values.md

## Context

We've been treating `content/values.md` as the canonical source of truth for brand voice, but content/output rules are still scattered across the codebase and skills — most dangerously a stale duplicate brand-voice block hardcoded inside the canonical artifact template HTML, and a hardcoded `"— The TD Team"` sign-off in the askClaude prompt that directly contradicts the user's recent "no sign-off at all" rule in `values.md`. Goal: every rule that affects what Claude writes lives in `values.md` and nowhere else, so editing the brand voice in one place updates behavior everywhere. The MCP server stays a pure data layer; skills and artifacts are pure plumbing.

---

## Decisions (locked in from Q&A)

1. **Fetch-fail behavior:** if `get_brand_values` can't be reached AND localStorage has no cached copy, the artifact refuses to draft — empty brand panel + disabled Draft buttons + clear error message. No more `BRAND_VOICE_FALLBACK` hardcoded voice doc.
2. **askClaude-unavailable behavior:** disable the Draft button, leave the textarea empty for manual entry. No template draft (no hardcoded greeting/acknowledgment/sign-off).
3. **Output Format additions in values.md:** add `"Don't wrap the reply in quotation marks."` (the prompt's "no quotation marks" rule moves here).
4. **About Us section in values.md:** add a short `## About Us` section identifying the company; the prompt's "Transoms Direct, a custom transom window company" line is removed and lets values.md carry that identity.

---

## Inventory — what changes where

### `content/values.md` — additive

- Add `## About Us\nTransoms Direct is a custom transom window company.` near the top (after the title, before `## Context`).
- Append to the existing `## Output Format` section: `- Don't wrap the reply in quotation marks.`

### `artifacts/stamped-review-queue.html` — remove hardcoded content rules

- **Delete lines 281-294** (`BRAND_VOICE_FALLBACK` constant). Replace with no fallback constant at all.
- **Update line 295**: `let BRAND_VOICE = BRAND_VOICE_FALLBACK;` → `let BRAND_VOICE = null;` (sentinel "not loaded yet").
- **Update brand-panel rendering** (`renderBrandPanel`, ~line 338-348): if `BRAND_VOICE` is `null`, show "Brand voice not loaded — drafting is disabled until the MCP server is reachable" (style: dimmed/error). Otherwise render as before.
- **Update draft-button enablement**: at render time, if `BRAND_VOICE` is `null`, disable each row's "Draft reply" button and add an inline note explaining why. The "Refresh brand voice" top-right button stays enabled so the user can retry.
- **Simplify the askClaude prompt** (~lines 705-717). Drop the company description, "no preamble, no explanation, no quotation marks", "Keep it under 100 words", and `Use the sign-off "— The TD Team"`. New shape:
  ```
  Follow every rule in the brand voice document below when drafting a reply.

  BRAND VOICE:
  ${BRAND_VOICE}

  REVIEW TO REPLY TO:
  - Reviewer first name: ${firstName(review.author)}
  - Product: ${review.productName}
  - Rating: ${review.rating}/5
  - Title: ${decodeEntities(review.title || '')}
  - Body: ${decodeEntities(review.body || '')}
  ```
- **Update `generateReply` early guard** (~line 695): if `BRAND_VOICE` is `null`, return immediately with an error status — don't even try to call askClaude. (Defense in depth alongside the disabled button.)
- No changes to the cowork-artifact-meta block, layout, styles, filter/sort logic, postReply flow, or HTML decoding helpers.

### `stamped-review-workflow/SKILL.md` (Dropbox) — strip hardcoded rules

- **Section 5 (Artifact-build playbook), step 9 "Draft reply" guidance:**
  - Drop the "100 words" phrase from the askClaude constraint. New constraint: *"Follow every rule in the brand voice document above."*
  - Remove the entire "Fallback when no askClaude exists" sub-list (greeting / rating-branched acknowledgment / sign-off). Replace with: *"If `askClaude` is unavailable, disable the Draft button for that row and leave the textarea empty. Surface the brand voice panel so the user can draft manually."*
- **Section 6 (Chat-only playbook), "Draft a reply to review X" step 3:** drop "under 100 words". Keep "Obey every rule in the markdown" — but drop the explicit list of sections (tone, "Always" list, etc.) since enumerating them re-creates the very content-coupling we're removing. Just trust the markdown.
- **Section 7 (Brand-voice rule):** strengthen to: *"Skills, prompts, and artifact code MUST NOT reproduce, paraphrase, summarize, or default-substitute any part of the brand voice doc. The only legal operation is 'fetch the markdown and pass it through to the LLM unmodified.'"* This codifies the principle so future edits don't regress.

### `claudmcp-artifact/SKILL.md` (Dropbox) — no behavioral change

Already clean. Will skim for any incidental hardcoded content as a paranoia pass; no edits expected.

### `route.ts`, `lib/*.ts`, other code

No changes. Tool descriptions stay (they describe MCP-protocol semantics, not content).

---

## Files to modify

1. `content/values.md` — additions only (About Us section, Output Format bullet).
2. `artifacts/stamped-review-queue.html` — remove fallback constant, update prompt, gate drafting on `BRAND_VOICE !== null`.
3. `~/Business Dropbox/Transoms Common/claude-skills-shared/stamped-review-workflow/SKILL.md` — strip hardcoded rules.

---

## Implementation order

0. **Persist this plan into the claudmcp repo** as `claudmcp/plans/values-consolidation-plan.md` (alongside the earlier `phase-1-plan.md` and `cowork-skills-plan.md`) so it's version-controlled.
1. Edit `content/values.md` first — additions only, no removals. Confirms the new content lives somewhere before we remove it elsewhere.
2. Edit `artifacts/stamped-review-queue.html` per the spec above. Run `npx tsc --noEmit` (sanity, no TS changes but check the build doesn't break) and `npm test` (existing template test confirms file still parses).
3. Commit + push (with rebase if needed). Wait for Vercel deploy.
4. Verify production: curl `get_brand_values` (expect new About Us section + new Output Format bullet); curl `get_artifact_template` (expect no `BRAND_VOICE_FALLBACK`, simplified prompt).
5. Edit the Dropbox `stamped-review-workflow/SKILL.md` per spec.
6. User restarts Cowork; runs the smoke prompts ("build me a Stamped review queue artifact"; "draft a reply to review X") and confirms the resulting drafts respect the live values.md (no sign-off, etc.) and don't hint at the old hardcoded rules.

---

## Verification

- `get_brand_values` from production returns markdown containing "About Us" and "Don't wrap the reply in quotation marks".
- `get_artifact_template` from production returns HTML that:
  - Does NOT contain the string `BRAND_VOICE_FALLBACK`.
  - Does NOT contain the string `Use the sign-off`.
  - Does NOT contain the string `Keep it under 100 words`.
  - DOES contain `BRAND VOICE:` (the leading prompt line) and the brand voice injection slot.
- Test suite still 17/17 green (template test asserts size + first line + cowork-artifact-meta presence; all still hold).
- Built artifact in Cowork: brand panel shows the latest values.md (with About Us and no-quotes rule visible); a Draft action produces a reply with NO sign-off; the brand panel before fetch is empty (or shows the disabled message) rather than the old fallback text; intentionally killing network access while drafting cleanly disables the Draft button.

---

## Out of scope

- Changing the post_reply flow, layout, styles, or filter/sort logic — only the brand-voice plumbing changes.
- Adding a `BRAND_VOICE_SCHEMA` or any structured validation. Trust the markdown.
- Backporting the same principle to a future ShipperHQ artifact — when Phase 2 ships, this plan's principle (rules live in the served doc, code is pure plumbing) becomes the template.
- Renaming `get_brand_values` or otherwise touching the MCP-tool surface.
