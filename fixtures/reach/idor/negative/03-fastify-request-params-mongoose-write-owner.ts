// ASSUMED-PATH: src/routes/notes.ts
import type { FastifyInstance } from "fastify";
import { Note } from "../models/note";

export async function noteRoutes(server: FastifyInstance) {
  server.patch("/notes/:noteId", { preHandler: [server.authenticate] }, async (request) => {
    const noteId = request.params.noteId;
    const { title, body } = request.body as { title?: string; body?: string };
    const updated = await Note.findOneAndUpdate(
      { _id: noteId, owner: request.user.id },
      { title, body },
      { new: true },
    );
    return updated;
  });
}
