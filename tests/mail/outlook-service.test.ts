import { describe, expect, it, vi, beforeEach } from "vitest";
import { OutlookService } from "@/lib/outlook/outlook-service";
import { MailApiError, MailCredentialRevokedError, MailOAuthError } from "@/lib/mail/mail-errors";
import type { MailCredentialsService, DecryptedMailCredentials } from "@/lib/mail/mail-credentials-service";

const SITE_URL = "https://hitempo.test";

function buildCreds(overrides: Partial<DecryptedMailCredentials> = {}): DecryptedMailCredentials {
  // Default to a non-expired access token so send() doesn't trigger
  // the refresh path. Tests that exercise refresh override expiresAt.
  return {
    userId: "user-1",
    organizationId: "org-1",
    provider: "outlook",
    emailAddress: "ludo@hitempo.test",
    accessToken: "live-access-token",
    refreshToken: "live-refresh-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    scopes: ["Mail.Send", "offline_access"],
    connectedAt: new Date(),
    lastUsedAt: null,
    ...overrides,
  };
}

function buildCredsService(creds: DecryptedMailCredentials | null): MailCredentialsService {
  return {
    requireForUser: vi.fn(async () => {
      if (!creds) throw new Error("not found");
      return creds;
    }),
    markUsed: vi.fn(async () => {}),
    updateAccessToken: vi.fn(async () => {}),
    markRevoked: vi.fn(async () => {}),
  } as unknown as MailCredentialsService;
}

describe("OutlookService.send", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("performs the 2-step draft+send dance and returns the canonical Message-ID", async () => {
    const creds = buildCreds();
    const credsService = buildCredsService(creds);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/me/messages")) {
        return new Response(
          JSON.stringify({
            id: "msg-internal-1",
            conversationId: "conv-abc",
            internetMessageId: "<canonical@outlook.com>",
          }),
          { status: 201 },
        );
      }
      if (u.endsWith("/me/messages/msg-internal-1/send")) {
        return new Response(null, { status: 202 });
      }
      throw new Error(`Unexpected URL: ${u}`);
    });

    const service = new OutlookService(credsService, SITE_URL);
    const result = await service.send({
      userId: "user-1",
      to: "prospect@acme.test",
      subject: "Hello",
      body: "Bonjour Anne, ...",
    });

    expect(result).toEqual({
      threadId: "conv-abc",
      messageId: "<canonical@outlook.com>",
      fromAddress: "ludo@hitempo.test",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // First call : draft creation with the right payload shape.
    const draftCall = fetchMock.mock.calls[0]!;
    expect(draftCall[0]).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(draftCall[1]?.method).toBe("POST");
    const draftBody = JSON.parse(String(draftCall[1]?.body ?? "{}"));
    expect(draftBody.subject).toBe("Hello");
    expect(draftBody.body).toEqual({ contentType: "Text", content: "Bonjour Anne, ..." });
    expect(draftBody.toRecipients).toEqual([
      { emailAddress: { address: "prospect@acme.test" } },
    ]);
    // markUsed fired (fire-and-forget).
    expect(credsService.markUsed).toHaveBeenCalledWith("user-1");
  });

  it("encodes attachments as #microsoft.graph.fileAttachment base64", async () => {
    const creds = buildCreds();
    const credsService = buildCredsService(creds);
    let observedAttachments: unknown = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/me/messages")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        observedAttachments = body.attachments;
        return new Response(
          JSON.stringify({
            id: "msg-2",
            conversationId: "conv-2",
            internetMessageId: "<canonical-2@outlook.com>",
          }),
          { status: 201 },
        );
      }
      return new Response(null, { status: 202 });
    });

    const service = new OutlookService(credsService, SITE_URL);
    await service.send({
      userId: "user-1",
      to: "prospect@acme.test",
      subject: "With PDF",
      body: "See attached",
      attachments: [
        {
          filename: "Catalogue.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("hello-pdf"),
        },
      ],
    });

    expect(observedAttachments).toEqual([
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "Catalogue.pdf",
        contentType: "application/pdf",
        // base64 of "hello-pdf"
        contentBytes: Buffer.from("hello-pdf").toString("base64"),
      },
    ]);
  });

  it("throws MailApiError when Graph returns non-2xx on draft create", async () => {
    const credsService = buildCredsService(buildCreds());
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("forbidden", { status: 403 }),
    );

    const service = new OutlookService(credsService, SITE_URL);
    await expect(
      service.send({ userId: "user-1", to: "x@y.test", subject: "s", body: "b" }),
    ).rejects.toBeInstanceOf(MailApiError);
  });

  it("marks the credential revoked and throws MailCredentialRevokedError when the refresh path hits invalid_grant", async () => {
    const expiredCreds = buildCreds({
      expiresAt: new Date(Date.now() - 60 * 1000), // expired → triggers refresh
    });
    const credsService = buildCredsService(expiredCreds);
    process.env.MS_GRAPH_CLIENT_ID = "test-client";
    process.env.MS_GRAPH_CLIENT_SECRET = "test-secret";

    // Intercept the refresh call → return 400 with invalid_grant body.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Refresh token revoked.",
        }),
        { status: 400 },
      ),
    );

    const service = new OutlookService(credsService, SITE_URL);
    await expect(
      service.send({ userId: "user-1", to: "x@y.test", subject: "s", body: "b" }),
    ).rejects.toBeInstanceOf(MailCredentialRevokedError);
    expect(credsService.markRevoked).toHaveBeenCalledWith(
      "user-1",
      expect.stringContaining("invalid_grant"),
    );
  });

  it("re-throws transient OAuth errors (5xx) as MailOAuthError without poisoning the credential", async () => {
    const expiredCreds = buildCreds({
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    const credsService = buildCredsService(expiredCreds);
    process.env.MS_GRAPH_CLIENT_ID = "test-client";
    process.env.MS_GRAPH_CLIENT_SECRET = "test-secret";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("upstream", { status: 503 }),
    );

    const service = new OutlookService(credsService, SITE_URL);
    await expect(
      service.send({ userId: "user-1", to: "x@y.test", subject: "s", body: "b" }),
    ).rejects.toBeInstanceOf(MailOAuthError);
    expect(credsService.markRevoked).not.toHaveBeenCalled();
  });
});

