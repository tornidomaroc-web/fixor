# Field trial, known-answer arm: admission, frozen 2026-09-19

Frozen and hashed BEFORE any trigger, spy or model run touched these files. The selection below was
made from advisory metadata and fix-commit metadata only.

## Admission rule

Source: GitHub Advisory Database, `type=reviewed`, `ecosystem=npm`, published
2024-01-01..2026-09-19, CWE in {284, 285, 639, 862, 863, 306, 287, 288, 269, 425, 566, 347, 345,
798, 200, 215, 532, 1220}. 960 advisories matched on 2026-09-19.

An advisory is admitted when ALL hold:

1. Its source repository is a self-hosted, multi-user web application with an HTTP API and user
   accounts, written in TypeScript or JavaScript. Libraries, frameworks, CLIs and SDKs are out.
2. The repository is named nowhere in this repository's tracked tree (the mechanical exclusion:
   that is where prompt tuning or earlier measurement would have left a trace). This removes, among
   others, flowiseai/flowise, payloadcms/payload, paperclipai/paperclip, TryGhost/Ghost,
   triggerdotdev/trigger.dev, strapi/strapi, and every fix-pairs and ICP corpus repository.
3. Its summary describes one of Fixor's six lanes: a route or endpoint missing authentication
   (auth-bypass), a privileged action missing a role or admin check (admin-check), an object
   reached without an ownership check (idor), an unverified webhook signature (webhook-unverified),
   environment or secret values exposed in a response or log (env-exposure), or a hardcoded
   credential (secrets-exposure). The lane was assigned from the summary text alone.
4. It cites at least one fix commit in the same repository; the FIRST cited commit is used. That
   commit resolves via the API, has exactly one parent, and modifies between 1 and 10 non-test
   `.ts/.tsx/.js/.jsx/.mjs/.cjs` files (test, spec, e2e, fixture, example, script and demo paths
   excluded). Above 10 files the commit is a bundled release and a hit cannot be attributed.
5. At most one advisory per repository: the most recent qualifying one, ties broken by the lowest
   GHSA id. When the most recent fails rule 4, the next most recent is tried.

## Admitted (12)

| # | advisory | repository | lane family / primary | fix commit | vulnerable parent | target files |
|---|---|---|---|---|---|---|
| 1 | GHSA-vjf3-2gpj-233v | n8n-io/n8n | access-control / admin-check | a70b2ea379086da3de103bb84811e88cadf29976 | 2bba053d09e310b142c684a406daa110a5ce3666 | 4 |
| 2 | GHSA-4qcj-m5wp-jmf4 | Budibase/budibase | access-control / admin-check | 93db77846e68231ba655f180581c94503985421a | 124e5df31a4725334c65aea3f4b37db6cb10d119 | 1 |
| 3 | GHSA-7cvf-pxgp-42fc | directus/directus | access-control / auth-bypass | 22be460c76957708d67fdd52846a9ad1cbb083fb | 859f664f56fb50401c407b095889cea38ff580e5 | 1 |
| 4 | GHSA-qmjj-p7m9-wjrv | actualbudget/actual | access-control / idor | 9966c024cb75f57943193cac8e42f401efed9d08 | ea937d100956ca56689ff852d99c28589e2a7d88 | 1 |
| 5 | GHSA-fwcm-rqvw-j3p7 | frangoteam/FUXA | access-control / auth-bypass | 78534da61a91613712b44bb63c8d7da8c5df5ca4 | 61b5cf41af63a60749ac39a285be66b693d19b94 | 2 |
| 6 | GHSA-xvf4-ch4q-2m24 | withstudiocms/studiocms | access-control / admin-check | aebe8bcb3618bb07c6753e3f5c982c1fe6adea64 | 9769cc160b06296b1a060389661061daa71ed231 | 1 |
| 7 | GHSA-j7xp-4mg9-x28r | lobehub/lobe-chat | access-control / idor | 2c1762b85acb84467ed5e799afe1499cd2f912e6 | a2947c91c712d7f61f6ecade18d6b52baa33709a | 6 |
| 8 | GHSA-m449-vh5f-574g | OneUptime/oneuptime | access-control / auth-bypass | 07bc6d4edde7397ea6b88f889c065ec392052ab4 | 8642a54fec5e976258f4f95a4dac4b4c8d5ba7de | 1 |
| 9 | GHSA-fpf5-w967-rr2m | SignalK/signalk-server | access-control / auth-bypass | ead2a03d8994969cafcca0320abee16f0e66e7a9 | 5c211eaf33f0ccadbaed6720264780d92afbd7f8 | 1 |
| 10 | GHSA-wr5r-wqp2-x4fh | apostrophecms/apostrophe | access-control / idor | d50c6ad61b9c1788958752358f1fca714cc8368c | 252635917446ec9b30c895181490220cab1fed26 | 1 |
| 11 | GHSA-g74q-6g2f-874x | tinacms/tinacms | access-control / auth-bypass | 0a927a4f8d228dd05ee7ca4be32899bc190e73af | c2c03c677f67b6fd3a2155d5227b9bf785b43288 | 4 |
| 12 | GHSA-8wq8-6859-qx77 | backstage/backstage | env-exposure / env-exposure | 3b62dd2d6bf7623ebd23e4b5a6dceb209f98dfce | 6042dd0c7f0706e0f473dafa92799ecf19c825ec | 1 |

Access-control family = auth-bypass, admin-check, idor. The lane assignment is a reading of a
one-line summary; where the summary reads as more than one lane, the family, not the primary lane,
is what scoring uses.

## Tried and not admitted, with the rule that removed each

| advisory | repository | rule | reason |
|---|---|---|---|
| GHSA-jh8h-6c9q-7gmw | n8n-io/n8n | 4 | fix commit modifies 20 non-test files (bundled release) |
| GHSA-3mwc-2cj7-gx8c | lunary-ai/lunary | 4 | cited commit returns 404 in the source repository |
| GHSA-w5xm-mx47-v7c8 | lunary-ai/lunary | 4 | cited commit returns 404; lunary has no admissible advisory |
| GHSA-32r3-57hp-cgfw | evershopcommerce/evershop | 4 | fix commit has 2 parents; 32 files |
| GHSA-ggpm-9qfx-mhwg | evershopcommerce/evershop | 4 | fix commit has 2 parents; 39 files; evershop has no admissible advisory |
| every flowise advisory | flowiseai/flowise | 2 | named in the tracked tree (the earlier CVE-surface probe) |

## Known limits of this set, stated before any result

- It is drawn from the GitHub-reviewed npm set, so only apps that publish an npm package appear.
  Apps that publish repository advisories without a package are not sampled.
- Model memorisation: every advisory is public. If the model saw the advisory or its fix in
  training, recall is inflated. Publication dates run 2025-07-15 to 2026-09-17; the model's
  training cutoff is not known to this measurement.
- n = 12. No rate from this arm is published as a rate; it is a count against a threshold.
