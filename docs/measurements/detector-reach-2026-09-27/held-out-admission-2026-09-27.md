# Detector reach, held-out arm: admission, frozen 2026-09-27

Frozen and committed BEFORE any prefilter, pattern or path rule changed, and before any of these
files was opened for reading. The only anchor for that ordering is git: the commit that carries
this file also carries `reach-baseline-2026-09-27.json`, measured at `main` = `c3646bd`, and it
lands ahead of the commit that changes any detector. Selection used advisory metadata and the
fix commit's file list only.

## Why a second set

Arm A (`docs/measurements/field-trial-2026-09-19/`) is the set the reach work was asked to fix,
so any pattern written against its seven unreached cases is by construction tuned to them. Reach
on Arm A after the change is a check that the patterns do what they were written to do. Reach on
THIS set is the only figure that says anything about real code the patterns were not written
against. Report both, always separately.

## Admission rule (Arm A's, with two deviations stated below)

Source: GitHub Advisory Database, `type=reviewed`, `ecosystem=npm`, published
2024-01-01..2026-09-27, the same 18 CWEs as Arm A. 971 advisories matched on 2026-09-27.

An advisory is admitted when ALL hold:

1. Its source repository is a self-hosted, multi-user web application with an HTTP API and user
   accounts, written in TypeScript or JavaScript. Libraries, frameworks, SDKs, CLIs, MCP servers,
   dev tools and single-user desktop apps are out. **This rule is a judgment**, made from the
   repository name and the advisory summary, and every repository it was applied to is listed
   below so the judgment can be disputed.
2. The repository is named nowhere in this repository's tracked tree (`git grep -il owner/name`),
   and it is not one of the twelve Arm A repositories. `lobehub/lobehub` is excluded as the renamed
   Arm A case 07 repository.
3. Its summary describes one of Fixor's six lanes; the lane was assigned from the summary and the
   CWE alone.
4. It cites at least one fix commit in the same repository; the FIRST cited commit is used. That
   commit resolves via the API, has exactly one parent, and modifies between 1 and 10 non-test
   `.ts/.tsx/.js/.jsx/.mjs/.cjs` files.
   **Deviation 1:** the non-test filter is Arm A's (`test`, `tests`, `__tests__`, `spec`, `e2e`,
   `fixture(s)`, `example(s)`, `demo` segments and `*.test.*` / `*.spec.*` names) **without the
   `scripts` segment**. Arm A's filter hid case 05's root-cause file under `server/runtime/scripts/`;
   this set must be able to show whether a `scripts` path rule matters, so it does not pre-remove
   such files.
5. At most one advisory per repository: the most recent qualifying one, ties (same publication
   day) broken by the lowest GHSA id. When the most recent fails rule 4, the next most recent is
   tried.

**Deviation 2:** only the vulnerable PARENT side of each file is fetched. Reach is measured on the
vulnerable file; there is no paired fix-side run in this arm because nothing here is scored by
verdict, only by whether a lane-family detector calls the model.

## Pool, mechanically

| step | count |
|---|---|
| advisories matching the query | 971 |
| distinct repositories with a `source_code_location` | 227 |
| repositories with at least one same-repository `/commit/` reference | 149 |
| of those, not an Arm A repository | 137 |
| of those, not named in the tracked tree (rule 2) | 131 |

## Rule 1 applied (the judgment, listed)

Read as application-shaped from the 131 and carried to rules 3 to 5: `deepstreamIO/deepstream.io`,
`erxes/erxes`, `finos/git-proxy`, `kottster/kottster`, `louislam/uptime-kuma`, `medplum/medplum`,
`misskey-dev/misskey`, `nocobase/nocobase`, `parse-community/parse-dashboard`,
`parse-community/parse-server`, `rejetto/hfs`, `Sync-in/server`, `Unleash/unleash`,
`vendurehq/vendure`, `whyour/qinglong`, `Yonle/bostr`.

Two of these are borderline and are admitted with the doubt stated: `parse-server` is installed as
a package and mounted in Express, which reads as a framework, but it ships user accounts, sessions
and an HTTP API out of the box and is run as a server; `bostr` is a Nostr relay bouncer with
per-user authentication rather than a conventional web application.

Read as out under rule 1 and not carried further, by kind: libraries and SDKs (`better-auth`,
`next-auth`, `node-saml`, `xml-crypto`, `fast-jwt`, `axios`, `undici`, `follow-redirects`, `forge`,
`elliptic`, `openpgpjs`, `workos/*`, `auth0/*`, `hono`, `koajs/router`, `feathers`, `nestjs/nest`,
`apollo*`, `mercurius`, `sanitize-html`, `liquidjs`, `payload` plugins, `next-video`,
`matrix-*-sdk`, `libp2p`, `baileys`, `whatsapp-api-js`, `sjcl`, `secp256k1-node`, `sm-crypto`,
`jsrsasign`, `altcha-lib`, `samlify`, `kiota`, `urllib`, `phin`, `wreck`, `axios-cache-interceptor`,
`swagger-typescript-api`), frameworks and build tools (`react-router`, `sveltejs/kit`, `astro`,
`nuxt`, `vite`, `vitest`, `angular`, `electron*`, `playwright`, `postcss`, `jspdf`, `shescape`,
`mediasoup`, `fedify`, `shakapacker`, `astro-shield`, `typespec`, `prompty`, `rsdoctor`,
`docusaurus-plugin-content-gists`, `valtimo-frontend-libraries`, `sentry-react-native`,
`react-native-mmkv`), contracts and cloud tooling (`ens-contracts`, `openzeppelin-*`, `aa-sdk`,
`modular-account`, `aws-cdk`, `amplify-cli`, `cloudflare/workers-sdk`, `vercel/workflow`),
single-user or desktop tools (`unity-cli`, `tabby`, `magicmirror`, `mockoon`, `opencode`,
`claude-code-templates`, `claudecodeui`, `openclaude`, `codewhale`, `claw-orchestrator`,
`network-ai`, `omniroute`, `9router`, `gittensory`, `summarize`, `knowns`, `openlearnx`, `taylored`,
`url-to-png`, `openclaw` with its 225 advisories), other languages (`dagu` Go, `mlflow` Python),
and every MCP server (`agenticmail`, `mcp-documentation-server`, `deepseek-mcp-server`,
`dynatrace-mcp`, `camofox-mcp`, `line-desktop-mcp`, `mcpjam/inspector`,
`modelcontextprotocol/inspector`, `gitlab-mcp`, `ckan-mcp-server`, `n8n-mcp`, `dbhub`).

