import { inngest } from "@/lib/inngest/client";
import { MailReplyPollerFactory } from "@/lib/mail/mail-reply-poller-factory";

/**
 * Inngest cron functions that scan connected mailboxes (Gmail or
 * Outlook, routed per user by the unified MailReplyPoller) for replies
 * to messages we sent. All seven cron definitions share the same
 * handler `handleTick` — only the schedule differs.
 *
 * Cadence per Ludovic (2026-05-28) :
 *   - 9h-12h     → every 10 min   (peak morning)
 *   - 12h-14h    → every 20 min   (lunch dip)
 *   - 14h-19h    → every 10 min   (peak afternoon)
 *   - 19h-22h    → every 20 min   (light evening)
 *   - 22h-6h     → every 1 h      (overnight)
 *   - 6h-9h      → every 20 min   (early morning)
 *   - weekends   → every 1 h, 24h/24
 *
 * Steps per tick = 1 ("list users") + N (one per connected user). With
 * 3 users this is ~4 step executions per tick, well within the Inngest
 * free tier (50k/month). See docs/features/10-gmail-integration.md for
 * the conso math.
 *
 * Local dev : start `npx inngest-cli@latest dev` alongside `npm run dev`
 * and visit http://localhost:8288 to inspect runs / trigger manually.
 */

const HANDLER_ID = "gmail/poll-replies";

async function handleTick({ step }: { step: import("inngest").GetStepTools<typeof inngest> }) {
  const userIds = await step.run("list-connected-users", async () => {
    return MailReplyPollerFactory.getInstance().listConnectedUserIds();
  });

  // Fan out : one step per user. If one fails, the others still run and
  // Inngest retries the failed step independently with exponential
  // backoff. Each user step routes internally to either
  // GmailService.fetchThread or OutlookService.fetchThread depending
  // on the user's stored provider — handled by MailReplyPoller via the
  // MailServiceFactory.
  await Promise.all(
    userIds.map((userId) =>
      step.run(`poll-${userId}`, async () => {
        return MailReplyPollerFactory.getInstance().pollUser(userId);
      }),
    ),
  );
}

// Weekday slots (Mon-Fri, TZ=Europe/Paris).
const weekdayPeakMorning = inngest.createFunction(
  {
    id: `${HANDLER_ID}-weekday-peak-am`,
    name: "Gmail replies — weekday peak AM",
    triggers: [{ cron: "TZ=Europe/Paris */10 9-11 * * 1-5" }],
  },
  handleTick,
);

const weekdayLunch = inngest.createFunction(
  {
    id: `${HANDLER_ID}-weekday-lunch`,
    name: "Gmail replies — weekday lunch",
    triggers: [{ cron: "TZ=Europe/Paris */20 12-13 * * 1-5" }],
  },
  handleTick,
);

const weekdayPeakAfternoon = inngest.createFunction(
  {
    id: `${HANDLER_ID}-weekday-peak-pm`,
    name: "Gmail replies — weekday peak PM",
    triggers: [{ cron: "TZ=Europe/Paris */10 14-18 * * 1-5" }],
  },
  handleTick,
);

const weekdayEvening = inngest.createFunction(
  {
    id: `${HANDLER_ID}-weekday-evening`,
    name: "Gmail replies — weekday evening",
    triggers: [{ cron: "TZ=Europe/Paris */20 19-21 * * 1-5" }],
  },
  handleTick,
);

const weekdayOvernight = inngest.createFunction(
  {
    id: `${HANDLER_ID}-weekday-overnight`,
    name: "Gmail replies — weekday overnight",
    triggers: [{ cron: "TZ=Europe/Paris 0 22-23,0-5 * * 1-5" }],
  },
  handleTick,
);

const weekdayEarlyMorning = inngest.createFunction(
  {
    id: `${HANDLER_ID}-weekday-early-am`,
    name: "Gmail replies — weekday early AM",
    triggers: [{ cron: "TZ=Europe/Paris */20 6-8 * * 1-5" }],
  },
  handleTick,
);

// Weekend slot : one tick per hour, 24/24, Sat-Sun.
const weekendHourly = inngest.createFunction(
  {
    id: `${HANDLER_ID}-weekend`,
    name: "Gmail replies — weekend hourly",
    triggers: [{ cron: "TZ=Europe/Paris 0 * * * 0,6" }],
  },
  handleTick,
);

export const pollGmailRepliesFunctions = [
  weekdayPeakMorning,
  weekdayLunch,
  weekdayPeakAfternoon,
  weekdayEvening,
  weekdayOvernight,
  weekdayEarlyMorning,
  weekendHourly,
];
