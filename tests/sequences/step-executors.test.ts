import { describe, it, expect, vi } from "vitest";
import type {
  StepExecutionContext,
  SequenceExecutorServices,
} from "@/lib/sequences/step-executor";
import type {
  SequenceStepActionConfig,
  SequenceContactCtx,
  SequenceCompanyCtx,
  SequenceOrgCtx,
  SequenceEnrolmentCtx,
  SequenceStepCtx,
  SequenceStepActionType,
  SequencePredicate,
} from "@/lib/sequences/types";
import { SequenceStepExecutorFactory } from "@/lib/sequences/step-executor-factory";
import { UnknownActionTypeError } from "@/lib/sequences/sequence-errors";

const contact: SequenceContactCtx = {
  id: "c1",
  kind: "person",
  firstName: "Marie",
  lastName: "Durand",
  jobTitle: "Directrice",
  preferredLanguage: "en",
  optedOut: false,
};
const company: SequenceCompanyCtx = {
  id: "co1",
  name: "Hotel X",
  primaryLocale: "fr",
  relationshipType: "prospect",
  signalType: null,
  signalDetectedAt: null,
};
const organization: SequenceOrgCtx = { id: "o1", defaultLocale: "fr" };
const enrolment: SequenceEnrolmentCtx = {
  id: "e1",
  organizationId: "o1",
  sequenceId: "s1",
  companyId: "co1",
  contactId: "c1",
  assigneeId: "u1",
  currentStepId: "st1",
  currentStepOrder: 0,
  lastExecutionCounter: 0,
  maxExecutionCount: 200,
};

function mockServices(over: Partial<SequenceExecutorServices> = {}): SequenceExecutorServices {
  return {
    createTask: vi.fn().mockResolvedValue({ taskId: "task-1", scheduledFor: null }),
    generateDraftForTask: vi.fn().mockResolvedValue({ drafted: true }),
    cascadeEnrol: vi.fn().mockResolvedValue({ enrolmentId: "enrol-2" }),
    updateContact: vi.fn().mockResolvedValue(undefined),
    getSenderName: vi.fn().mockResolvedValue(null),
    scheduleAgentAutoExecute: vi.fn().mockResolvedValue(undefined),
    resolveThreadContext: vi.fn().mockResolvedValue(null),
    ...over,
  };
}

function ctxFor(
  actionType: SequenceStepActionType,
  actionConfig: SequenceStepActionConfig,
  services: SequenceExecutorServices,
  predicateResult = false,
): StepExecutionContext {
  const step: SequenceStepCtx = {
    id: "st1",
    stepOrder: 0,
    actionType,
    actionConfig,
    nextStepIds: { default: "st2" },
    condition: null,
    filter: null,
  };
  return {
    enrolment,
    step,
    contact,
    company,
    organization,
    userId: "u1",
    services,
    evaluatePredicate: (_p: SequencePredicate) => predicateResult,
    now: new Date("2026-03-01T00:00:00Z"),
  };
}

const run = (
  type: SequenceStepActionType,
  config: SequenceStepActionConfig,
  services: SequenceExecutorServices,
  predicateResult = false,
) => SequenceStepExecutorFactory.forActionType(type).execute(ctxFor(type, config, services, predicateResult));

describe("SequenceStepExecutorFactory", () => {
  it("registers the active action types", () => {
    expect(SequenceStepExecutorFactory.knownActionTypes().sort()).toEqual(
      [
        "send_email",
        "send_linkedin",
        "phone_call",
        "update_contact",
        "wait_delay",
        "conditional_split",
        "conditional_switch",
        "enroll_in_sequence",
        "merge",
      ].sort(),
    );
  });

  it("throws on unknown action type", () => {
    expect(() => SequenceStepExecutorFactory.forActionType("ghost" as SequenceStepActionType)).toThrow(
      UnknownActionTypeError,
    );
  });
});

