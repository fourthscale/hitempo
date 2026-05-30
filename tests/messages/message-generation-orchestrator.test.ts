import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the module-level db query collaborators so the orchestrator can be
// driven entirely in-memory. The orchestrator's collaborators are :
//   - the 5 query helpers (mocked here)
//   - the LlmGenerationService (constructor-injected, mocked per test)
// ---------------------------------------------------------------------------

vi.mock("@/db/queries/brand", () => ({
  getBrandBrief: vi.fn(),
}));
vi.mock("@/db/queries/companies", () => ({
  getCompanyById: vi.fn(),
}));
vi.mock("@/db/queries/contacts", () => ({
  getContactById: vi.fn(),
}));
vi.mock("@/db/queries/interactions", () => ({
  getRecentInteractionsForPrompt: vi.fn(),
}));
vi.mock("@/db/queries/messages", () => ({
  getRecentMessagesByContact: vi.fn(),
}));

import { getBrandBrief } from "@/db/queries/brand";
import { getCompanyById } from "@/db/queries/companies";
import { getContactById } from "@/db/queries/contacts";
import { getRecentInteractionsForPrompt } from "@/db/queries/interactions";
import { getRecentMessagesByContact } from "@/db/queries/messages";

import { MessageGenerationOrchestrator } from "@/lib/messages/message-generation-orchestrator";
import type { LlmGenerationService } from "@/lib/ai/llm-generation-service";
import {
  CompanyNotFoundError,
  ContactNotFoundError,
} from "@/lib/messages/message-errors";
import { BrandBriefMissingError } from "@/lib/ai/errors";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const CONTACT_ID = "00000000-0000-0000-0000-000000000003";
const COMPANY_ID = "00000000-0000-0000-0000-000000000004";

function baseInput() {
  return {
    organizationId: ORG_ID,
    userId: USER_ID,
    contactId: CONTACT_ID,
    companyId: COMPANY_ID,
    taskId: null,
    channel: "email" as const,
    intent: "first_contact" as const,
    locale: "fr" as const,
    includeSignal: true,
    orientation: null,
    sender: { firstName: "Sophie", lastName: "Martin" },
  };
}

const fakeContact = {
  id: CONTACT_ID,
  firstName: "Camille",
  lastName: "Durand",
  jobTitle: "Office Manager",
  preferredLanguage: "fr",
  relevance: "primary",
};

const fakeCompany = {
  id: COMPANY_ID,
  name: "Acme Hotels",
  industry: "hospitality",
  standing: "premium",
  score: 72,
  signalType: null,
  signalDetectedAt: null,
};

const fakeBrief = {
  fr: {
    positioning: "Plantes premium pour hôtels parisiens",
    toneOfVoice: ["chaleureux", "expert"],
    forbiddenWords: ["pas cher", "discount"],
    signatureExpressions: ["végétal vivant"],
    valueProps: ["Entretien hebdomadaire inclus", "Plantes garanties 1 an"],
    proofPoints: ["Le Bristol", "Plaza Athénée"],
  },
};

function makeLlmServiceMock(): LlmGenerationService {
  return {
    generate: vi.fn().mockResolvedValue({
      result: {
        content: "Objet: Bonjour Camille\n\nCamille, ravie d'échanger.",
        provider: "openai",
        model: "gpt-5-mini",
        tokensIn: 300,
        tokensOut: 80,
        costCents: 2,
      },
      usage: { id: "usage-uuid" },
    }),
  } as unknown as LlmGenerationService;
}

