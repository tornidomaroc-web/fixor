# Real-shape proof corpus

Realistic multi-file mini-apps used to prove Fixor's business-logic detectors
end-to-end on framework-shaped code, not just on isolated single-pattern
fixtures.

## Why this exists

`fixtures/<detector>/{positive,negative}/` holds **isolated** single-pattern
fixtures — each file exercises one regex/rubric shape in ~15 lines. They prove
the rubric is *calibrated*. They do not prove the detector behaves on a
realistic repo where vulnerable routes sit beside benign and properly-gated
siblings in the same module, which is what a real PR looks like.

Every real-world scan Fixor has run to date returned **0 findings** (inbox-zero
182/228 App Router routes, the FastAPI/Flask template clears) because those
repos are well-secured — a true negative, not a demonstrated catch. The
App Router and Remix surfaces each have a planted-vuln demo proving positive
detection (`fixor-demo-app-router`, `fixor-demo-remix`). The **Python
(FastAPI/Flask) detectors shipped 2026-05-28 had no equivalent positive demo** —
only synthetic fixtures and real-repo *clearing* validation. This corpus closes
that gap.

## Honesty rules for this corpus

- Scanned source files carry **no security-tell comments**. A real PR does not
  annotate its own bugs; tells would bias the LLM stage and invalidate the
  proof. Ground truth lives only in each app's `ground-truth.json`, which is not
  a `.py`/`.ts` file and is excluded from a `--ext=py` scan.
- The corpus proves **mechanism behavior on realistic shapes**. It is evidence,
  recorded as saved logs. It is never a precision/recall figure — per
  `docs/detector-capabilities.md` FP discipline.

## Two proof layers

1. **Deterministic prefilter-reachability (zero API)** — `npm run test:real-shape`.
   Runs the *real* detector prefilter regexes over the corpus and asserts:
   route handlers reach the correct detector's LLM stage (the silent-skip class
   that broke App Router pre-Phase-B), and utility modules do not over-match
   (the Remix `loader`/`action` over-match class). Reproducible, CI-able, free.

2. **Live LLM scan -> positive-detection baseline (budget-gated)** — run
   `npm run scan -- fixtures/real-shape/<app> --ext=py --yes --output=test-output/<log>`
   and confirm the planted vulns in `ground-truth.json` flag and the controls
   clear. Saved under `test-output/`.

## Apps

- `fastapi-saas/` — FastAPI + SQLModel SaaS API. Planted: auth-bypass
  (`DELETE /users/{user_id}`), admin-check (`POST /admin/users/{user_id}/role`),
  IDOR (`GET /items/{item_id}`). Six gated/benign controls.
