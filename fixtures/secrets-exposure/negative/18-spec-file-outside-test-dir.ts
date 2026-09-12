// ASSUMED-PATH: src/modules/auth/services/auth.service.spec.ts
// src/modules/auth/services/auth.service.spec.ts
// A spec file colocated with the service it tests; the directory is not test-named.
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  it("rejects a wrong password", async () => {
    const service = new AuthService();
    const password = "wrong-password-1";
    await expect(service.login("user@example.com", password)).rejects.toThrow();
  });
});
