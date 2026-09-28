// ASSUMED-PATH: src/server/routes/admin.ts
import Hapi from "@hapi/hapi";
import { billing } from "../services/billing";

export function registerAdminRoutes(server: Hapi.Server) {
  server.route({
    method: "GET",
    path: "/admin/billing/settings",
    options: { auth: { strategy: "jwt", scope: ["admin"] } },
    handler: async () => billing.getSettings(),
  });

  server.route({
    method: "PUT",
    path: "/admin/billing/settings",
    options: { auth: "jwt" },
    handler: async (request) => {
      await billing.updateSettings(request.payload);
      return { ok: true };
    },
  });
}
