/* Generates the Documenso deal-readiness audit SAMPLE report as a polished
 * PDF via pdfkit (the only PDF tool available on this machine). Output:
 * outputs/documenso-deal-readiness-audit-sample.pdf */
const PDFDocument = require("pdfkit");
const fs = require("node:fs");
const path = require("node:path");

const OUT_DIR = path.join(__dirname, "..", "outputs");
const OUT = path.join(OUT_DIR, "documenso-deal-readiness-audit-sample.pdf");
fs.mkdirSync(OUT_DIR, { recursive: true });

const INK = "#1f2430";
const MUTED = "#6b7280";
const ACCENT = "#1d4ed8";
const RULE = "#d1d5db";
const CODEBG = "#f3f4f6";
const OKGREEN = "#15803d";

const doc = new PDFDocument({
  size: "LETTER",
  margins: { top: 70, bottom: 64, left: 64, right: 64 },
  bufferPages: true,
  info: {
    Title: "Deal-Readiness Security Audit - Documenso (Sample)",
    Author: "Abo Jad",
  },
});
doc.pipe(fs.createWriteStream(OUT));

const PAGE_W = doc.page.width;
const LEFT = doc.page.margins.left;
const RIGHT = doc.page.width - doc.page.margins.right;
const CONTENT_W = RIGHT - LEFT;

