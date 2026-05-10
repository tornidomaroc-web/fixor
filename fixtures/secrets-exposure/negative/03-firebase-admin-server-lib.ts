// ASSUMED-PATH: src/app/handlers/secrets-exposure/03-firebase-admin-server-lib.ts
// src/lib/server/firebase-admin.ts
import "server-only";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Service account loaded from env. The private key is multi-line so we
// replace literal "\n" with newlines after reading.
const adminConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID!,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
};

if (!getApps().length) {
  initializeApp({ credential: cert(adminConfig) });
}

export const adminDb = getFirestore();
