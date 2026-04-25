/**
 * Async-local context that carries the GitHub installation id from the
 * webhook handler down through every Claude call without changing
 * detector / fix-service signatures.
 *
 * The handler wraps the workflow in `costContext.run({ installationId },
 * () => runAuditorWorkflow(...))`. callClaude reads the current
 * installationId from this store and records cost against it.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface CostContextStore {
  installationId: string | number;
}

export const costContext = new AsyncLocalStorage<CostContextStore>();

export function currentInstallationId(): string | number | undefined {
  return costContext.getStore()?.installationId;
}
