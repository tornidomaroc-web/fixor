// ASSUMED-PATH: src/app/handlers/secrets-exposure/11-openai-project-key-placeholder.ts
// src/config/openai.template.ts
// Template handed to new developers. The real value lives in .env.local.
export const OPENAI_API_KEY = "sk-proj-<your-project-key-here>";
export const OPENAI_ORG = "org-<your-org-id>";
