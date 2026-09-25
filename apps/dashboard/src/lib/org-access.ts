/**
 * Who may do what with an org in the dashboard.
 *
 *   - SEE the org (scan history, trends, plan tier): anyone GitHub lists
 *     the installation to in GET /user/installations. GitHub lists it for
 *     anyone with explicit read access to ONE of its repositories, so this
 *     is a visibility check only. Scan rows are further limited to the
 *     repositories the user can open (scan-queries.ts).
 *   - ADMINISTER the org (settings, the Slack webhook, billing, spend and
 *     cap, the installer email): the installation's owner only.
 *       * personal-account installation: the account itself, by numeric
 *         id (GET /user).
 *       * organization installation: an ACTIVE org owner
 *         (GET /user/memberships/orgs/{org}: role "admin", state
 *         "active", organization.id == installation.account.id).
 *     These are the people GitHub lets install the App on that account.
 *     Settings and billing apply to every repository in the installation,
 *     including ones a collaborator cannot see.
 *
 * Anything else is a viewer, and so is every GitHub error. The membership
 * endpoint needs the App's "Members: read" organization permission; until
 * the App requests it, GitHub answers 403 and nobody administers an
 * organization installation from the dashboard.
 */
import "server-only";
import {
  githubUserGet,
  listFixorInstallations,
  type GitHubInstallation,
  type GitHubUserGet,
} from "@/lib/github";
import { getOrgForUser, type OrgRef } from "@/lib/scans-data";

export type OrgRole = "admin" | "viewer";

export type OrgAccess =
  | {
      status: "ok";
      org: OrgRef;
      installation: GitHubInstallation;
      role: OrgRole;
    }
  | { status: "not_found" }
  /** GitHub refused the user's token (lib/github.ts): a new sign-in is needed. */
  | { status: "unauthorized" }
  | { status: "github_unavailable" };

function field(body: unknown, key: string): unknown {
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)[key]
    : undefined;
}

export async function installationRole(
  inst: GitHubInstallation,
  get: GitHubUserGet = githubUserGet,
): Promise<OrgRole> {
  if (inst.target_type === "User") {
    const me = await get("/user");
    const id = me?.status === 200 ? field(me.body, "id") : undefined;
    return typeof id === "number" && id === inst.account.id
      ? "admin"
      : "viewer";
  }
  if (inst.target_type === "Organization") {
    const m = await get(
      `/user/memberships/orgs/${encodeURIComponent(inst.account.login)}`,
    );
    if (m?.status !== 200) return "viewer";
    const orgId = field(field(m.body, "organization"), "id");
    return field(m.body, "role") === "admin" &&
      field(m.body, "state") === "active" &&
      orgId === inst.account.id
      ? "admin"
      : "viewer";
  }
  return "viewer";
}

/**
 * The org by id with the caller's role. `not_found` covers both a missing
 * org and one the caller cannot see, so the id space stays unenumerable.
 */
export async function getOrgAccess(orgId: string): Promise<OrgAccess> {
  const result = await listFixorInstallations();
  if (result.status === "unauthorized") return { status: "unauthorized" };
  if (result.status !== "ok") return { status: "github_unavailable" };
  const allowed = result.installations.map((i) => String(i.id));
  const org = await getOrgForUser(orgId, allowed);
  if (!org) return { status: "not_found" };
  const installation = result.installations.find(
    (i) => String(i.id) === org.installationId,
  );
  if (!installation) return { status: "not_found" };
  return {
    status: "ok",
    org,
    installation,
    role: await installationRole(installation),
  };
}

/** Ids of the installations in the list the caller administers. */
export async function adminInstallationIds(
  installations: GitHubInstallation[],
): Promise<Set<string>> {
  const roles = await Promise.all(
    installations.map((i) => installationRole(i)),
  );
  return new Set(
    installations
      .filter((_, n) => roles[n] === "admin")
      .map((i) => String(i.id)),
  );
}