beforeEach(() => {
  vi.mocked(getContactById).mockResolvedValue(fakeContact as never);
  vi.mocked(getCompanyById).mockResolvedValue(fakeCompany as never);
  vi.mocked(getBrandBrief).mockResolvedValue(fakeBrief as never);
  vi.mocked(getRecentInteractionsForPrompt).mockResolvedValue([] as never);
  vi.mocked(getRecentMessagesByContact).mockResolvedValue([] as never);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MessageGenerationOrchestrator — happy path", () => {
  it("calls llmService.generate once and returns the parsed result with the llm_usage id", async () => {
    // The orchestrator no longer persists the messages row : that's done at
    // commit time (Send via Gmail or Log interaction). The orchestrator's
    // contract is purely to generate + return the raw + parsed content +
    // back-reference to the llm_usage row already created by the Facade.
    const llm = makeLlmServiceMock();
    const orch = new MessageGenerationOrchestrator(llm);

    const res = await orch.generate(baseInput());

    expect(llm.generate).toHaveBeenCalledTimes(1);
    expect(res.channel).toBe("email");
    expect(res.subject).toBe("Bonjour Camille");
    expect(res.body).toContain("Camille, ravie d'échanger.");
    expect(res.llmUsageId).toBe("usage-uuid");
    expect(res.tokensIn).toBe(300);
    expect(res.tokensOut).toBe(80);
    expect(res.content).toContain("Objet:");
  });

  it("forwards orientation into the prompt builder", async () => {
    const llm = makeLlmServiceMock();
    const orch = new MessageGenerationOrchestrator(llm);

    await orch.generate({
      ...baseInput(),
      orientation: "ton plus chaleureux",
    });

    // Orientation flows through buildOutboundMessagePrompt → user prompt.
    const call = vi.mocked(llm.generate).mock.calls[0]![0];
    const prompts = call.input.systemPrompt + "\n" + call.input.userPrompt;
    expect(prompts).toContain("ton plus chaleureux");
  });

  it("passes the correct LLM context (org, user, type=outbound_message)", async () => {
    const llm = makeLlmServiceMock();
    const orch = new MessageGenerationOrchestrator(llm);

    await orch.generate(baseInput());

    expect(llm.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          organizationId: ORG_ID,
          userId: USER_ID,
          type: "outbound_message",
        },
      }),
    );
  });
});

describe("MessageGenerationOrchestrator — error paths", () => {
  it("throws ContactNotFoundError when the contact does not resolve", async () => {
    vi.mocked(getContactById).mockResolvedValueOnce(null as never);
    const orch = new MessageGenerationOrchestrator(makeLlmServiceMock());

    await expect(orch.generate(baseInput())).rejects.toBeInstanceOf(
      ContactNotFoundError,
    );
  });

  it("throws CompanyNotFoundError when the company does not resolve", async () => {
    vi.mocked(getCompanyById).mockResolvedValueOnce(null as never);
    const orch = new MessageGenerationOrchestrator(makeLlmServiceMock());

    await expect(orch.generate(baseInput())).rejects.toBeInstanceOf(
      CompanyNotFoundError,
    );
  });

  it("propagates BrandBriefMissingError when the locale brief is absent", async () => {
    vi.mocked(getBrandBrief).mockResolvedValueOnce({ fr: {} } as never);
    const orch = new MessageGenerationOrchestrator(makeLlmServiceMock());

    await expect(orch.generate(baseInput())).rejects.toBeInstanceOf(
      BrandBriefMissingError,
    );
  });

  // Note : persistence-related failures (insertMessage / linkUsageToEntity)
  // are not tested here — the orchestrator no longer persists. The messages
  // row + llm_usage back-reference are written at commit time (Send Gmail or
  // Log interaction) by the action layer, which has its own coverage.
});

describe("MessageGenerationOrchestrator — signal block", () => {
  it("includes the signal block when includeSignal=true and the company has one", async () => {
    vi.mocked(getCompanyById).mockResolvedValueOnce({
      ...fakeCompany,
      signalType: "expansion",
      signalDetectedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    } as never);

    const llm = makeLlmServiceMock();
    const orch = new MessageGenerationOrchestrator(llm);

    await orch.generate(baseInput());

    // Prompt content is composed via the pure builder ; we just assert the
    // signal made it into the user prompt sent to the LLM.
    const call = vi.mocked(llm.generate).mock.calls[0]![0];
    const prompts = call.input.systemPrompt + "\n" + call.input.userPrompt;
    expect(prompts.toLowerCase()).toContain("expansion");
  });

  it("omits the signal block when includeSignal=false", async () => {
    vi.mocked(getCompanyById).mockResolvedValueOnce({
      ...fakeCompany,
      signalType: "expansion",
      signalDetectedAt: new Date(),
    } as never);

    const llm = makeLlmServiceMock();
    const orch = new MessageGenerationOrchestrator(llm);

    await orch.generate({ ...baseInput(), includeSignal: false });

    const call = vi.mocked(llm.generate).mock.calls[0]![0];
    const prompts = call.input.systemPrompt + "\n" + call.input.userPrompt;
    expect(prompts.toLowerCase()).not.toContain("expansion");
  });
});
