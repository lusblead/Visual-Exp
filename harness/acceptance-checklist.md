# Acceptance checklist

## Automated gates

- [ ] `npm test`
- [ ] `npm run companion:build`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run eval:token-economy`
- [ ] `npm run harness:token-economy`
- [ ] `npm run harness:knowledge-session`
- [ ] `node harness/minimal-visual-conversation.mjs`
- [ ] `git diff --check`
- [ ] Feature Flow validation reports zero errors and zero warnings.
- [ ] Engineering-learning document validation reports no errors.

## Token economy

- [ ] `省流` performs no background generation; `平衡` stays within one scene
  call and one term batch; `深入` stays within five scene calls and four term
  batches for one active frontier.
- [ ] Restoring or replaying an existing receipt ID does not spend budget or
  report provider usage twice.
- [ ] Accepted, failed, aborted, and discarded background requests all consume
  the request budget once they were issued.
- [ ] If the provider omits usage, the interface marks the receipt as unknown;
  it never turns text or character length into an estimated token count.

## Desktop reading experience

- [ ] Initial load keeps the centered `请输入你的问题` composer as the primary interaction while one compact knowledge control already exposes `省流 / 平衡 / 深入` and any saved records after hydration.
- [ ] Changing the profile before the first question sends no model request and creates no empty history record; the next accepted question inherits the chosen profile.
- [ ] Submitting a question moves the composer to the top and reveals the accepted explanation after loading.
- [ ] At 1440×900, the first viewport contains the restrained title, prominent direct answer, orienting detail, and the beginning of the first ordered entrance.
- [ ] The scene is one top-to-bottom knowledge spine. No three-column card wall, radial map, relation-pill band, view menu, outline, breadcrumb, depth badge, provider label, or guide panel competes with the explanation.
- [ ] The scene title is no larger than 42 CSS pixels at desktop reading widths; direct-answer text is at least 19 pixels and explanatory prose is at least 16 pixels.
- [ ] Body prose remains visually stronger than headings: titles orient, while the direct answer, background, mechanism, and boundaries carry the reading flow.
- [ ] Multi-paragraph detail is rendered as real paragraphs in the order background, role, mechanism, and boundary where those parts apply.
- [ ] Each direct entrance explains what it is and why it follows from the current scene before presenting one clear enter arrow.
- [ ] A sequence, timeline, comparison, cluster, or explicit-relation scene may show one quiet semantic overview derived from canonical children/relations; complete linear sections remain immediately below it.
- [ ] A question about `《静夜思》` shows the verified poem before interpretation. An unavailable work shows a source limitation instead of model-reconstructed “original text”.
- [ ] Long Chinese and English text wraps without clipping, ellipsis, overlap, fixed-height borders, or horizontal scrolling.
- [ ] `‹` and `›` change only exploration history; returning and then entering another section replaces the forward branch.

## One-layer-ahead preparation

- [ ] After the root appears, its direct entrances are prepared sequentially in reading order without blocking current reading.
- [ ] Only direct entrances of the active scene are prepared; grandchildren of an unentered entrance are not recursively prepared.
- [ ] An entrance being prepared shows only a subtle non-announced indicator; preparation failure does not show a global error.
- [ ] Clicking an already prepared entrance performs no new expansion request and changes scene within one render cycle.
- [ ] Clicking an entrance whose background request is incomplete cancels background work and starts one foreground expansion with the latest accepted document.
- [ ] A stale background response, version mismatch, hidden page, new question, or route change cannot overwrite the authoritative document.
- [ ] Returning to a previously prepared scene does not regenerate its existing children.

## Terms and recursive explanation

- [ ] Every annotated term in the active scene and visible entrances is included in current-layer preparation; preparation uses at most one Flash batch at a time and at most eight terms from one node.
- [ ] `ReLU`, `Dropout`, `非线性激活函数`, `Agent`, and `RAG` are independently clickable whenever they are present in a node's `terms` allowlist.
- [ ] A one-character Han term such as `键` is clickable in an explicitly delimited position such as `查询、键和值向量`, but ordinary compounds such as `关键`, `主键`, `按键`, `键值`, and `键盘` are never split into a term button.
- [ ] Single activation opens one short contextual Flash explanation without navigation.
- [ ] Double activation cancels the pending single activation and sends only one Pro deep request.
- [ ] Activating terms A and B leaves both independently labelled cards visible in the top-aligned rail.
- [ ] Closing A leaves B visible and does not abort or delete A; reactivating pending/ready A restores the same task without another provider request.
- [ ] A returned short explanation may contain up to four annotated nested terms; activating one pushes a new explanation inside the same surface.
- [ ] If a short single/batch result contains invalid, duplicate, ancestral, non-literal, or excess optional nested-term candidates, the usable definition still renders; only valid candidates become clickable.
- [ ] The explanation back action returns one stack level; Escape returns one nested level before closing the surface; stack depth never exceeds four.
- [ ] Returning while a nested term is loading keeps the restored parent visible; the child request may finish into its own cache but never replaces the currently visible stack entry.
- [ ] Altering a returned parent explanation, reusing it with another node/document, or omitting its `ect1` context token is rejected before provider access.
- [ ] Closing the explanation restores focus to the originating control and does not mutate document version or route history.
- [ ] Background batch failure is silent, while an uncached foreground activation can retry that term.
- [ ] Repeated activation of unchanged content uses its cache; expanding an unrelated branch does not invalidate it.

## Selected-text deep explanation

- [ ] Selecting 1–600 characters inside one scene node shows a small `深入` action near the selection on desktop and a reachable stable action on touch layouts.
- [ ] Selection alone sends no request. Activating `深入` sends one Pro request.
- [ ] Cross-node, fabricated, empty, or overlong selections are rejected without provider access.
- [ ] A term explanation exposes an explicit `深入` action for keyboard and touch users.
- [ ] A deep result appears full-width after its source section and explains direct meaning, background, role, mechanism, and boundary.
- [ ] Starting deep A and then deep B leaves both jobs running; returning to pending or ready A does not restart it or allow B to overwrite it.
- [ ] Terms annotated in a deep result remain clickable: single activation uses Flash and double/explicit deep activation uses Pro with the signed deep context.
- [ ] The deep result receives programmatic heading focus when ready, can be closed without route mutation, and does not accumulate multiple competing deep panels.
- [ ] Explicit no-math wording yields no formula. Default optional mode uses at most one clarifying formula with adjacent plain-language meaning. Explicit math requests may use fuller notation.
- [ ] Technical components use recognisable bilingual naming when helpful, for example `Encoder（编码器）` and `Decoder（解码器）`, and the whole bilingual phrase is one clickable term.

## Mobile browser

- [ ] At 320, 375, and 768 CSS pixels, `scrollWidth === clientWidth` and the composer, arrows, scene, selection action, explanation surface, and model settings remain reachable.
- [ ] Body text is at least 16 CSS pixels and every interactive target is at least 44×44 CSS pixels.
- [ ] Ordered entrances remain a single normal-flow column with no hover-only affordance.
- [ ] The explanation surface becomes a bounded bottom surface no taller than about 72dvh and remains internally scrollable.
- [ ] Multiple mobile explanation cards share one bounded 72dvh workspace and can each be dismissed without horizontal overflow.
- [ ] `prefers-reduced-motion` removes entrance movement, scale, and continuous decorative motion.

## Provider and credentials

- [ ] With `EXPLANATION_MODEL_PROVIDER=demo`, create, foreground/background expand, single/batch define, nested define, and dive are deterministic and usable without a Key.
- [ ] The Windows companion rejects missing or wrong bearer tokens and direct browser-Origin requests.
- [ ] Saving a valid credential, restarting the companion, and reading status preserves `configured=true`; deleting it returns `configured=false`.
- [ ] An invalid replacement does not destroy the last valid credential.
- [ ] With the locally stored Key, create, expand, and dive report `deepseek-v4-pro`; single/batch and nested define report `deepseek-v4-flash`.
- [ ] All actions use the same stored Key, and no response, HTML, client bundle, URL, log, or repository file contains that Key.
- [ ] A real Transformer create yields a detailed beginner orientation and ordered entrances without a parse error.
- [ ] A real prepared entrance opens without another provider request; a real nested term and selected-text deep explanation both validate and render.
- [ ] Latency reporting distinguishes provider TTFT, complete validated result, prepared/cache hit, foreground expand, background expand, single define, batch define, and dive.
- [ ] Provider retry and content repair remain independent one-retry budgets; authentication, insufficient balance, invalid parameters, and filtering do not retry.
- [ ] A relation self-edge is classified as `relation_reference_invalid` before generic child-shape matching, and the repair prompt explicitly requires valid distinct `fromIndex`/`toIndex` or an empty relation array.
- [ ] A formula in `avoid` mode or a second/unexplained formula in `optional` mode is classified as `math_preference_invalid`; repair restores the original mode rather than weakening it.
- [ ] Every category-specific repair repeats the cross-category invariant that the original Schema, count, source, and math mode remain unchanged, so fixing child shape cannot introduce a formula.
- [ ] Cancelling background or foreground work reaches the upstream provider request and never triggers retry or content repair after the caller abort.

## Not verified by this stage

- Real website-conversation capture.
- Browser-extension prompt submission, job-to-answer correlation, or an officially authorized cross-origin website-AI relay.
- Automatic ChatGPT website send-and-read remains `blocked_by_provider_terms`; the Personal Hub extension is verified only as a capture/reference implementation.
- Long-run DeepSeek quality, cost, and latency distributions; local measurements are point-in-time observations only.
