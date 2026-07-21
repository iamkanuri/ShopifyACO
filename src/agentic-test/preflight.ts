import { TEST_SHOP_ALLOWLIST } from "./contract.js";

// Hard rails (spec Rule 10 / 4.12): the experiment refuses to do ANYTHING unless
// the feature flag is explicitly enabled AND the target shop is allowlisted.
// Pure + env-injectable so both are unit-testable (spec tests 13 & 14).

export const FLAG_NAME = "AGENTIC_INSTRUMENT_TEST_ENABLED";

export function flagEnabled(env: Record<string, string | undefined>): boolean {
  return env[FLAG_NAME] === "true"; // exact value required; default DISABLED
}

/** Throws unless the flag is enabled and the shop is in the hard-coded allowlist. */
export function assertRunnable(
  env: Record<string, string | undefined>,
  shopId: string,
): void {
  if (!flagEnabled(env)) {
    throw new Error(
      `refusing to run: ${FLAG_NAME} is not 'true' (feature flag defaults to disabled)`,
    );
  }
  if (!TEST_SHOP_ALLOWLIST.includes(shopId)) {
    throw new Error(
      `refusing to run: shop '${shopId}' is not in the hard-coded test-shop allowlist [${TEST_SHOP_ALLOWLIST.join(", ")}]`,
    );
  }
}

/** The seed step writes to the DB — additionally refuse any non-local database,
 *  so the experiment can never touch the production Supabase instance. */
export function assertLocalDatabase(databaseUrl: string | undefined): void {
  if (!databaseUrl) throw new Error("refusing to seed: DATABASE_URL is unset");
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("refusing to seed: DATABASE_URL is not a parseable URL");
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `refusing to seed: DATABASE_URL host '${host}' is not local (127.0.0.1/localhost) — Stage 1 must never touch a remote database`,
    );
  }
}
