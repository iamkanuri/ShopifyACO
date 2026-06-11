import process from "node:process";

// ===========================================================================
// Single source of truth for configuration. EVERY secret comes from an
// environment variable here and nowhere else — identical for local `.env`
// (loaded via dotenv) and Railway env vars. No file-based secret source.
//
// SECURITY: SUPABASE_SERVICE_ROLE_KEY, the API keys, and DATABASE_URL are
// SERVER-ONLY. They are never imported by the viewer bundle (the viewer is a
// separate Vite app that imports nothing from src/).
// ===========================================================================

const str = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export const ENV = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Production when NODE_ENV says so OR when running on Railway (safety net so we
  // never accidentally bind to localhost — and stay unreachable — in the cloud).
  get isProd() {
    return (
      (process.env.NODE_ENV ?? "development") === "production" ||
      Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID)
    );
  },
  port: Number(process.env.PORT ?? 8787),

  // Engine API keys (server-only).
  keys: {
    openai: str(process.env.OPENAI_API_KEY),
    google: str(process.env.GOOGLE_AI_API_KEY),
    perplexity: str(process.env.PERPLEXITY_API_KEY),
    anthropic: str(process.env.ANTHROPIC_API_KEY),
  },

  // Supabase (runtime data) + direct Postgres (migrations).
  supabaseUrl: str(process.env.SUPABASE_URL),
  supabaseServiceRoleKey: str(process.env.SUPABASE_SERVICE_ROLE_KEY),
  databaseUrl: str(process.env.DATABASE_URL),

  // Spend / storage.
  dailySpendCapUsd: Number(process.env.DAILY_SPEND_CAP_USD ?? 10),
  // Where result files live. On Railway this is the volume mount path (e.g. /data).
  dataDir: str(process.env.DATA_DIR) ?? "runs",

  // Free-scan abuse limits.
  freeScansPerEmailPerDay: Number(process.env.FREE_SCANS_PER_EMAIL ?? 2),
  freeScansPerIpPerDay: Number(process.env.FREE_SCANS_PER_IP ?? 2),
};

/** True when Supabase persistence is configured. */
export const hasSupabase = () => Boolean(ENV.supabaseUrl && ENV.supabaseServiceRoleKey);

/** Warn (don't crash) about anything important that's missing for the current mode. */
export function reportConfig(): void {
  const miss: string[] = [];
  if (!ENV.keys.openai && !ENV.keys.google && !ENV.keys.perplexity) miss.push("all engine API keys");
  if (!hasSupabase()) miss.push("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (persistence disabled)");
  if (ENV.isProd && !ENV.databaseUrl) miss.push("DATABASE_URL (migrations)");
  if (miss.length) console.warn(`[config] missing: ${miss.join("; ")}`);
}
