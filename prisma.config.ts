// prisma.config.ts — Prisma 6.x configuration file.
//
// When this file exists, Prisma STOPS automatically loading .env files.
// So we must explicitly load .env here using dotenv.
//
// If you don't need any custom Prisma config, you can also just DELETE this
// file — Prisma will then auto-load .env as in older versions.
//
// This file is loaded by the Prisma CLI (migrate, db push, generate, validate).
// It runs in Node, so you can use require/import.

import { config } from "dotenv";
import { join } from "path";

// Load .env from the project root (where package.json lives)
config({ path: join(process.cwd(), ".env") });

// Optional: also load .env.local if present (Next.js convention)
config({ path: join(process.cwd(), ".env.local"), override: true });

// Prisma config — currently we don't need any custom options, but the file
// must exist if you want to customize anything in the future.
// See: https://www.prisma.io/docs/reference/api-reference/prisma-config-reference
export default {
  // Add custom config here if needed, e.g.:
  // earlyAccess: true,
};
