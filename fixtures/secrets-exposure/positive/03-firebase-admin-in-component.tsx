"use client";
import { initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Bundled the service account JSON so the dashboard can read collections
// directly without proxying through the API server.
const serviceAccount = {
  type: "service_account",
  project_id: "acme-app",
  private_key_id: "abc123",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nMIIEv...truncated...\n-----END PRIVATE KEY-----\n",
  client_email: "firebase-adminsdk@acme-app.iam.gserviceaccount.com",
} as const;

let app: App | undefined;
function getAdmin(): App {
  if (!app) {
    app = initializeApp({ credential: cert(serviceAccount as any) });
  }
  return app;
}

export async function fetchAllUsers() {
  const db = getFirestore(getAdmin());
  const snap = await db.collection("users").get();
  return snap.docs.map((d) => d.data());
}
