import type { NextConfig } from "next";
import * as path from "path";

const nextConfig: NextConfig = {
  // Multi-package monorepo: silence the "multiple lockfiles" warning
  // by pinning Turbopack's root to apps/dashboard/. The backend lives
  // at the repo root with its own package-lock.json which is unrelated.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
