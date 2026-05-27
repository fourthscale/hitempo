import { describe, it, expect } from "vitest";
import { getSenderName } from "@/lib/auth/sender-name";

describe("getSenderName", () => {
  it("prefers user_metadata.firstName + lastName when set", () => {
    const out = getSenderName({
      email: "x@y.com",
      user_metadata: { firstName: "Sophie", lastName: "Durand" },
    });
    expect(out).toEqual({ firstName: "Sophie", lastName: "Durand" });
  });

  it("trims whitespace from metadata values", () => {
    const out = getSenderName({
      email: "x@y.com",
      user_metadata: { firstName: "  Sophie  ", lastName: "  Durand " },
    });
    expect(out).toEqual({ firstName: "Sophie", lastName: "Durand" });
  });

  it("works with only firstName in metadata", () => {
    const out = getSenderName({
      email: "x@y.com",
      user_metadata: { firstName: "Sophie" },
    });
    expect(out).toEqual({ firstName: "Sophie", lastName: "" });
  });

  it("falls back to user_metadata.full_name split on first space", () => {
    const out = getSenderName({
      email: "x@y.com",
      user_metadata: { full_name: "Sophie Durand" },
    });
    expect(out).toEqual({ firstName: "Sophie", lastName: "Durand" });
  });

  it("full_name with multi-word last name keeps everything after first space", () => {
    const out = getSenderName({
      email: "x@y.com",
      user_metadata: { full_name: "Marie-Claire de la Roche" },
    });
    expect(out).toEqual({ firstName: "Marie-Claire", lastName: "de la Roche" });
  });

  it("full_name with single token gives only firstName", () => {
    const out = getSenderName({
      email: "x@y.com",
      user_metadata: { full_name: "Cher" },
    });
    expect(out).toEqual({ firstName: "Cher", lastName: "" });
  });

  it("falls back to email local-part capitalized when no metadata", () => {
    const out = getSenderName({ email: "raymond.ludovic@gmail.com" });
    expect(out).toEqual({ firstName: "Raymond.ludovic", lastName: "" });
  });

  it("returns 'User' fallback when neither metadata nor email are present", () => {
    const out = getSenderName({});
    expect(out).toEqual({ firstName: "User", lastName: "" });
  });

  it("ignores non-string metadata fields", () => {
    const out = getSenderName({
      email: "raymond@gmail.com",
      user_metadata: { firstName: 42, lastName: null, full_name: ["arr"] },
    } as never);
    expect(out).toEqual({ firstName: "Raymond", lastName: "" });
  });
});
