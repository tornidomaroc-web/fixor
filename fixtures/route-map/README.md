# Route-map rehearsal fixtures

Synthetic Express applications written for `test:route-map-rehearsal`. No third-party code. Each
directory is one tree the extractor runs on; the rehearsal derives the negative controls (guard
removed, call chain cut, depth exceeded) from `basic/` by copying it and editing one line, so the
controls cannot drift from the positive case.
