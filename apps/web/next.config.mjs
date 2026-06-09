import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Trace from this app's own directory. apps/grid is self-contained (no workspace
// deps), so this is correct locally AND on Vercel (where the app is the deploy
// root). Using the monorepo root here breaks Vercel — it points above path0.
const appDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: appDir,
};

export default nextConfig;
