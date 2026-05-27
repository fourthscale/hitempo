import { config } from "dotenv";

// Tests must run against the LOCAL Supabase stack.
config({ path: ".env.local" });
config({ path: ".env" });

if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("127.0.0.1")) {
  throw new Error(
    "Tests must target the local stack (127.0.0.1). " +
      "Refusing to run against a remote NEXT_PUBLIC_SUPABASE_URL.",
  );
}
