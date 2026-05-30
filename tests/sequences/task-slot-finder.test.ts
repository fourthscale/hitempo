import { describe, it, expect } from "vitest";
import { toZonedTime } from "date-fns-tz";
import {
  findNextFreeSlot,
  NoFreeSlotError,
  type SaleMember,
  type ExistingTask,
} from "@/lib/sequences/task-slot-finder";
import { DEFAULT_WORK_PATTERN, type WorkPattern } from "@/lib/sequences/work-pattern";

function memberDefault(overrides: Partial<SaleMember> = {}): SaleMember {
  return {
    timezone: "Europe/Paris",
    workPattern: DEFAULT_WORK_PATTERN,
    maxEmailsPerDay: 25,
    maxCallsPerDay: 10,
    ...overrides,
  };
}

function parisHM(d: Date): string {
  const z = toZonedTime(d, "Europe/Paris");
  return `${String(z.getHours()).padStart(2, "0")}:${String(z.getMinutes()).padStart(2, "0")}`;
}
function parisDate(d: Date): string {
  const z = toZonedTime(d, "Europe/Paris");
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-${String(z.getDate()).padStart(2, "0")}`;
}

describe("findNextFreeSlot — empty agenda", () => {
  it("returns desired moment if it falls in a work window and no conflict", () => {
    const desired = new Date("2027-01-25T08:00:00Z"); // Mon 09:00 Paris
    const slot = findNextFreeSlot(desired, 5, "email", memberDefault(), []);
    expect(slot.getTime()).toBe(desired.getTime());
  });

  it("snaps to start of next window if desired falls in a lunch break", () => {
    const desired = new Date("2027-01-25T12:00:00Z"); // Mon 13:00 Paris (lunch break)
    const slot = findNextFreeSlot(desired, 5, "email", memberDefault(), []);
    expect(parisHM(slot)).toBe("14:00");
  });

  it("rolls to next day if desired is after working hours", () => {
    const desired = new Date("2027-01-25T17:00:00Z"); // Mon 18:00 Paris (after end)
    const slot = findNextFreeSlot(desired, 5, "email", memberDefault(), []);
    expect(parisDate(slot)).toBe("2027-01-26"); // Tuesday
    expect(parisHM(slot)).toBe("09:00");
  });

  it("skips weekends with default pattern", () => {
    const desired = new Date("2027-01-30T08:00:00Z"); // Sat
    const slot = findNextFreeSlot(desired, 5, "email", memberDefault(), []);
    expect(parisDate(slot)).toBe("2027-02-01"); // Mon
    expect(parisHM(slot)).toBe("09:00");
  });
});

describe("findNextFreeSlot — anti-conflict", () => {
  it("inserts after a conflicting task + 5-min buffer", () => {
    const desired = new Date("2027-01-25T08:00:00Z"); // Mon 09:00 Paris
    const existing: ExistingTask[] = [
      {
        scheduledFor: new Date("2027-01-25T08:00:00Z"), // 09:00 Paris
        estimatedDurationMinutes: 15,
        type: "phone",
      },
    ];
    const slot = findNextFreeSlot(desired, 5, "email", memberDefault(), existing);
    // 09:00 + 15 + 5 buffer = 09:20
    expect(parisHM(slot)).toBe("09:20");
  });

  it("packs 4 calls of 15 min consecutively with 5-min buffer", () => {
    const desired = new Date("2027-01-25T08:00:00Z"); // Mon 09:00 Paris
    const existing: ExistingTask[] = [];
    const member = memberDefault();
    const times: string[] = [];
    for (let i = 0; i < 4; i++) {
      const slot = findNextFreeSlot(desired, 15, "phone", member, existing);
      times.push(parisHM(slot));
      existing.push({ scheduledFor: slot, estimatedDurationMinutes: 15, type: "phone" });
    }
    // 09:00, 09:20, 09:40, 10:00
    expect(times).toEqual(["09:00", "09:20", "09:40", "10:00"]);
  });

  it("jumps to afternoon window after morning window fills", () => {
    const member = memberDefault();
    const desired = new Date("2027-01-25T08:00:00Z"); // Mon 09:00 Paris
    // Pre-fill the morning window 09:00-12:00 with one big task of 180 minutes
    const existing: ExistingTask[] = [
      {
        scheduledFor: new Date("2027-01-25T08:00:00Z"), // 09:00 Paris
        estimatedDurationMinutes: 180,
        type: "phone",
      },
    ];
    const slot = findNextFreeSlot(desired, 15, "phone", member, existing);
    expect(parisHM(slot)).toBe("14:00");
  });
});

describe("findNextFreeSlot — quotas", () => {
  it("skips the day if email quota is saturated", () => {
    const member = memberDefault({ maxEmailsPerDay: 2 });
    const existing: ExistingTask[] = [
      { scheduledFor: new Date("2027-01-25T08:00:00Z"), estimatedDurationMinutes: 5, type: "email" },
      { scheduledFor: new Date("2027-01-25T08:30:00Z"), estimatedDurationMinutes: 5, type: "email" },
    ];
    const desired = new Date("2027-01-25T08:00:00Z");
    const slot = findNextFreeSlot(desired, 5, "email", member, existing);
    expect(parisDate(slot)).toBe("2027-01-26"); // Tuesday
  });

  it("quota is per type — emails saturated, calls still ok", () => {
    const member = memberDefault({ maxEmailsPerDay: 2 });
    const existing: ExistingTask[] = [
      { scheduledFor: new Date("2027-01-25T08:00:00Z"), estimatedDurationMinutes: 5, type: "email" },
      { scheduledFor: new Date("2027-01-25T08:30:00Z"), estimatedDurationMinutes: 5, type: "email" },
    ];
    const desired = new Date("2027-01-25T08:00:00Z");
    const slot = findNextFreeSlot(desired, 15, "phone", member, existing);
    expect(parisDate(slot)).toBe("2027-01-25"); // Monday still
  });

  it("types without a quota are not capped", () => {
    const member = memberDefault({ maxEmailsPerDay: 0 });
    const desired = new Date("2027-01-25T08:00:00Z");
    // type 'visit' has no quota → places fine even if emails are at 0
    const slot = findNextFreeSlot(desired, 15, "visit", member, []);
    expect(parisDate(slot)).toBe("2027-01-25");
  });
});

describe("findNextFreeSlot — horizon", () => {
  it("throws NoFreeSlotError if 14 days of weekends-only pattern (impossible)", () => {
    const member = memberDefault({ workPattern: { saturday: [], sunday: [] } as WorkPattern });
    const desired = new Date("2027-01-25T08:00:00Z");
    expect(() => findNextFreeSlot(desired, 5, "email", member, [])).toThrow(NoFreeSlotError);
  });
});
