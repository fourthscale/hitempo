import { describe, expect, it } from "vitest";
import {
  SEQUENCE_MESSAGE_CONTEXT_SCOPES,
  coerceMessageContextScope,
  isSequenceMessageContextScope,
  resolveMessageContextScope,
  resolveMessageContextScopeWithUserOverride,
} from "@/lib/sequences/message-context-scope";

describe("SEQUENCE_MESSAGE_CONTEXT_SCOPES", () => {
  it("exposes the two valid scopes in stable order", () => {
    expect(SEQUENCE_MESSAGE_CONTEXT_SCOPES).toEqual(["sequence", "all"]);
  });

  it("isSequenceMessageContextScope guards valid values only", () => {
    expect(isSequenceMessageContextScope("sequence")).toBe(true);
    expect(isSequenceMessageContextScope("all")).toBe(true);
    expect(isSequenceMessageContextScope("none")).toBe(false);
    expect(isSequenceMessageContextScope(null)).toBe(false);
    expect(isSequenceMessageContextScope(undefined)).toBe(false);
  });
});

describe("resolveMessageContextScope", () => {
  it("step override wins", () => {
    expect(resolveMessageContextScope({ sequence: "all", step: "sequence" })).toBe("sequence");
  });

  it("falls back to sequence when step is null", () => {
    expect(resolveMessageContextScope({ sequence: "all", step: null })).toBe("all");
  });

  it("hard defaults to 'sequence' when both missing", () => {
    expect(resolveMessageContextScope({ sequence: null, step: null })).toBe("sequence");
    expect(resolveMessageContextScope({ sequence: undefined, step: undefined })).toBe("sequence");
  });

  it("invalid values defensively fall through to default", () => {
    expect(resolveMessageContextScope({ sequence: "garbage", step: "??" })).toBe("sequence");
    expect(resolveMessageContextScope({ sequence: "all", step: "??" })).toBe("all");
  });
});

describe("resolveMessageContextScopeWithUserOverride", () => {
  it("user override wins over step + sequence", () => {
    expect(
      resolveMessageContextScopeWithUserOverride({
        sequence: "sequence",
        step: "sequence",
        user: "all",
      }),
    ).toBe("all");
  });

  it("falls back to step + sequence when user empty", () => {
    expect(
      resolveMessageContextScopeWithUserOverride({
        sequence: "all",
        step: null,
        user: null,
      }),
    ).toBe("all");
  });

  it("invalid user override is ignored", () => {
    expect(
      resolveMessageContextScopeWithUserOverride({
        sequence: "all",
        step: null,
        user: "garbage",
      }),
    ).toBe("all");
  });
});

describe("coerceMessageContextScope", () => {
  it("returns valid input as-is", () => {
    expect(coerceMessageContextScope("sequence")).toBe("sequence");
    expect(coerceMessageContextScope("all")).toBe("all");
  });

  it("returns 'sequence' for anything else", () => {
    expect(coerceMessageContextScope(null)).toBe("sequence");
    expect(coerceMessageContextScope("garbage")).toBe("sequence");
  });
});
