import { describe, it, expect } from "vitest";
import { toZonedTime } from "date-fns-tz";
import { computeTaskSchedule, DEFAULT_SCHEDULING } from "@/lib/sequences/scheduling";

function parisHM(d: Date): string {
  const z = toZonedTime(d, "Europe/Paris");
  return `${String(z.getHours()).padStart(2, "0")}:${String(z.getMinutes()).padStart(2, "0")}`;
}
function parisDate(d: Date): string {
  const z = toZonedTime(d, "Europe/Paris");
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-${String(z.getDate()).padStart(2, "0")}`;
}
function tokyoHM(d: Date): string {
  const z = toZonedTime(d, "Asia/Tokyo");
  return `${String(z.getHours()).padStart(2, "0")}:${String(z.getMinutes()).padStart(2, "0")}`;
}

describe("computeTaskSchedule — defaults & basic", () => {
  it("Monday 8h Paris + defaults → scheduledFor Monday 9h Paris (same day, preferred hour)", () => {
    const now = new Date("2027-01-25T07:00:00Z"); // Mon 08:00 Paris
    const r = computeTaskSchedule(now, {}, "Europe/Paris");
    expect(parisHM(r.scheduledFor!)).toBe("09:00");
    expect(parisDate(r.scheduledFor!)).toBe("2027-01-25");
    expect(r.dueAt).toBeNull();
    expect(r.dueAtAllDay).toBe(false);
  });

  it("Monday 11h Paris + defaults → scheduledFor Tuesday 9h Paris (past preferred today)", () => {
    const now = new Date("2027-01-25T10:00:00Z"); // Mon 11:00 Paris
    const r = computeTaskSchedule(now, {}, "Europe/Paris");
    expect(parisDate(r.scheduledFor!)).toBe("2027-01-26"); // Tuesday
    expect(parisHM(r.scheduledFor!)).toBe("09:00");
  });

  it("Sunday → scheduledFor Monday 9h Paris", () => {
    const now = new Date("2027-01-31T15:00:00Z"); // Sun 16:00 Paris
    const r = computeTaskSchedule(now, {}, "Europe/Paris");
    expect(parisDate(r.scheduledFor!)).toBe("2027-02-01");
    expect(parisHM(r.scheduledFor!)).toBe("09:00");
  });
});

describe("computeTaskSchedule — offsets", () => {
  it("scheduledOffsetBusinessDays = 2 → skip 2 weekdays", () => {
    const now = new Date("2027-01-25T07:00:00Z"); // Mon 08:00 Paris
    const r = computeTaskSchedule(
      now,
      { scheduledOffsetBusinessDays: 2 },
      "Europe/Paris",
    );
    expect(parisDate(r.scheduledFor!)).toBe("2027-01-27"); // Wed
  });

  it("Friday + offset 1 → next Monday (weekend skipped)", () => {
    const now = new Date("2027-01-29T07:00:00Z"); // Fri 08:00 Paris
    const r = computeTaskSchedule(
      now,
      { scheduledOffsetBusinessDays: 1 },
      "Europe/Paris",
    );
    expect(parisDate(r.scheduledFor!)).toBe("2027-02-01"); // Mon
  });
});

describe("computeTaskSchedule — dueAt", () => {
  it("setDueAt=true, all-day → dueAt at 23:59 contactTz", () => {
    const now = new Date("2027-01-25T07:00:00Z"); // Mon 08:00 Paris
    const r = computeTaskSchedule(
      now,
      { setDueAt: true, dueOffsetBusinessDays: 1, dueAtAllDay: true },
      "Europe/Paris",
    );
    expect(parisDate(r.dueAt!)).toBe("2027-01-26"); // Tue
    expect(parisHM(r.dueAt!)).toBe("23:59");
    expect(r.dueAtAllDay).toBe(true);
  });

  it("setDueAt=true, NOT all-day → dueAt at preferredHour", () => {
    const now = new Date("2027-01-25T07:00:00Z"); // Mon 08:00 Paris
    const r = computeTaskSchedule(
      now,
      { setDueAt: true, dueOffsetBusinessDays: 2, dueAtAllDay: false, preferredHour: 10 },
      "Europe/Paris",
    );
    expect(parisDate(r.dueAt!)).toBe("2027-01-27"); // Wed
    expect(parisHM(r.dueAt!)).toBe("10:00");
    expect(r.dueAtAllDay).toBe(false);
  });

  it("setScheduledFor=false, setDueAt=true → only dueAt", () => {
    const now = new Date("2027-01-25T07:00:00Z");
    const r = computeTaskSchedule(
      now,
      { setScheduledFor: false, setDueAt: true, dueOffsetBusinessDays: 0 },
      "Europe/Paris",
    );
    expect(r.scheduledFor).toBeNull();
    expect(r.dueAt).not.toBeNull();
  });

  it("both unset → returns all null", () => {
    const now = new Date("2027-01-25T07:00:00Z");
    const r = computeTaskSchedule(
      now,
      { setScheduledFor: false, setDueAt: false },
      "Europe/Paris",
    );
    expect(r).toEqual({ scheduledFor: null, dueAt: null, dueAtAllDay: false });
  });
});

describe("computeTaskSchedule — TZ across the world", () => {
  it("Monday 9h Tokyo = Monday 01:00 Paris (winter)", () => {
    // now = Sunday 23:00 UTC = Monday 08:00 Tokyo
    const now = new Date("2027-01-24T23:00:00Z");
    const r = computeTaskSchedule(now, { preferredHour: 9 }, "Asia/Tokyo");
    expect(tokyoHM(r.scheduledFor!)).toBe("09:00");
    // 9h Tokyo on a winter day = 01:00 Paris (no DST in Tokyo, JST = UTC+9)
    expect(parisHM(r.scheduledFor!)).toBe("01:00");
  });

  it("preferredHour applies in the CONTACT TZ regardless of the now moment", () => {
    // now = Friday 23h Paris (= Sat 7h Tokyo) → contact = Tokyo
    const now = new Date("2027-01-29T22:00:00Z"); // Fri 23:00 Paris = Sat 07:00 Tokyo
    const r = computeTaskSchedule(now, { preferredHour: 9 }, "Asia/Tokyo");
    // Sat is not allowed → Mon 9h Tokyo
    expect(tokyoHM(r.scheduledFor!)).toBe("09:00");
    const z = toZonedTime(r.scheduledFor!, "Asia/Tokyo");
    expect(z.getDay()).toBe(1); // Monday
  });
});

describe("computeTaskSchedule — defaults sanity", () => {
  it("DEFAULT_SCHEDULING covers all keys", () => {
    expect(Object.keys(DEFAULT_SCHEDULING).sort()).toEqual(
      [
        "allowedWeekdays",
        "businessHours",
        "dueAtAllDay",
        "dueOffsetBusinessDays",
        "estimatedDurationMinutes",
        "preferredHour",
        "scheduledOffsetBusinessDays",
        "setDueAt",
        "setScheduledFor",
      ].sort(),
    );
  });
});
