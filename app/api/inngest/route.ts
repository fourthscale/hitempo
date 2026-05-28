import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { pollGmailRepliesFunctions } from "@/inngest/functions/poll-gmail-replies";

/**
 * The webhook Inngest's runtime calls to discover, invoke, and replay our
 * functions. Each cron function we expose to Inngest must be in the
 * `functions` array below.
 *
 * In production : Inngest cloud authenticates calls with the
 * INNGEST_SIGNING_KEY env var.
 * In dev : the local `inngest dev` server (`npx inngest-cli@latest dev`)
 * hits this route without a signature.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ...pollGmailRepliesFunctions,
  ],
  // signingKey is auto-discovered from the INNGEST_SIGNING_KEY env var.
});
