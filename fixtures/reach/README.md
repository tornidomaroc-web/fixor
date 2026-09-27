# fixtures/reach — prefilter-anchored fixtures for reach patterns

One fixture per source, sink or route-declaration shape added by the detector-reach work
(2026-09-27, record under `docs/measurements/detector-reach-2026-09-27/`). They are exercised by
the FREE gate `npm run test:reach-prefilter` (in `test:ci`), which asserts that every fixture
reaches the model stage of its detector and that every new pattern id is hit by at least one
fixture here. A pattern without a fixture fails that gate.

What these fixtures are NOT: they are not in `fixtures/<detector>/`, so they are not in the
replay manifests, not in the stage-3 suites, and not in the recorded-medium census. No model
verdict has been recorded for any of them. The capability they anchor is REACH (the file is
sent to the model), never DETECTION. Promoting one into `fixtures/<detector>/` is a paid
recording, which is the owner's decision.

Positives and negatives both reach the model by design: the prefilter cannot tell an ownership
filter from its absence, the model can. A negative here is the safe twin the paid calibration
will need, written now so the shape's safe form is on file beside its vulnerable form.

Rules F1 to F4 in `docs/detector-test-rules.md` apply: no safety-asserting comments, and the
`// ASSUMED-PATH:` header sets the path the detector sees.
