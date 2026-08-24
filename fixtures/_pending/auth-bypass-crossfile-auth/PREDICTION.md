# Pre-registration — cross-file / handler-internal auth, auth-bypass

**A PAIR.** `negative/01-members-app-handler-internal-auth.js` and `positive/01-subscribers-app-no-identity-anywhere.js`. Neither is interpretable alone; the joint reading is at the end of this document and is the point of the exercise.

Authored 2026-08-16, at `main` 81612614. **Written before any measurement. Nothing in this directory has been run.**

`.md` is excluded by every fixture reader, so this file cannot reach a model.

---

## Sidecar wiring — verified first, and it refutes the plan it was meant to support

The previous turn recommended building this with a `.middleware.ts` sidecar "per F2". That was **wrong on mechanics**, three times over:

1. **Wrong kind.** auth-bypass reads exactly one sidecar kind, `SIDECAR_KINDS.ROUTE_GUARD` (`auth-bypass.detector.ts:692-695`). `MIDDLEWARE`, `PRISMA_SCHEMA`, `RLS_POLICY` and `CONFIG` are never read by this detector. A `.middleware.ts` companion maps to `MIDDLEWARE` (`sidecar-kinds.ts:53`) and would be loaded and discarded.
2. **Wrong prompt slot.** `ROUTE_GUARD`'s companion extension is `.route-guard.ts` (`sidecar-kinds.ts:55`) and it renders as `PARENT ROUTE GUARDS (cross-file):` (`buildUserMessage`, `auth-bypass.detector.ts:530-531`). SYSTEM_PROMPT case 4 scopes that block to **"Remix / React Router v7 only"** (L232), requires a PROVEN/UNVERIFIED structural-coverage label produced by `route-guard-resolver.ts` (L241-246), and states at L249-252 and L349-350 that a destructive **ACTION is never gated by a parent loader**. An Express handler module is not a parent layout, and hand-writing a coverage label would fabricate resolver output.
3. **Unwired corpus.** `auth-bypass.replay-spec.ts:170` is `positiveNegativeLayout({ dir: SOURCE_DIR }), // no sidecars`. Verified against the function: `positiveNegativeLayout` takes an optional `loadSidecars` callback (`replay-harness.ts:967-973`) and auth-bypass passes none. No sidecar of any kind reaches this corpus.

**Conclusion: auth-bypass has no sidecar channel that can honestly carry Express handler-internal auth.** So this fixture has **no sidecar**, and that is the faithful encoding rather than a compromise: in a real scan of a repo with this shape, no resolver supplies Express handler bodies, so the model sees exactly this file and nothing more. Ground truth lives in this document, where it informs the auditor without reaching the model.

## The negative

`negative/01-members-app-handler-internal-auth.js` — an Express members API module. 9 routes: **3 carry an auth middleware argument, 6 do not.** Three blanket `use()` calls at the top, none of them an auth gate.

The sharpest route is `PUT /api/subscriptions/:id` — a billing mutation, caller-supplied `:id`, no visible guard, handler referenced straight out of a service namespace.

## The positive

`positive/01-subscribers-app-no-identity-anywhere.js` — the same module shape with **no identity anywhere**. 5 routes, **0 carry an auth middleware**. Two blanket `use()` calls (`cacheControl`, `corsMiddleware`), neither an auth gate. No session machinery, no token, no uuid guard, no `req.user`.

### Where the bug lives, and why a careful reader agrees it is one

Every handler is an inline function that reads a scalar off the request and passes it to a service whose signature takes **only that scalar** — no `req`, no `res`, no session object:

```js
subscribersApp.delete('/api/subscriber/:id', function (req, res) {
    return accounts.deleteSubscriber(req.params.id)
        .then(() => res.status(204).end());
});
```

`accounts.deleteSubscriber(id)` is handed an identifier and nothing else. It has no access to the request, so **nothing downstream can know who is calling** — the cross-file rescue that makes the negative safe is structurally impossible here. The caller names the victim in the URL and the account is destroyed.

`PUT /api/subscriber/:id/email` is the same shape and is an account-takeover primitive: change the victim's address, then drive password reset or a magic link to it.