function h1(text) {
  if (doc.y > doc.page.height - 160) doc.addPage();
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(14.5).fillColor(INK).text(text, LEFT, doc.y);
  doc.moveTo(LEFT, doc.y + 3).lineTo(RIGHT, doc.y + 3).lineWidth(0.75).strokeColor(RULE).stroke();
  doc.moveDown(0.6);
}
function h2(text) {
  if (doc.y > doc.page.height - 130) doc.addPage();
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(ACCENT).text(text, LEFT);
  doc.moveDown(0.25);
}
function p(text) {
  doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(text, LEFT, doc.y, {
    width: CONTENT_W,
    align: "left",
    lineGap: 2.5,
  });
  doc.moveDown(0.5);
}
function bullet(text) {
  const x = LEFT + 14;
  const startY = doc.y;
  doc.font("Helvetica").fontSize(10.5).fillColor(ACCENT).text("•", LEFT + 2, startY, { lineBreak: false });
  doc.fillColor(INK).text(text, x, startY, { width: CONTENT_W - 14, lineGap: 2 });
  doc.moveDown(0.35);
}
function check(label, text) {
  const startY = doc.y;
  if (startY > doc.page.height - 110) { doc.addPage(); }
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(OKGREEN).text("✓", LEFT + 2, y, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(label + "  ", LEFT + 18, y, { continued: true, width: CONTENT_W - 18, lineGap: 2 });
  doc.font("Helvetica").fillColor(INK).text(text);
  doc.moveDown(0.4);
}
function code(lines) {
  const fontSize = 8.6;
  const pad = 8;
  const lineH = fontSize + 2.6;
  const boxH = lines.length * lineH + pad * 2;
  if (doc.y + boxH > doc.page.height - doc.page.margins.bottom) doc.addPage();
  const top = doc.y;
  doc.rect(LEFT, top, CONTENT_W, boxH).fill(CODEBG);
  doc.font("Courier").fontSize(fontSize).fillColor("#111827");
  let y = top + pad;
  for (const ln of lines) {
    doc.text(ln, LEFT + pad, y, { width: CONTENT_W - pad * 2, lineBreak: false });
    y += lineH;
  }
  doc.y = top + boxH + 6;
  doc.fillColor(INK);
}

/* ---------- Cover ---------- */
doc.font("Helvetica-Bold").fontSize(11).fillColor(MUTED).text("DEAL-READINESS SECURITY AUDIT", LEFT, 150, { characterSpacing: 1.5 });
doc.moveDown(0.5);
doc.font("Helvetica-Bold").fontSize(34).fillColor(INK).text("Documenso", LEFT);
doc.moveDown(0.2);
doc.font("Helvetica").fontSize(15).fillColor(ACCENT).text("Authorization Surface Assessment", LEFT);
doc.font("Helvetica-Oblique").fontSize(12).fillColor(MUTED).text("Sample Report", LEFT);
doc.moveTo(LEFT, 320).lineTo(RIGHT, 320).lineWidth(1).strokeColor(RULE).stroke();
let cy = 340;
doc.font("Helvetica").fontSize(10.5).fillColor(INK);
doc.text("Date:  2026-05-28", LEFT, cy); cy += 18;
doc.text("Prepared by:  Abo Jad, Independent Application Security Practitioner", LEFT, cy); cy += 18;
doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(
  "Scope:  Authentication, access control, IDOR, session, secrets, and webhook surface review.",
  LEFT, cy, { width: CONTENT_W }
);
doc.font("Helvetica-Oblique").fontSize(9).fillColor(MUTED).text(
  "This is a sample of the deliverable a client receives. Documenso is an open-source project (MIT); this assessment reviews its public source and was produced without engagement.",
  LEFT, doc.page.height - 130, { width: CONTENT_W }
);

doc.addPage();

/* ---------- Executive summary ---------- */
h1("Executive Summary");
p("This audit reviews the authorization surface of Documenso, an open-source document-signing platform built on React Router v7 (the Remix successor) with a TypeScript/Node stack. The review covered the application's API and authenticated route surface: the public api+ resource routes, the authenticated route tree (_authenticated+), and the admin route tree (admin+).");
p("The headline result is that Documenso's authorization posture is well-architected. Authentication is not scattered across individual handlers; it is enforced structurally at a single pathless parent layout that gates the entire authenticated surface, with a nested admin layout adding role enforcement for administrative routes. The public API surface is either public by design (branding assets, health, locale) or delegates verification correctly (Stripe and internal webhooks verify signatures before acting). No verified-real authorization bypass, broken access control, or IDOR was found in the reviewed surface.");
p("The deal-readiness bottom line: Documenso would present strongly in an enterprise security review on the authorization dimension. The auth model is centralized, consistent, and reviewable, which is exactly what a reviewer wants to see. The residual considerations in this report are forward-looking hardening recommendations, not findings, and the most important one (the read-versus-write behavior of the parent-layout pattern) is a framework-level subtlety worth documenting before it becomes a footgun for a future contributor.");

/* ---------- Scope & methodology ---------- */
h1("Scope and Methodology");
h2("In scope");
p("The deal-readiness wedge: authentication enforcement, authorization and role gating, tenant/ownership scoping (IDOR), session handling, secrets and environment-variable exposure, and webhook signature verification. Stacks reviewed: TypeScript/Node on React Router v7 (file-system routing).");
h2("Out of scope");
p("Dependency CVE scanning, infrastructure and cloud configuration, cryptographic implementation review, and full penetration testing. This is a focused review of the authorization patterns enterprise reviews and vendor questionnaires flag, not a substitute for a full assessment.");
h2("How it was conducted");
p("The assessment is LLM-assisted and human-verified. An automated pass (Fixor, the open-source tool the author builds) scanned the route surface for the wedge categories. Every candidate signal was then verified by hand against the full handler and its ancestor layout files, ruling out cross-file guards before drawing any conclusion. A clean result here means a route was confirmed gated by reading the code, not assumed clean because a tool stayed silent.");

/* ---------- Auth-surface map ---------- */
h1("Authorization Surface Map");
p("Documenso routes authorization through React Router v7 pathless layouts. The mechanism is consistent across the authenticated surface:");
h2("Authentication gate (entire authenticated surface)");
p("app/routes/_authenticated+/_layout.tsx owns every route nested beneath it. Its loader resolves the session and redirects unauthenticated requests before any child route runs:");
code([
  "// app/routes/_authenticated+/_layout.tsx",
  "export async function loader({ request }: Route.LoaderArgs) {",
  "  const session = await getOptionalSession(request);",
  "  if (!session.isAuthenticated) {",
  "    throw redirect('/signin');",
  "  }",
  "  return null;",
  "}",
]);
h2("Admin role gate (admin subtree)");
p("app/routes/_authenticated+/admin+/_layout.tsx nests under the authentication gate and adds a role check, so admin routes require both an authenticated session and an admin role:");
code([
  "// app/routes/_authenticated+/admin+/_layout.tsx",
  "export async function loader({ request }: Route.LoaderArgs) {",
  "  const { user } = await getSession(request);",
  "  if (!user || !isAdmin(user)) {",
  "    throw redirect('/');",
  "  }",
  "  return null;",
  "}",
]);
p("Because routes nest under both layouts, a request to an admin route runs the authentication loader and the admin loader before the route's own loader. A child route therefore needs no in-file auth check to be protected; the protection is inherited. Routes such as admin+/stats, admin+/users._index, and admin+/organisations.$id read administrative data with no in-file check and are nonetheless correctly gated by the layout chain above them.");
h2("Public API surface (api+)");
p("The api+ resource routes are either public by design or delegate verification:");
bullet("Webhook receivers verify signatures before acting: the Stripe receiver uses stripe.webhooks.constructEvent against the signing secret; the internal trigger receiver requires an x-webhook-signature header and validates it with a custom HMAC verify() before processing. Both reject missing or invalid signatures.");
bullet("Public-by-design assets: avatar images, organisation/team branding logos, certificate-status, health, locale, and theme endpoints serve non-sensitive content intended to be publicly reachable (for example, branding shown on unauthenticated signing pages).");

/* ---------- Findings ---------- */
h1("Findings");
p("No verified-real authorization-bypass, broken-access-control, or IDOR finding was identified in the reviewed surface. The table below records what was checked and the outcome, categorized by the deal-readiness pattern each maps to.");
check("Authentication enforcement:", "Pass. All _authenticated+ routes are gated by the parent-layout session check; no authenticated route was found relying on a missing in-file check without layout coverage.");
check("Authorization / role gating:", "Pass. admin+ routes are gated by the nested admin-role layout (isAdmin) in addition to authentication.");
check("Tenant scoping / IDOR:", "Pass on the reviewed handlers. Resource lookups in the reviewed routes are scoped (for example, document and team reads resolve against the requesting context), with no unscoped request-id-to-database lookups identified.");
check("Webhook verification:", "Pass. Inbound webhooks verify signatures (Stripe constructEvent; custom HMAC on the internal trigger) before processing.");
check("Secrets / environment exposure:", "Pass in the reviewed surface. No hardcoded credentials or unguarded secret exposure identified in the scanned routes; secrets are read from the environment.");
p("A clean result on the authorization wedge is itself the positive deal-readiness signal a reviewer is looking for: it indicates a deliberate, centralized auth design rather than ad-hoc per-handler checks that drift over time.");

/* ---------- Deal-readiness mapping ---------- */
h1("Deal-Readiness Mapping");
p("The statements below map the codebase's posture to the items enterprise security reviews and SOC 2 / vendor questionnaires commonly check. Each is written so it can be handed to a reviewer with this report attached as supporting evidence.");
check("Authentication:", "Enforced on all non-public routes via a pathless parent-layout loader (_authenticated+/_layout.tsx) that redirects unauthenticated requests before any handler executes.");
check("Authorization (RBAC):", "Administrative routes require an admin role, enforced by a nested admin layout (admin+/_layout.tsx) performing isAdmin(user) on top of authentication.");
check("Access control / IDOR:", "Resource access in the reviewed handlers is scoped to the requesting context; no unscoped object-by-id lookups were identified in the reviewed surface.");
check("Session management:", "Session resolution is centralized in the auth layer and consulted at the layout boundary, not reimplemented per route.");
check("Webhook integrity:", "Inbound webhooks (payment and internal triggers) verify signatures before processing, rejecting unsigned or invalid requests.");
check("Secrets handling:", "Secrets are sourced from the environment; no hardcoded credentials were identified in the reviewed routes.");

/* ---------- Recommendations ---------- */
h1("Prioritized Recommendations");
p("These are forward-looking hardening recommendations, not findings. They strengthen an already-solid posture and pre-empt the most likely future regressions.");
h2("1. Treat the parent-layout gate as a read-time control, not a write-time one");
p("In the React Router v7 / Remix request lifecycle, a parent layout loader runs before child loaders on a read (GET), but a child route's action runs before parent loaders on a mutation. A destructive action in the authenticated subtree is therefore NOT gated by the parent layout's loader the way a read is. The reviewed mutations route through tRPC and self-authenticate, so this is not a current finding; but any route action added under _authenticated+ should carry its own inline auth/ownership check rather than relying on the layout. This is the single most important thing to document for contributors.");
h2("2. Add an explicit per-action authorization check alongside the layout pattern");
p("For routes that expose an action, pair the inherited layout authentication with an explicit in-handler authorization assertion keyed on the authenticated user. This makes each mutation self-contained and removes any dependence on lifecycle ordering.");
h2("3. Document the authorization model");
p("The centralized layout-gating pattern is a strength precisely because it is consistent. A short SECURITY or CONTRIBUTING note describing where auth lives (_authenticated+ and admin+ layouts) ensures future routes preserve it rather than reintroducing per-handler drift.");
h2("4. Guard the convention boundary");
p("Routes added outside the +-folder nesting convention (or using a trailing-underscore opt-out that detaches a route from its parent layout) will not inherit the gate. A lightweight check or review rule that any new authenticated route nests correctly under _authenticated+ would close the most likely future gap.");
h2("5. Keep webhook verification co-located with the handler");
p("Webhook verification currently lives in delegated handlers. Keeping the verification call visible at or near each route entry point (rather than several modules away) keeps the security-relevant logic auditable as the codebase grows.");

/* ---------- Closing ---------- */
h1("Closing");
p("This assessment focused on the authorization surface and the deal-readiness wedge. It did not cover dependency vulnerabilities, infrastructure and deployment configuration, cryptographic implementation, or runtime penetration testing; a complete security program should address those separately. Within its scope, Documenso's authorization architecture is well-designed and would present strongly in an enterprise security review.");
p("Prepared by Abo Jad, independent application security practitioner. Contact: abojad@fixor.dev. Tooling: Fixor (open source), github.com/tornidomaroc-web/fixor.");

/* ---------- Headers / footers on content pages ---------- */
const range = doc.bufferedPageRange();
for (let i = range.start + 1; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  doc.font("Helvetica").fontSize(8).fillColor(MUTED);
  doc.text("Deal-Readiness Security Audit  ·  Documenso (Sample)", LEFT, 38, { width: CONTENT_W, align: "left", lineBreak: false });
  doc.text("Abo Jad", LEFT, 38, { width: CONTENT_W, align: "right", lineBreak: false });
  doc.moveTo(LEFT, 52).lineTo(RIGHT, 52).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.fillColor(MUTED).fontSize(8).text(
    "Page " + (i - range.start + 1) + " of " + range.count,
    LEFT, doc.page.height - 42, { width: CONTENT_W, align: "center", lineBreak: false }
  );
}

doc.flushPages();
doc.end();
console.log("Wrote", OUT);
