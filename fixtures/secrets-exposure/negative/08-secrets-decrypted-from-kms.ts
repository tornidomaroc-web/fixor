// ASSUMED-PATH: src/app/handlers/secrets-exposure/08-secrets-decrypted-from-kms.ts
// src/server/secrets.ts
import "server-only";
import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";

// Secrets are stored encrypted on disk and decrypted once at boot using
// a KMS-supplied data key. Plaintext never touches version control.
function decryptSealed(path: string, key: Buffer, iv: Buffer): string {
  const sealed = readFileSync(path);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  return decipher.update(sealed).toString("utf8") + decipher.final("utf8");
}

const dataKey = Buffer.from(process.env.KMS_DATA_KEY ?? "", "base64");
const dataIv = Buffer.from(process.env.KMS_DATA_IV ?? "", "base64");

export const STRIPE_SECRET_KEY = decryptSealed(
  "/etc/acme/secrets/stripe.enc",
  dataKey,
  dataIv,
);