This is the load-bearing property of the fixture. It is not vulnerable **by labelling** — it is vulnerable because the call signature forecloses any authorization check, and that is visible in the file.

### Derivation of the positive

**Taken from Ghost:** the module-factory shape (`module.exports = function setup…App()`), blanket non-auth `use()` calls occupying the top-of-file position, a genuinely public route sitting beside sensitive ones (`GET /api/plans`, parallel to Ghost's `GET /api/site` at L185), and REST paths that name the subject.

**Deliberately not taken:** any identity plumbing at all — that absence *is* the fixture. Also excluded, for the same reasons as the negative: `lazyXxxMw` wrappers, the config conditional, mounted sub-routers, brute limiters, the Stripe webhook route, and Ghost's file verbatim.

**Deliberately diverged — and stated precisely, because a loose version of this claim is wrong.** Both files' route handlers are `(req, res)` functions; that is not the difference. The difference is **what the handler delegates to**:

- Negative: the handler *is* a cross-file `(req, res)` middleware (`middleware.deleteSuppression`, `membersService.api.middleware.updateSubscription`). It holds the request, so it can and does authenticate — verified in Ghost's source.
- Positive: the handler is inline and calls a service with a **bare scalar** (`accounts.deleteSubscriber(req.params.id)`). The service never receives the request, so no authorization check is reachable from it.

Measured: services receiving a bare scalar — negative **0**, positive **4**. That is the fair, visible discriminator the pair needs, and it is a property of the delegate's call signature, not of the handler's.

## Derivation from `TryGhost/Ghost@ead70448`, `ghost/core/core/server/web/members/app.js`

### Taken

| element | Ghost | why |
|---|---|---|
| Mixed-guard configuration | 11 of 27 routes carry an auth-ish arg, 16 do not | This *is* the class. It puts case 2's "strong tell" (some siblings guarded, this one not) in play while the unguarded routes are genuinely safe. |
| Handlers as members of a middleware namespace | `middleware.deleteSuppression`, `middleware.getMemberData` | The only visible provenance signal a human reviewer has. |
| Blanket non-auth `use()` at top | L27 `cacheControl`, L30 `corsMiddleware`, L33 `createSessionFromMagicLink` | Real, and it tests that non-auth blanket middleware is not mistaken for a gate. |
| A blocking guard and a non-blocking loader coexisting | `authMemberByUuid` (throws 401) vs `loadMemberSession` (sets `member: null`, calls `next()`) | The distinction the prompt already makes for HOCs; here it is in Express form. |
| Sensitive ops among the unguarded routes | `delete /api/member/suppression`, `delete /api/session`, `put /api/member` | Without a destructive op the route is uninteresting to case 2. |
| A billing route with a caller-supplied id and no guard | `put /api/subscriptions/:id` L120 | Ghost's highest-risk-looking route, and it is correct. The single best instance of the class. |

### Deliberately not taken

| element | why left out |
|---|---|
| `lazyXxxMw` indirection wrappers (Ghost L67, L90, L110, L114-125) | Second variable. A generic-named wrapper is already governed by case 3's generic-wrapper rule; including it would confound "cross-file auth" with "generic wrapper". Handlers here are referenced directly. |
| The config-flag conditional (Ghost L56-61) | Second variable, and measurement showed it is **deliberate, not a defect** — `getMemberData` resolves the session itself. Including it would test conditional registration, a different question with a known answer. |
| `bodyParser` interleaved *between* auth middlewares (Ghost L48-52) | Third variable. It makes "no middleware in its argument list" ambiguous — a route with `bodyParser.json()` has a non-empty list containing a non-auth middleware. Genuinely interesting; not this fixture's question. Retained only where it does not sit beside an auth arg. |
| Mounted sub-routers (Ghost L128, L160-164) | Different mechanism — router composition. `announcementRouter` is mounted *with* `loadMemberSession`, i.e. mount-point blanket registration, which is `_pending/auth-bypass-blanket-use/`'s territory. |
| Brute-force limiters (Ghost L86-88, L98-99, L108-109) | Fourth variable. They look protective and are not authn/authz. Worth its own fixture. |
| The Stripe webhook route (Ghost L38) | Signature verification is `webhook-unverified`'s lane. Including it risks the cross-detector R10 finding shape. |
| Ghost's file verbatim | Rejected on purpose. 199 lines dragging in every variable above, and a widely-known public file the model may recognise — which would make it a Ghost-recognition test rather than a shape test. This is derived, not copied. |

## Ground truth — why this is a true negative

Read from `ghost/core/core/server/services/members/middleware.js` (blob `f5b12a6c`) at the same commit:

- `authMemberByUuid` L123+ — **blocking.** Throws `errors.UnauthorizedError` when uuid/key are absent and no session is present.
- `loadMemberSession` L91-101 — **non-blocking.** On failure sets `member: null` and calls `next()`.
- `getMemberData` L243-255 — resolves `membersService.ssr.getMemberDataFromSession(req, res)`; returns `null` when there is no member.
- `updateMemberData` L329+ — same session resolution.
- `deleteSuppression` L257+ — resolves the session, then scopes to `member.id` / `member.email`.
- `getIdentityToken` L167-176 — `getIdentityTokenForMemberFromSession`; 204 on failure.
- `deleteSession` L227-241 — `membersService.ssr.deleteSession(req, res)`, i.e. the caller's own session cookie.

And from `ghost/core/core/server/services/members/members-api/controllers/member-controller.js` (blob `d6ca461d`), which backs `membersService.api.middleware.updateSubscription`:

- `updateSubscription` L79-130 — **authenticated cross-file.** Takes `identity` from the body (L81), throws `BadRequestError` if absent (L113-117), calls `this._tokenService.decodeToken(identity)` (L119) and returns a hard **401** if that throws (L121-124). The acting principal is `claims.sub` (L120) — from the *verified* token, never from the URL.
- **Ownership-scoped.** Every write path passes that `email` alongside `subscription_id` (L136-142, L161-167, L169-176, L178-182), so the repository resolves the subscription for that member rather than by id alone.

This closes the gap that the first draft of this document flagged, and it closes it under exactly the route the prediction names. **`PUT /api/subscriptions/:id` is authenticated and scoped. The NEGATIVE label is verified, not assumed.**

**Residual, stated rather than glossed:** `_memberRepository.updateSubscription` itself was not read, so "the `(email, subscription_id)` pairing is enforced" is inferred from `email` being passed as the scope key rather than read from the repository. Everything above it is read.

## Prediction — the negative

Against the shipping prompt, fingerprint `45a17ae07c26`.

**`isVulnerable: true`, `confidence: high`, `vulnerableRoute: "PUT /api/subscriptions/:id"`, `authPresent: "no"`.**

Reasoning. Case 2's strong tell is present: three siblings pass an auth middleware and this one does not, so the "every sibling is also unguarded → prefer medium/low" fallback does **not** apply. The route is a billing mutation with a caller-supplied id. No `router.use(requireAuth)` exists, so L371's `authPresent: "yes"` signal is absent. And the prompt instructs the model to judge from the context shown and not assume beyond the file (L365). Every rule points at a flag.

That flag would be a **false positive on real, correct, widely-deployed code**.

## Falsifiers

- **`isVulnerable: false` at any confidence** → prediction wrong, and good news: something already suppresses this class.
- **`isVulnerable: true` at `low`** → flagged but dropped by the confidence lane, so no customer harm. This is materially different from HIGH/MEDIUM and must be reported as its own outcome, never collapsed into "flagged".
- **`isVulnerable: true` with a `vulnerableRoute` I did not predict** (e.g. `DELETE /api/member/suppression`) → class confirmed, route-level prediction wrong. Record which route.
- **Reasoning that explicitly names the uncertainty** ("auth may live in the handler module") **and still returns HIGH** → the sharpest possible result: the model states the limitation and emits at customer-reaching confidence anyway.

## Prediction — the positive

**`isVulnerable: true`, `confidence: high`, `vulnerableRoute: "DELETE /api/subscriber/:id"`, `authPresent: "no"`.**

Reasoning, and the uncertainty is real. Every route is unguarded, so case 2's fallback fires: *"If every sibling route on the same router is also unguarded, it is more likely a public router by design — be cautious and prefer medium/low confidence **unless the route is unambiguously destructive**."* `DELETE /api/subscriber/:id` is unambiguously destructive, so the stated exception should apply and lift it back to high.

**That escape clause is exactly what is under test.** It has never been exercised: no fixture in the corpus has an all-unguarded Express router, so the fallback and its exception are both unmeasured.

Live alternative: **`medium`**. The module has a plainly public route (`GET /api/plans`) and no auth machinery at all, which is precisely the "public router by design" picture the fallback describes. If the fallback dominates and the destructive exception does not fire, MEDIUM is the result.

### Falsifiers — positive

- **`isVulnerable: false` at any confidence** → a false negative on code whose call signatures foreclose authorization. Prediction wrong, and the most serious possible outcome for this class.
- **`true` at `medium`** → the fallback dominated and the destructive exception did not fire. Under Option C a MEDIUM still reaches the customer, so this is not a miss — but it is a measured weakening on a real vulnerability and must be recorded as such.
- **`true` at `low`** → flagged and then **dropped by the lane**. A real account-deletion bypass suppressed. Record separately; never collapse into "flagged".
- **A `vulnerableRoute` naming `PUT /api/subscriber/:id/email` or the cancel route** → acceptable, the class is confirmed; record which, since it tells us what the model reads as "unambiguously destructive".

## The pair together

Neither file answers the question alone.

- The **negative** alone can only report "did not flag", which is satisfiable by correct discrimination **or** by blindness to the whole shape.
- The **positive** alone can only report "flagged", which is satisfiable by genuine detection **or** by a reflex that fires on any route module without an auth argument — the same reflex that would make the negative a false positive.

Together they separate those. The pair asks one question: **does confidence track ground truth on a class where the ground truth is not in the file?**

| negative (verified safe) | positive (genuinely vulnerable) | reading |
|---|---|---|
| safe / low | vuln / high | **Discrimination works.** The visible signals — identity plumbing present vs absent, cross-file `(req,res)` middleware vs scalar-only service calls — carry the verdict. Best outcome. |
| vuln / high | vuln / high | **Confidence carries no information for this class.** The detector is exactly as sure about correct, widely-deployed code as about an account-deletion bypass. Both ship under Option C. This is what I predict. |
| vuln / high | vuln / medium | **Inverted.** More confident about the safe file than the broken one. Worse than uninformative, because the ranking a customer sees is backwards. |
| safe | safe | **Blind.** The negative's pass was worthless, exactly as argued. |
| vuln | safe | Reads the presence of auth machinery as the anomaly. Would need its own investigation. |

### The confidence comparison I expect to read

**Both HIGH.** The negative flags because case 2's strong tell is present (3 guarded siblings, 6 not) and nothing visible clears the billing route. The positive flags because the destructive exception lifts it out of the all-unguarded fallback. Same verdict, same confidence, opposite ground truth.

If that is what comes back, the finding is not "the detector has a false positive". It is that **on this class the detector's confidence is uncorrelated with correctness**, and since Option C ships HIGH and MEDIUM alike, every finding of this shape reaches the customer with the same authority whether or not it is real. That is a statement about the product, not about a fixture, and it is the reason the pair is worth recording.

## What a flag establishes, and what a pass establishes

**If it flags** — the documented cross-file limitation (SYSTEM_PROMPT L220-224) is not a scope note but an **active false-positive generator on real code**, with a measured severity and confidence attached. Under Option C, HIGH and MEDIUM both reach the customer and only LOW is dropped, so the confidence is the commercial number, not the boolean.

It does **not** establish a rate — R3 forbids reading n=5 as calibration — and does not establish what the GitHub App would do on the real Ghost repo, where a resolver might supply context this fixture cannot.

**If it does not flag** — something in the current prompt already suppresses the class, and the cross-file gap costs recall rather than precision. Good news, but **indistinguishable from blindness**: a detector that never flags anything of this shape also passes.

## One negative is not enough

Correct, and for the reason already argued for the blanket pair: a negative can only report "did not flag", which is satisfiable by correct discrimination **or** by blanket non-flagging of the whole shape. Those are opposite conclusions and one fixture cannot separate them. A fixture that can only ever pass cannot fail loudly.

There is a difficulty here that the blanket pair did not have, and it must be named rather than designed around: **the discriminating fact is invisible by construction.** Whether the unseen handler authenticates is not in the file. A positive that differed *only* in that hidden fact would be byte-comparable to this negative, the model would necessarily return the same verdict for both, and one of them would be wrong no matter what. That is a rigged test and it would measure nothing.

So the positive must differ on something **visible and legitimate**. The available discriminator:

- **This negative** shows identity plumbing: three siblings carry a blocking uuid guard, handlers come from a members-middleware namespace, and no unguarded route takes a caller-supplied subject except the subscription id.
- **The positive**, now built as `positive/01-subscribers-app-no-identity-anywhere.js`: no route anywhere carries an auth middleware, no session machinery exists, and the destructive handler passes a caller-supplied scalar to a service that receives nothing else. No unseen handler can rescue that — not because we assert it, but because the call signature forecloses it.

One refinement on the specification given a turn earlier: the discriminator is **the delegate's call signature**, not merely where the identifier comes from. "Takes the id from the body" would still leave a `(req, res)` handler free to authenticate internally — which is precisely how the negative is safe. Handing a bare scalar to a service that never sees the request is what makes the vulnerability visible from the file alone, and visibility is the whole requirement for a fair positive.

That pair tests discrimination on visible evidence, which is the only thing that can be fairly tested. Note it lands in the *all-siblings-unguarded* branch, which is also the branch `_pending/auth-bypass-blanket-use/` found uncovered — the two pending sets converge there, and that is worth knowing before either is recorded.

## Hold-out status

Identical to `_pending/auth-bypass-blanket-use/`: outside `fixtures/auth-bypass/`, outside the manifest, read by nothing.

**Measured, covering both files of this pair.** The two-run `npm test` differential was re-run *after* the positive existed, so it covers all six files across both pending sets: 1892 lines each, exit 0 each, **0 differing lines after timestamps are stripped**, and `test:auth-bypass-prefilter` reporting `all 22 positive fixtures triggered` in both runs — not 23 or 24. Restore verified: 6 files, no scratch leftover.

Two earlier differentials covered smaller sets (blanket pair only, then this negative without its positive). Each gap was named at the time and closed by re-measuring rather than assumed away.

**F1 leak check, code regions only** (hold-out block excluded, marker located by line number): **0 hits** across all four fixtures — 55, 45, 72 and 72 code lines respectively. No comment in any code region asserts a safety property or names the expected verdict.

(Instrument note for a later reader: the differential script's restore probe originally tested a path one level too shallow and reported `restore verified: False` on successful restores; fixed to walk the tree, and it now reports `True (6 files)`. Separately, an `[array]::IndexOf` lookup of the hold-out marker returned −1 on its box-drawing characters, silently making the "code region" the whole file — which is why an earlier line count and diff figure for the blanket pair were wrong. Both are probe bugs, neither ever a lost file or a wrong conclusion.)

## Enabling checklist — a paid decision, not a file move

Both files, or neither. Landing the negative alone rebuilds the uninterpretable artifact this document argues against.

1. Delete the hold-out comment block from **both** files (F1 — it is model context).
2. Move them into `fixtures/auth-bypass/negative/` and `fixtures/auth-bypass/positive/` and renumber.
3. Add both ids to the manifest and to `EXPECTED_FLAGGED` in `auth-bypass.replay-spec.ts` — negative `false`, positive `true`.
4. Update that spec's header counts (45→47 fixtures, 37→39 model-reaching, 22→23 positives, 23→24 negatives) and `fixtures/auth-bypass/META.md`.
5. Re-read this prediction from git, then record.

**If the negative's prediction holds, do not land it as a passing negative.** A negative the detector flags is a failing gate, and per CLAUDE.md §5 the response is to stop and report, never to tune the prompt until the verdict comes out right (R8, R11).

**And if the positive's prediction holds, that is not licence to call the class handled.** A correct flag on the positive alongside a false flag on the negative is the "confidence carries no information" outcome, not a pass.
