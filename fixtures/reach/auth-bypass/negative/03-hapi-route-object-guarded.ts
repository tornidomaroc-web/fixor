// ASSUMED-PATH: src/server/routes/users.ts
import Hapi from "@hapi/hapi";
import { users } from "../services/users";

export function registerUserRoutes(server: Hapi.Server) {
  server.route({
    method: "GET",
    path: "/users/{id}",
    options: { auth: "jwt" },
    handler: async (request) => users.get(request.params.id),
  });

  server.route({
    method: "DELETE",
    path: "/users/{id}",
    options: { auth: { strategy: "jwt", scope: ["admin"] } },
    handler: async (request) => {
      await users.remove(request.params.id);
      return { ok: true };
    },
  });
}