describe("OutlookService.fetchThread", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normalises Graph $filter response into MailThreadMessage[]", async () => {
    const credsService = buildCredsService(buildCreds());
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          value: [
            {
              id: "msg-a",
              internetMessageId: "<a@hitempo.test>",
              from: { emailAddress: { address: "ludo@hitempo.test", name: "Ludo" } },
              bodyPreview: "Bonjour, voici...",
              receivedDateTime: "2026-06-13T10:00:00Z",
            },
            {
              id: "msg-b",
              internetMessageId: "<b@acme.test>",
              from: { emailAddress: { address: "anne@acme.test", name: "Anne" } },
              bodyPreview: "Merci pour votre message",
              receivedDateTime: "2026-06-13T11:30:00Z",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const service = new OutlookService(credsService, SITE_URL);
    const result = await service.fetchThread("user-1", "conv-abc");
    expect(result).toEqual([
      {
        internalId: "msg-a",
        messageId: "<a@hitempo.test>",
        from: "ludo@hitempo.test",
        snippet: "Bonjour, voici...",
        receivedAtMs: new Date("2026-06-13T10:00:00Z").getTime(),
      },
      {
        internalId: "msg-b",
        messageId: "<b@acme.test>",
        from: "anne@acme.test",
        snippet: "Merci pour votre message",
        receivedAtMs: new Date("2026-06-13T11:30:00Z").getTime(),
      },
    ]);
  });

  it("escapes single quotes in the conversationId filter to prevent OData injection", async () => {
    const credsService = buildCredsService(buildCreds());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ value: [] }), { status: 200 }),
    );

    const service = new OutlookService(credsService, SITE_URL);
    await service.fetchThread("user-1", "conv'with'quotes");

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain(
      "conversationId+eq+%27conv%27%27with%27%27quotes%27",
    );
  });
});
