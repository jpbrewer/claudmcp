# Plan — Style-Aware Regenerate Button for the Stamped Review Queue

## Context

`values.md` now has an explicit `## Style Bank` (5 styles today, with the intent to grow to 10) and an instruction "randomly choose from one of these styles." In practice, the LLM doesn't actually rotate — it tends to gravitate to one or two styles each click. We want a **Regenerate** button that produces deliberately different drafts by forcing the LLM to use a specific style from the bank on each click, with the style chosen via deterministic seed math so the behavior is predictable and stateless.

This change lives entirely in the canonical artifact template (`artifacts/stamped-review-queue.html`). No MCP server changes. No skill changes beyond a small note in `stamped-review-workflow/SKILL.md`.

---

## Decisions (locked in from Q&A)

1. **Seed source:** derived client-side from the review ID (`parseInt(review.id)`). No MCP server change. If you later want a server-stamped seed for analytics, that's a one-line addition to `mapReview` in `lib/stamped.ts` — not in this plan.
2. **Style count:** parse `## Style Bank` from the live `values.md` and count lines matching `^- Style \d+ —`. Whatever N comes out is the modulus. Auto-adapts as you add/remove styles. (Today N=5; once you add styles 0-9 / 6-10, N=10 automatically.)
3. **Initial draft style:** `seed % N`. Deterministic — the same review always opens with the same first style on every machine and across reloads.
4. **Regenerate style:** `(seed * (Date.now() % 9973)) % N`, then **re-roll on collision** with the last-used style. Guarantees a different style each click. (9973 is a small prime to spread the multiplication.)
5. **UX:** Regenerate replaces the current draft in the textarea. No history, no undo, no side-by-side stacking. Per your call.
6. **Style label:** hidden. The user doesn't see "Style 3" anywhere in the UI. The instruction goes only into the askClaude prompt.

---

## Files to change

### `artifacts/stamped-review-queue.html`

1. **Add a `parseStyleBank(markdown)` helper.** Regex-extracts the names of styles from the `## Style Bank` section (lines matching `/^- Style (\d+)\s+—/m`). Returns an array of numbers, e.g. `[1,2,3,4,5]`. Falls back to `[]` if the section is missing or empty.
2. **Add a `chooseStyle(seed, lastUsed, styleNumbers)` helper.**
   - First-call path (lastUsed is null): `styleNumbers[seed % styleNumbers.length]`.
   - Regenerate path: compute `i = (seed * (Date.now() % 9973)) % styleNumbers.length`; if `styleNumbers[i] === lastUsed`, advance `i = (i + 1) % styleNumbers.length`. Return `styleNumbers[i]`.
3. **State:** add an in-memory `state.lastStyleByReview = {}` (object keyed by review id → last-used style number). Lives only in JS, never written to localStorage. Cleared on full page reload (which is fine — first-draft determinism kicks back in).
4. **Add a second button next to "Draft with AI" labeled `🔁 Regenerate`** (only enabled after at least one draft exists for that row). On click:
   - Compute style number via `chooseStyle(seed, state.lastStyleByReview[id], parseStyleBank(BRAND_VOICE))`.
   - Store as new `lastStyleByReview[id]`.
   - Call the same `generateDraft(id)` flow, but with `forcedStyle` passed in.
5. **Modify `generateDraft(id, forcedStyle)`:**
   - On initial click (no `forcedStyle`): compute via `chooseStyle(seed, null, ...)`; store as `lastStyleByReview[id]`.
   - On regenerate (`forcedStyle` passed in): use it directly.
   - Inject one new line into the askClaude prompt, immediately after the `Follow every rule in the brand voice document below…` line:
     ```
     For this specific draft, use **Style {N}** from the Style Bank section of the brand voice document. Find the line beginning "Style {N} —" and follow that style's approach. Do not switch to a different style.
     ```
   - Everything else in the prompt is unchanged. values.md remains the source of every other rule.
6. **No style label rendering anywhere in the DOM.** Style number stays purely in JS state and in the prompt.
7. **Edge-case guard:** if `parseStyleBank(BRAND_VOICE)` returns an empty array (Style Bank missing or malformed), fall back to the existing prompt with no `Use Style N` line. Don't break drafting.

### `stamped-review-workflow/SKILL.md` (Dropbox)

Add a one-paragraph note in the Artifact-build playbook (under step 9, Draft-reply guidance) explaining that the canonical artifact handles style rotation internally via seed math + `## Style Bank` parsing. Skills using this artifact don't need to know about styles — that's all baked into the template. If a user asks "how is the style chosen?", point them at the `## Style Bank` section of `values.md` and tell them: deterministic for the first draft, guaranteed-different on each Regenerate click.

### `claudmcp` server / lib / tests

No changes. The change is artifact-only.

### `values.md`

No changes from this plan, but **you (the user) will want to add Styles 6-10** (or relabel to 0-9) to bring the bank up to your stated 10. The artifact will auto-pick up whatever's there.

---

## Implementation order

1. Persist this plan to `claudmcp/plans/style-regenerate-plan.md` (alongside existing plans).
2. Edit `artifacts/stamped-review-queue.html` with the helpers, button, state, and prompt injection.
3. Run `npm test` (existing template test should still pass — it asserts size, first line, and meta-block presence; size will grow slightly).
4. Run `npx tsc --noEmit` (no TS files changed, but safety check).
5. Commit + push (with rebase if needed).
6. Wait for Vercel deploy; verify with `curl get_artifact_template` that the new HTML contains `parseStyleBank`, `chooseStyle`, and the Regenerate button.
7. Add the skill note to `stamped-review-workflow/SKILL.md` in Dropbox.
8. User: refresh the artifact in Cowork (either start a new chat and ask "rebuild the stamped artifact", or use the canonical refresh prompt) and smoke-test by clicking Draft, then Regenerate, on the same review. Verify the second draft is meaningfully different.

---

## Verification

- `get_artifact_template` returns HTML containing the strings `parseStyleBank`, `chooseStyle`, and `Regenerate`.
- HTML still parses (template test green).
- Manual smoke test in Cowork:
  - Initial Draft on review X uses style `parseInt(X.id) % N` (you can verify by checking the network/log if curious, but the visible result is what matters: it should reliably feel like the same style for the same review).
  - Regenerate produces a draft that uses a *different* style every click — no two consecutive clicks should produce drafts with the same opening pattern (assuming the LLM follows the "Use Style N" instruction).
  - After many Regenerate clicks, you cycle through all N styles eventually.
- Negative test: if you temporarily remove the `## Style Bank` section from values.md (don't actually do this in production), drafting falls back to the existing behavior (no style instruction injected) without errors.

---

## Out of scope

- Server-side seed generation. The review id already provides per-review determinism.
- Style picker dropdown / user-selectable style. Always automatic per the seed math.
- Style label display in the UI. Hidden by design.
- Persisting `lastStyleByReview` across reloads. Intentionally in-memory only.
- Style usage analytics (e.g. "which style produced the most posted replies"). Not yet.
- Touching values.md (you'll add styles 6-10 yourself).
