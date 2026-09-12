// ASSUMED-PATH: api_tests/src/shared.ts
// api_tests/src/shared.ts
// Shared helpers for the API test suite: a throwaway account on a local instance.
export const alphaUser = { username: "lemmy_alpha", password: "lemmylemmy" };
export const alphaUrl = "http://127.0.0.1:8541";

export async function loginAlpha(): Promise<string> {
  const res = await fetch(`${alphaUrl}/api/v3/user/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username_or_email: alphaUser.username, password: alphaUser.password }),
  });
  return (await res.json()).jwt as string;
}