describe("SendMessageStepExecutor", () => {
  it("send_email defined mode creates a task with the resolved body", async () => {
    const services = mockServices();
    const result = await run(
      "send_email",
      {
        mode: "defined",
        channel: "email",
        intent: "first_contact",
        titleTemplate: { fr: "Envoyer", en: "Send email" },
        subject: { fr: "Objet", en: "Subject" },
        body: { fr: "Bonjour", en: "Hello there" },
      },
      services,
    );
    expect(services.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ type: "email", title: "Send email" }),
    );
    const arg = (services.createTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.description).toContain("Hello there");
    expect(services.generateDraftForTask).not.toHaveBeenCalled();
    expect(result).toEqual({ taskId: "task-1", navigateTo: "default", awaitTaskCompletion: true });
  });

  it("send_email ai mode requests a draft", async () => {
    const services = mockServices();
    await run(
      "send_email",
      {
        mode: "ai",
        channel: "email",
        intent: "follow_up",
        titleTemplate: { fr: "Rédiger", en: "Draft" },
        orientation: { fr: "Ton", en: "Warm tone" },
        includeSignal: true,
      },
      services,
    );
    expect(services.generateDraftForTask).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "email", intent: "follow_up", includeSignal: true, locale: "en" }),
    );
  });

  it("send_linkedin maps to a linkedin task", async () => {
    const services = mockServices();
    await run(
      "send_linkedin",
      { mode: "defined", channel: "linkedin", intent: "first_contact", titleTemplate: { fr: "Li", en: "Li" } },
      services,
    );
    expect(services.createTask).toHaveBeenCalledWith(expect.objectContaining({ type: "linkedin" }));
  });
});

describe("PhoneCallStepExecutor", () => {
  it("creates a phone task", async () => {
    const services = mockServices();
    const result = await run(
      "phone_call",
      { titleTemplate: { fr: "Appeler", en: "Call" } },
      services,
    );
    expect(services.createTask).toHaveBeenCalledWith(expect.objectContaining({ type: "phone", title: "Call" }));
    expect(result.navigateTo).toBe("default");
  });
});

describe("UpdateContactStepExecutor", () => {
  it("applies the patch and advances", async () => {
    const services = mockServices();
    const result = await run("update_contact", { setStatus: "qualified", setRole: "decision_maker" }, services);
    expect(services.updateContact).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { status: "qualified", role: "decision_maker" } }),
    );
    expect(result.navigateTo).toBe("default");
  });
});

describe("WaitDelayStepExecutor", () => {
  it("computes delayMs", async () => {
    const result = await run("wait_delay", { durationValue: 2, durationUnit: "hours" }, mockServices());
    expect(result).toEqual({ navigateTo: "default", delayMs: 2 * 3_600_000 });
  });
});

describe("ConditionalSplitStepExecutor", () => {
  it("routes yes when predicate matches", async () => {
    const result = await run("conditional_split", { predicate: { type: "if_no_inbound" } }, mockServices(), true);
    expect(result.navigateTo).toBe("yes");
  });
  it("routes no when predicate fails", async () => {
    const result = await run("conditional_split", { predicate: { type: "if_no_inbound" } }, mockServices(), false);
    expect(result.navigateTo).toBe("no");
  });
});

describe("ConditionalSwitchStepExecutor", () => {
  const group = { kind: "group" as const, op: "and" as const, conditions: [] };
  it("routes to the first matching branch", async () => {
    const result = await run(
      "conditional_switch",
      { branches: [{ condition: group }, { condition: group }] },
      mockServices(),
      true, // every branch predicate matches → first wins
    );
    expect(result.navigateTo).toBe("0");
  });
  it("falls back to default when no branch matches", async () => {
    const result = await run(
      "conditional_switch",
      { branches: [{ condition: group }] },
      mockServices(),
      false,
    );
    expect(result.navigateTo).toBe("default");
  });
});

describe("EnrollInSequenceStepExecutor", () => {
  it("cascades and ends as 'cascaded'", async () => {
    const services = mockServices();
    const result = await run("enroll_in_sequence", { targetSequenceId: "s2", startAtStep: 0 }, services);
    expect(services.cascadeEnrol).toHaveBeenCalledWith(expect.objectContaining({ targetSequenceId: "s2" }));
    expect(result.markEnded).toBe("cascaded");
  });
});
