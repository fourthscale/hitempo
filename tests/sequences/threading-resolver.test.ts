import { describe, expect, it, vi } from "vitest";

import { ThreadingResolver } from "@/lib/sequences/engine/threading-resolver";

/**
 * Sprint 15 — unit tests for the ThreadingResolver Strategy.
 *
 * We stub the Drizzle DB at the surface the resolver actually uses :
 *   - `db.query.sequenceStepExecutions.findFirst({...})` for the
 *     last-/entry-email modes.
 *   - The fluent SELECT chain for `last_answered_step` (the answered
 *     thread lookup) AND for the References-chain builder (every prior
 *     execution with a gmail_message_id, ordered by execution_counter).
 *
 * The SELECT stub returns a sequence of result arrays — one per
 * `.select()` call — so a single test can simulate both the
 * answered-thread lookup and the subsequent chain build.
 */

type FindFirstResult = {
  mailThreadId: string | null;
  mailMessageId: string | null;
  subject: string | null;
  executionCounter: number;
} | null;

function makeDb(opts: {
  findFirst?: FindFirstResult | FindFirstResult[];
  /**
   * Sequence of result arrays — `.select()` is a counter into this list,
   * so the Nth call returns the Nth row set when awaited at the chain
   * terminator. Use this to drive both the answered-thread lookup AND
   * the References-chain builder in the same test.
   */
  selectResultSequence?: Array<unknown[]>;
}) {
  const findFirst = vi.fn();
  if (Array.isArray(opts.findFirst)) {
    let i = 0;
    findFirst.mockImplementation(() =>
      Promise.resolve(opts.findFirst![Math.min(i++, opts.findFirst!.length - 1)]),
    );
  } else {
    findFirst.mockResolvedValue(opts.findFirst ?? null);
  }

  const sequence = opts.selectResultSequence ?? [];
  let selectCallIndex = 0;

  function makeChain(rows: unknown[]) {
    const chain: {
      rows: unknown[];
      from: () => typeof chain;
      innerJoin: () => typeof chain;
      leftJoin: () => typeof chain;
      where: () => typeof chain;
      orderBy: () => typeof chain | Promise<unknown[]>;
      limit: () => Promise<unknown[]>;
      then: <T>(onFulfilled: (value: unknown[]) => T) => Promise<T>;
    } = {
      rows,
      from() { return chain; },
      innerJoin() { return chain; },
      leftJoin() { return chain; },
      where() { return chain; },
      orderBy() {
        // For chain-builder queries we await `.orderBy(...)` directly (no
        // `.limit()`). Drizzle's builder is itself thenable, so we expose a
        // `then` here that resolves to the rows.
        return chain;
      },
      async limit() { return chain.rows; },
      then<T>(onFulfilled: (value: unknown[]) => T) {
        return Promise.resolve(chain.rows).then(onFulfilled);
      },
    };
    return chain;
  }

  return {
    query: {
      sequenceStepExecutions: { findFirst },
    },
    select: () => {
      const rows = sequence[selectCallIndex] ?? [];
      selectCallIndex += 1;
      return makeChain(rows);
    },
    __findFirst: findFirst,
  };
}

const baseInput = {
  enrolmentId: "e1",
  organizationId: "o1",
  contactId: "c1",
};

