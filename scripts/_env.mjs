import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { MONGODB_URI, MONGODB_DB } = process.env;

if (!MONGODB_URI) {
  console.error("[env] MONGODB_URI is not set. Aborting.");
  process.exit(1);
}
if (!MONGODB_DB) {
  console.error(
    "[env] MONGODB_DB is not set. Aborting (refusing to silently default to a different database).",
  );
  process.exit(1);
}

export { MONGODB_URI, MONGODB_DB };

// Mask user:pass in mongodb URIs so connection errors don't leak credentials.
export function scrub(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/(mongodb(?:\+srv)?:\/\/)[^@/]+@/gi, "$1<credentials-redacted>@");
}
