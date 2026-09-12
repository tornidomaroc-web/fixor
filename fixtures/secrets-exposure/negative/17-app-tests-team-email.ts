// ASSUMED-PATH: packages/app-tests/team-email.ts
// packages/app-tests/team-email.ts
// Helpers for the application test package; the user is created fresh per run.
export async function seedTeamMember(db: { insert: (row: object) => Promise<void> }) {
  const password = "Passw0rd!team";
  await db.insert({ email: "member@example.com", password, role: "member" });
  return password;
}
