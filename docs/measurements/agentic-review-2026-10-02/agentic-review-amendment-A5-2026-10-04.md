# Agentic change review, amendment A5, 2026-10-04. Committed before any case run.

Amends A1 section 2 (Gate A, the clean bound) by reference; the pre-registration and A1 to A4 are
left byte-identical. Agreed with the owner on 2026-10-04: the clean-flag limit becomes at most 1 of
6, keeping A1's rate of 30% or less.

## 1. The gap

A1 says "at most 3 of the 10 clean changes flagged". The preparation completed on 2026-10-04 with
6 clean changes, not 10 (build record, 2026-10-04 addendum: rows 03, 06, 07 and 10 are rejected by
A1 3.2's own rule; the manifest is frozen, sha256 `c08461563ade…a9c254`). Read literally, the
bound would admit 3 of 6, half the noise set, and the scorer as built applied that absolute 3.

## 2. The rule that binds

The clean bound is A1's rate over the prepared clean changes: **at most floor(3n/10) flagged, where
n is the number of clean changes with a prepared state.** For the frozen manifest, n = 6 and the
bound is **at most 1 of 6**. With n = 10 it is A1's 3 of 10, so A1 is unchanged wherever it was
meant to apply. Rounding is down: 2 of 6 (33%) would exceed A1's rate.

The definition of a flagged clean change (any finding on at least 4 of 5 runs), the 4-hit side of
Gate A, A4's counting of unreviewable runs and every other rule are unchanged.

## 3. What this does and does not fix

- The gate verdict now reads the bound: its reason ends "N of 6 clean changes flagged (at most 1
  of 6)", and `results.json` carries `maxCleanFlags` and `plannedClean`. Implemented in `4148991`;
  the rehearsal checks 1 of 6 continuing, 2 and 3 of 6 stopping, and the verdict text.
- **Not fixed: the noise set is small and mostly not route-shaped.** Only clean 02 and 09 are
  route-shaped; 01, 04, 05 and 08 are A1 3.2 fallbacks. A reviewer that flags only route handlers
  could be silent on four of the six without being tested. With n = 6, one flagged change is
  within the bound and two are not; there is no finer resolution. This is recorded, not changed:
  refilling the set would change the draw after the preparation, and the owner chose the bound.

## 4. Nothing else changes
