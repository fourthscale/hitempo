import { describe, it, expect } from "vitest";
import { NoopLlmUsageLogger, type LlmUsageEntry } from "@/lib/ai/llm-usage-logger";

describe("NoopLlmUsageLogger", () => {
  const sampleEntry: LlmUsageEntry = {
    organizationId: "org-1",
    userId: "user-1",
    type: "outbound_message",
    provider: "openai",
    model: "gpt-5-mini",
    tokensIn: 100,
    tokensOut: 50,
    costCents: 1,
    durationMs: 2400,
    status: "success",
  };

  it("records the call and returns a record with id + createdAt", async () => {
    const logger = new NoopLlmUsageLogger();
    const record = await logger.log(sampleEntry);

    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.createdAt).toBeInstanceOf(Date);
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toEqual(sampleEntry);
  });

  it("accumulates multiple entries in order", async () => {
    const logger = new NoopLlmUsageLogger();
    await logger.log({ ...sampleEntry, tokensIn: 1 });
    await logger.log({ ...sampleEntry, tokensIn: 2 });
    await logger.log({ ...sampleEntry, tokensIn: 3 });

    expect(logger.entries.map((e) => e.tokensIn)).toEqual([1, 2, 3]);
  });

  it("returns distinct ids across calls", async () => {
    const logger = new NoopLlmUsageLogger();
    const a = await logger.log(sampleEntry);
    const b = await logger.log(sampleEntry);
    expect(a.id).not.toBe(b.id);
  });

  it("records backref patches separately from log entries", async () => {
    const logger = new NoopLlmUsageLogger();
    await logger.log(sampleEntry);
    await logger.patchRelatedEntity("usage-id-1", "message", "msg-1");
    await logger.patchRelatedEntity("usage-id-2", "company", "co-1");

    expect(logger.patches).toEqual([
      { usageId: "usage-id-1", type: "message", id: "msg-1" },
      { usageId: "usage-id-2", type: "company", id: "co-1" },
    ]);
  });
});
