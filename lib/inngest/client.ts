import "server-only";

import { Inngest } from "inngest";

/**
 * Singleton Inngest client.
 *
 * Reads `INNGEST_EVENT_KEY` from env in production (signed dispatch to the
 * Inngest cloud). In dev the SDK ignores the missing key and routes
 * everything to the locally-running `inngest dev` server.
 *
 * All event names live under the `app/...` namespace so we can later
 * partition functions cleanly by feature.
 */
export const inngest = new Inngest({
  id: "hitempo",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
