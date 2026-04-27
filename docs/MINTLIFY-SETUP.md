# Mintlify docs site — setup

> **Status (2026-04-27):** docs source is checked in at `docs/mintlify/`. Mintlify account creation, GitHub integration, and the `docs.fixor.dev` custom-domain DNS are operator actions — there's no automation here.

The docs site at `docs.fixor.dev` is a Mintlify-hosted rendering of the MDX files in this repo's `docs/mintlify/` folder. Mintlify watches the repo and redeploys on every push to `main` that touches that path.

---

## 1. Account + GitHub integration

1. Sign up at <https://mintlify.com>. Free tier is fine for OSS — Mintlify offers free hosting for open-source projects.
2. **Connect GitHub** when prompted. Authorize Mintlify on `tornidomaroc-web/fixor`.
3. **Pick the docs folder**: `docs/mintlify`. This is the only field in the wizard that matters; the rest can stay default.
4. **Pick the production branch**: `main`.

After the wizard finishes, Mintlify deploys an initial build to `https://<your-mintlify-subdomain>.mintlify.app`. Verify the navigation matches `docs/mintlify/docs.json` and that all six pages render.

## 2. Branding

`docs.json` already pins:

- **Primary color** `#f97316` (matches the landing's accent)
- **Dark mode color** `#0d1117` (matches the landing's background)
- **GitHub anchor** in the global nav
- **Status anchor** pointing at `status.fixor.dev`
- **CTA button** `Install Fixor` linking to the GitHub App install URL
- **Sign-in link** to `app.fixor.dev`

Mintlify wants a `favicon.svg` referenced in `docs.json`. Drop a 32x32 SVG of the Fixor shield (the same icon used inline in `landing/index.html`) into `docs/mintlify/favicon.svg` if you want a custom favicon — without it Mintlify falls back to a default and the site still renders.

## 3. Custom domain

1. In Mintlify dashboard → **Settings → Custom domain**, enter `docs.fixor.dev`.
2. Mintlify gives you a CNAME target. Add the record to your `fixor.dev` DNS (Cloudflare):
   ```
   docs   CNAME   <mintlify-cname-target>
   ```
3. Wait for propagation (usually < 5 min on Cloudflare). Mintlify auto-provisions a TLS cert.
4. Verify `https://docs.fixor.dev` redirects work.

If `fixor.dev` isn't registered yet (Phase 5G locked-decision), use the default Mintlify subdomain temporarily — link from the landing later.

## 4. Linking from the rest of the site

Once `docs.fixor.dev` is live, add a `Docs` link to:

- `landing/index.html` header nav (between logo and Install CTA)
- The dashboard's home-page header at `apps/dashboard/src/app/page.tsx`

Both are cheap edits that can land in their own follow-up PR — not part of 5F-4.

## 5. Updating the docs

The MDX files are checked in. Edit them like any other file in the repo:

```bash
git checkout -b docs/update-detectors
# edit docs/mintlify/detectors.mdx
git commit -am "docs: clarify XSS detector framework support"
git push origin docs/update-detectors
gh pr create
```

After merge, Mintlify rebuilds within ~30 seconds. No manual deploy step.

### Adding a new page

1. Create `docs/mintlify/<slug>.mdx` with frontmatter:
   ```mdx
   ---
   title: "Page title"
   description: "One-sentence summary."
   ---
   ```
2. Add `<slug>` to the relevant `pages` array in `docs.json`.
3. PR + merge. Mintlify picks up the new page on the next build.

### Local preview

```bash
npm i -g mint
cd docs/mintlify
mint dev
```

Renders at `http://localhost:3000` with hot reload.

## 6. Pre-launch checklist

- [ ] Mintlify account created, GitHub integration authorized
- [ ] Initial build green at the default Mintlify subdomain
- [ ] `docs.fixor.dev` CNAME added (or default subdomain in use)
- [ ] All six pages render without 404s on intra-doc links
- [ ] CTA button on the docs site reaches `github.com/apps/fixor/installations/new`
- [ ] Sign-in link reaches `app.fixor.dev`
- [ ] Footer links to Privacy / Terms / Security resolve
- [ ] `support@fixor.dev` is grep-replaced to your real address everywhere it appears (5 files: `quickstart.mdx`, `detectors.mdx`, `languages.mdx`, `api-reference.mdx`, `faq.mdx`)

## 7. After launch

- Mintlify supports analytics via Google Analytics or Plausible. We don't enable any tracker by default (matches the no-tracking story in `privacy.html`). If you do enable one later, update the privacy page section 6 ("Cookies and tracking") in the same PR.
- Each MDX page has Mintlify's "Edit this page" link auto-wired to the GitHub source. External contributors can land docs PRs without touching the code path.
- **Versioning**: Mintlify supports it (`v1`, `v2` in `docs.json`). Don't enable until we actually have breaking API changes — premature versioning is more confusing than no versioning.
