import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MailServiceFactory } from "@/lib/mail/mail-service-factory";
import { MailCredentialsNotFoundError } from "@/lib/mail/mail-errors";
import { MailCredentialsServiceFactory } from "@/lib/mail/mail-credentials-service-factory";
import { GmailServiceFactory } from "@/lib/gmail/gmail-service-factory";
import { OutlookServiceFactory } from "@/lib/outlook/outlook-service-factory";
import type { MailCredentialsService } from "@/lib/mail/mail-credentials-service";

function fakeCredsService(
  status:
    | { connected: true; provider: "gmail" | "outlook" }
    | { connected: false },
): MailCredentialsService {
  return {
    getConnectionStatus: vi.fn(async () => {
      if (!status.connected) {
        return {
          connected: false,
          provider: null,
          address: null,
          status: null,
          revokedAt: null,
          lastRefreshError: null,
        };
      }
      return {
        connected: true,
        provider: status.provider,
        address: `${status.provider}@hitempo.test`,
        status: "active" as const,
        revokedAt: null,
        lastRefreshError: null,
      };
    }),
  } as unknown as MailCredentialsService;
}

describe("MailServiceFactory.forUser", () => {
  beforeEach(() => {
    GmailServiceFactory.reset();
    OutlookServiceFactory.reset();
    MailCredentialsServiceFactory.reset();
  });

  afterEach(() => {
    GmailServiceFactory.reset();
    OutlookServiceFactory.reset();
    MailCredentialsServiceFactory.reset();
  });

  it("routes Gmail users to GmailService", async () => {
    MailCredentialsServiceFactory.setInstance(
      fakeCredsService({ connected: true, provider: "gmail" }),
    );

    const service = await MailServiceFactory.forUser("user-gmail");
    expect(service.providerName).toBe("gmail");
  });

  it("routes Outlook users to OutlookService", async () => {
    MailCredentialsServiceFactory.setInstance(
      fakeCredsService({ connected: true, provider: "outlook" }),
    );

    const service = await MailServiceFactory.forUser("user-outlook");
    expect(service.providerName).toBe("outlook");
  });

  it("throws MailCredentialsNotFoundError when the user has no connected mailbox", async () => {
    MailCredentialsServiceFactory.setInstance(
      fakeCredsService({ connected: false }),
    );

    await expect(
      MailServiceFactory.forUser("user-disconnected"),
    ).rejects.toBeInstanceOf(MailCredentialsNotFoundError);
  });
});

describe("MailServiceFactory.forProvider", () => {
  beforeEach(() => {
    GmailServiceFactory.reset();
    OutlookServiceFactory.reset();
  });

  it("returns GmailService for provider='gmail'", () => {
    expect(MailServiceFactory.forProvider("gmail").providerName).toBe("gmail");
  });

  it("returns OutlookService for provider='outlook'", () => {
    expect(MailServiceFactory.forProvider("outlook").providerName).toBe("outlook");
  });
});
