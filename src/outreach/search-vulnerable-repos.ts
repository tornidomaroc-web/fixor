/**
 * GitHub issue search (open PRs) for outreach.
 * Requires GITHUB_TOKEN with search scope as documented for the Issues API.
 */

const GITHUB_API = "https://api.github.com";
const SEARCH_QUERY =
  '"req.body" "SELECT" "+" language:javascript type:pr state:open created:>2026-03-01';

type IssueSearchItem = {
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
};

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
}

function fullNameFromRepositoryUrl(repositoryUrl: string): string | null {
  const prefix = `${GITHUB_API}/repos/`;
  if (typeof repositoryUrl !== "string" || !repositoryUrl.startsWith(prefix)) {
    return null;
  }
  return repositoryUrl.slice(prefix.length);
}

async function searchOpenPullRequests(token: string): Promise<IssueSearchItem[]> {
  const url = new URL(`${GITHUB_API}/search/issues`);
  url.searchParams.set("q", SEARCH_QUERY);
  url.searchParams.set("per_page", "10");

  const res = await fetch(url, { headers: ghHeaders(token) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `issue search failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`
    );
  }
  const data = (await res.json()) as { items?: IssueSearchItem[] };
  return Array.isArray(data.items) ? data.items : [];
}

function printPrReport(
  repoFullName: string,
  prNumber: number,
  title: string,
  htmlUrl: string,
  ownerLogin: string
): void {
  console.log("---");
  console.log("Repo:", repoFullName);
  console.log("PR:", prNumber);
  console.log("Title:", title);
  console.log("URL:", htmlUrl);
  console.log("Owner:", ownerLogin);
  console.log();
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    console.error("Missing GITHUB_TOKEN in environment.");
    process.exitCode = 1;
    return;
  }

  const items = await searchOpenPullRequests(token);

  if (items.length === 0) {
    console.log("No pull request search results for this query.");
    return;
  }

  for (const item of items) {
    const fullName = fullNameFromRepositoryUrl(item.repository_url);
    if (!fullName || !fullName.includes("/")) {
      console.error("Skip invalid repository_url:", item.repository_url);
      continue;
    }
    const ownerLogin = fullName.split("/")[0] ?? "";
    printPrReport(
      fullName,
      item.number,
      item.title,
      item.html_url,
      ownerLogin
    );
  }
}

main().catch(console.error);
