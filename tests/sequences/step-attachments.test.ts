import { describe, expect, it } from "vitest";
import {
  MAX_STEP_ATTACHMENTS,
  MAX_STEP_ATTACHMENT_BYTES,
  diffRemovedAttachmentPaths,
  isAllowedStepAttachmentMime,
  validateNewStepAttachment,
} from "@/lib/sequences/step-attachments";
import type { SequenceStepAttachmentRef } from "@/lib/sequences/types";

function makeRef(path: string, sizeBytes = 1024): SequenceStepAttachmentRef {
  return {
    storagePath: path,
    filename: path.split("/").pop() ?? path,
    mimeType: "application/pdf",
    sizeBytes,
  };
}

describe("isAllowedStepAttachmentMime", () => {
  it("accepts PDF", () => expect(isAllowedStepAttachmentMime("application/pdf")).toBe(true));
  it("rejects exotic MIME", () =>
    expect(isAllowedStepAttachmentMime("application/x-shockwave-flash")).toBe(false));
  it("rejects empty", () => expect(isAllowedStepAttachmentMime("")).toBe(false));
});

describe("diffRemovedAttachmentPaths", () => {
  it("returns empty when oldList empty / null", () => {
    expect(diffRemovedAttachmentPaths([], [makeRef("a")])).toEqual([]);
    expect(diffRemovedAttachmentPaths(null, [makeRef("a")])).toEqual([]);
    expect(diffRemovedAttachmentPaths(undefined, [makeRef("a")])).toEqual([]);
  });

  it("returns paths in old but not in new", () => {
    const removed = diffRemovedAttachmentPaths(
      [makeRef("a"), makeRef("b"), makeRef("c")],
      [makeRef("b")],
    );
    expect(removed.sort()).toEqual(["a", "c"]);
  });

  it("returns empty when sets identical", () => {
    expect(
      diffRemovedAttachmentPaths([makeRef("a"), makeRef("b")], [makeRef("a"), makeRef("b")]),
    ).toEqual([]);
  });

  it("returns all old when new empty / null", () => {
    expect(diffRemovedAttachmentPaths([makeRef("a"), makeRef("b")], [])).toEqual(["a", "b"]);
    expect(diffRemovedAttachmentPaths([makeRef("a")], null)).toEqual(["a"]);
  });

  it("treats path order as irrelevant", () => {
    const r = diffRemovedAttachmentPaths(
      [makeRef("a"), makeRef("b")],
      [makeRef("b"), makeRef("a")],
    );
    expect(r).toEqual([]);
  });
});

describe("validateNewStepAttachment", () => {
  it("accepts a fresh PDF under all limits", () => {
    expect(
      validateNewStepAttachment({
        existing: [],
        incoming: { mimeType: "application/pdf", sizeBytes: 1024 * 1024 },
      }),
    ).toBeNull();
  });

  it("rejects when MAX_STEP_ATTACHMENTS reached", () => {
    const existing = Array.from({ length: MAX_STEP_ATTACHMENTS }, (_, i) =>
      makeRef(`f${i}`),
    );
    expect(
      validateNewStepAttachment({
        existing,
        incoming: { mimeType: "application/pdf", sizeBytes: 100 },
      }),
    ).toBe("step_attachment_too_many");
  });

  it("rejects oversized file", () => {
    expect(
      validateNewStepAttachment({
        existing: [],
        incoming: {
          mimeType: "application/pdf",
          sizeBytes: MAX_STEP_ATTACHMENT_BYTES + 1,
        },
      }),
    ).toBe("step_attachment_too_large");
  });

  it("rejects when total exceeds aggregate cap", () => {
    // Two refs at 9 MB each ; adding a 5 MB file → total > 20 MB.
    const existing = [
      makeRef("a", 9 * 1024 * 1024),
      makeRef("b", 9 * 1024 * 1024),
    ];
    expect(
      validateNewStepAttachment({
        existing,
        incoming: { mimeType: "application/pdf", sizeBytes: 5 * 1024 * 1024 },
      }),
    ).toBe("step_attachments_total_too_large");
  });

  it("rejects bad MIME", () => {
    expect(
      validateNewStepAttachment({
        existing: [],
        incoming: { mimeType: "application/x-evil", sizeBytes: 100 },
      }),
    ).toBe("step_attachment_bad_mime");
  });

  it("checks count BEFORE size (more useful error for the user)", () => {
    const existing = Array.from({ length: MAX_STEP_ATTACHMENTS }, (_, i) =>
      makeRef(`f${i}`),
    );
    // Oversize AND too many : we report "too many" so the user knows
    // shrinking won't help.
    expect(
      validateNewStepAttachment({
        existing,
        incoming: {
          mimeType: "application/pdf",
          sizeBytes: MAX_STEP_ATTACHMENT_BYTES + 1,
        },
      }),
    ).toBe("step_attachment_too_many");
  });
});
