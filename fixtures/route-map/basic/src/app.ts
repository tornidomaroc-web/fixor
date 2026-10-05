import express from "express";
import { requireAuth } from "./auth";
import { usersRouter } from "./routes/users";
import adminRouter from "./routes/admin";

const app = express();
app.use(express.json());
app.get("/health", (_req, res) => {
  res.send("ok");
});
app.use("/api/users", requireAuth, usersRouter);
app.use("/api/admin", adminRouter);

export default app;