## Rules 3 to 5 applied

| repository | advisory tried | rule | outcome |
|---|---|---|---|
| medplum/medplum | GHSA-m44r-7c5h-m6mj | 3 | CWE-345/601 redirect-URI validation: not one of the six lanes |
| nocobase/nocobase | GHSA-v8vm-cqh8-q87q, GHSA-wrwh-c28m-9jjh | 3 | SQL blacklist / SQL validation bypass: not one of the six lanes |
| rejetto/hfs | GHSA-5f4x-hwv2-w9w2 | 3 | CWE-78 command execution: not one of the six lanes |
| kottster/kottster | GHSA-j3w7-9qc3-g96p | 3 | CWE-78 in development mode: not one of the six lanes |
| finos/git-proxy | GHSA-39p2-8hq9-fwj6, GHSA-qr93-8wwf-22g4 | 4 | both cite `a620a2f`, which has 2 parents; GHSA-v98g (CWE-200 hidden commits) fails rule 3 |
| Sync-in/server | GHSA-92cr-jxw4-5wjg | 4 | fix commit `3ec74e2` modifies 21 non-test files |

## Admitted (10)

| # | advisory | repository | lane family / primary | CWE | fix commit | files |
|---|---|---|---|---|---|---|
| 01 | GHSA-89vx-jh4q-vg3w | deepstreamIO/deepstream.io | access-control / admin-check | 862 | 1c2adde6581c53ef47e204364bc740bc3c2e2e2a | 1 |
| 02 | GHSA-7rhv-xm4q-wh42 | erxes/erxes | access-control / auth-bypass | 284, 287 | 4ed2ca797241d2ba0c9083feeadd9755c1310ce8 | 3 |
| 03 | GHSA-c7hf-c5p5-5g6h | louislam/uptime-kuma | access-control / auth-bypass | 862 | 303a609c05d0b174a5045c90f53c2b557d4febae | 1 |
| 04 | GHSA-496g-mmpw-j9x3 | misskey-dev/misskey | access-control / idor | 862 | dc77d59f8712d3fe0b73cd4af2035133839cd57b | 4 (1 added by the fix, absent at the parent) |
| 05 | GHSA-qwc3-h9mg-4582 | parse-community/parse-dashboard | access-control / auth-bypass | 306 | f92a9ef5246d57e51696bd881a15f3b133b2bb50 | 1 |
| 06 | GHSA-hpm8-9qx6-jvwv | parse-community/parse-server | access-control / idor | 285 | 053109b3ee71815bc39ed84116c108ff9edbf337 | 1 |
| 07 | GHSA-5ffh-6f9q-5hhr | Unleash/unleash | access-control / idor | 639, 863 | 43e8db37b846921c8a94db58b44935ecbd15d9d1 | 1 |
| 08 | GHSA-6j36-r6pr-59x4 | vendurehq/vendure | access-control / auth-bypass | 287 | 3bb04718ea4f9395fda731bd2a4bcfc3afb0a485 | 2 |
| 09 | GHSA-v667-gc2r-2xm7 | whyour/qinglong | access-control / auth-bypass | 287 | 6bec52dca158481258315ba0fc2f11206df7b719 | 1 |
| 10 | GHSA-5cf7-cxrf-mq73 | Yonle/bostr | access-control / auth-bypass | 285 | 49181f4ec9ae1472c6675cab56bbc01e723855af | 1 |

The parent commit of every fix is in the manifest. Every admitted case is in the access-control
family (auth-bypass, admin-check, idor). A case is "reached" when any of those three detectors
calls the model on any of its files: the Arm A pre-registration's family rule, kept here so the
two sets read on the same scale. The per-lane reading, which is stricter, is derivable from
`byDetector` in the baseline file.

The corpus is NOT committed (third-party source; this repository is public). It sits beside the
repository at `held-out-corpus-2026-09-27/known-answer/<case>/<path>`, and
`held-out-corpus-manifest-2026-09-27.tsv` carries every file's repository, fix commit, parent and
git blob sha, so every row can be re-fetched and checked with
`gh api repos/<repo>/contents/<path>?ref=<parent> --jq .sha`. All 14 blobs were checked against
the API's `sha` at fetch time (sha1 over `blob <len>\0<bytes>`).

## Known limits, stated before any result

- n = 10. No rate is published from this arm; it is a count.
- One reader applied rule 1 and rule 3. The lists above are the whole audit trail.
- The population is the same GitHub-reviewed npm set Arm A drew from, so the two sets share every
  bias of that source; the held-out set is independent of Arm A's CASES, not of its POPULATION.
- Reach is not detection. A case that reaches the model can still be answered "not vulnerable",
  which is exactly what happened to all five Arm A cases that reached (35 verdicts, 35 negative).
- The author of the patterns that follow this commit had, at the time of this commit, seen the
  held-out files' PATHS (printed by the fetch) and the fix commits' file lists, and had not opened
  any held-out file's contents. That claim is anchored only by the commit order and this sentence.