describe("ThreadingResolver.resolve", () => {
  it("returns null immediately for new_thread (no DB call)", async () => {
    const db = makeDb({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = new ThreadingResolver(db as any);
    const out = await r.resolve({ ...baseInput, mode: "new_thread" });
    expect(out).toBeNull();
    expect(db.__findFirst).not.toHaveBeenCalled();
  });

  it("last_email_step returns the most recent thread row with a chain", async () => {
    const db = makeDb({
      findFirst: {
        mailThreadId: "t-last",
        mailMessageId: "m-last",
        subject: "Bonjour",
        executionCounter: 3,
      },
      // The chain query returns every prior execution with a message id,
      // ordered oldest → newest. Bare ids — the resolver wraps angles.
      selectResultSequence: [
        [
          { mailMessageId: "m-0" },
          { mailMessageId: "m-1" },
          { mailMessageId: "m-last" },
        ],
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = new ThreadingResolver(db as any);
    const out = await r.resolve({ ...baseInput, mode: "last_email_step" });
    expect(out).toEqual({
      threadId: "t-last",
      replyToMessageId: "m-last",
      subject: "Bonjour",
      references: "<m-0> <m-1> <m-last>",
    });
  });

  it("last_email_step returns null when no prior thread", async () => {
    const db = makeDb({ findFirst: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await new ThreadingResolver(db as any).resolve({
      ...baseInput,
      mode: "last_email_step",
    });
    expect(out).toBeNull();
  });

  it("entry_email_step returns the earliest thread row with a single-id chain", async () => {
    const db = makeDb({
      findFirst: {
        mailThreadId: "t-entry",
        mailMessageId: "m-entry",
        subject: "Pitch",
        executionCounter: 1,
      },
      // Only the entry message itself is in the chain (it is the first).
      selectResultSequence: [[{ mailMessageId: "m-entry" }]],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await new ThreadingResolver(db as any).resolve({
      ...baseInput,
      mode: "entry_email_step",
    });
    expect(out).toEqual({
      threadId: "t-entry",
      replyToMessageId: "m-entry",
      subject: "Pitch",
      references: "<m-entry>",
    });
  });

  it("preserves existing angle brackets when the DB stored them", async () => {
    const db = makeDb({
      findFirst: {
        mailThreadId: "t-x",
        mailMessageId: "<m-3>",
        subject: "Sujet",
        executionCounter: 3,
      },
      selectResultSequence: [
        [{ mailMessageId: "m-1" }, { mailMessageId: "<m-2>" }, { mailMessageId: "<m-3>" }],
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await new ThreadingResolver(db as any).resolve({
      ...baseInput,
      mode: "last_email_step",
    });
    expect(out?.references).toBe("<m-1> <m-2> <m-3>");
  });

  it("last_answered_step falls back to last_email_step when no inbound exists", async () => {
    // Two `.select()` calls happen :
    //   1. answered-thread lookup → empty (= no inbound interaction)
    //   2. References chain builder for the last_email fallback
    const db = makeDb({
      findFirst: {
        mailThreadId: "t-last",
        mailMessageId: "m-last",
        subject: "Bonjour",
        executionCounter: 2,
      },
      selectResultSequence: [
        [], // no inbound
        [{ mailMessageId: "m-0" }, { mailMessageId: "m-last" }],
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await new ThreadingResolver(db as any).resolve({
      ...baseInput,
      mode: "last_answered_step",
    });
    expect(out).toEqual({
      threadId: "t-last",
      replyToMessageId: "m-last",
      subject: "Bonjour",
      references: "<m-0> <m-last>",
    });
  });

  it("last_answered_step uses the inbound thread when one exists", async () => {
    // Two `.select()` calls again :
    //   1. answered-thread lookup → returns the matched thread id
    //   2. References chain builder
    const db = makeDb({
      // findFirst (called by findExecutionByThreadId) returns the
      // execution row owning that thread.
      findFirst: {
        mailThreadId: "t-answered",
        mailMessageId: "m-answered",
        subject: "Re: Bonjour",
        executionCounter: 2,
      },
      selectResultSequence: [
        [{ threadId: "t-answered" }],
        [{ mailMessageId: "m-0" }, { mailMessageId: "m-answered" }],
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await new ThreadingResolver(db as any).resolve({
      ...baseInput,
      mode: "last_answered_step",
    });
    expect(out).toEqual({
      threadId: "t-answered",
      replyToMessageId: "m-answered",
      subject: "Re: Bonjour",
      references: "<m-0> <m-answered>",
    });
  });
});
