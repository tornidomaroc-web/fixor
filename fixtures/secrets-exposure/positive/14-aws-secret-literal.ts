// ASSUMED-PATH: src/app/handlers/secrets-exposure/14-aws-secret-literal.ts
// src/lib/uploader.ts
// Secret pasted directly; the access-key id is loaded from env at runtime,
// so only the secret literal is committed here.
const AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMIexampleFAKEsecretVALUEnot0real";

export const region = "us-east-1";
