import { describe, it, expect } from "vitest";
import {
  DEFAULT_WORK_PATTERN,
  getWorkPatternWindowsForDay,
  isWorkingDay,
  workingMinutesOnDay,
  type WorkPattern,
} from "@/lib/sequences/work-pattern";

describe("work-pattern", () => {
  describe("DEFAULT_WORK_PATTERN", () => {
    it("covers Mon-Fri with 6 hours total", () => {
      // 2027-01-25 is a Monday
      const mon = new Date("2027-01-25T12:00:00Z");
      expect(workingMinutesOnDay(DEFAULT_WORK_PATTERN, mon, "Europe/Paris")).toBe(360);
    });

    it("is empty on weekends", () => {
      const sat = new Date("2027-01-30T12:00:00Z");
      const sun = new Date("2027-01-31T12:00:00Z");
      expect(isWorkingDay(DEFAULT_WORK_PATTERN, sat, "Europe/Paris")).toBe(false);
      expect(isWorkingDay(DEFAULT_WORK_PATTERN, sun, "Europe/Paris")).toBe(false);
    });

    it("returns two windows (morning + afternoon) on a weekday", () => {
      const mon = new Date("2027-01-25T12:00:00Z");
      const w = getWorkPatternWindowsForDay(DEFAULT_WORK_PATTERN, mon, "Europe/Paris");
      expect(w).toHaveLength(2);
    });
  });

  describe("TZ correctness", () => {
    it("a 9:00 Paris window starts at 08:00 UTC in winter", () => {
      const mon = new Date("2027-01-25T12:00:00Z"); // winter (CET = UTC+1)
      const [first] = getWorkPatternWindowsForDay(DEFAULT_WORK_PATTERN, mon, "Europe/Paris");
      expect(first!.startUtc.toISOString()).toBe("2027-01-25T08:00:00.000Z");
      expect(first!.endUtc.toISOString()).toBe("2027-01-25T11:00:00.000Z");
    });

    it("a 9:00 Paris window starts at 07:00 UTC in summer (DST)", () => {
      const mon = new Date("2027-07-26T12:00:00Z"); // summer (CEST = UTC+2)
      const [first] = getWorkPatternWindowsForDay(DEFAULT_WORK_PATTERN, mon, "Europe/Paris");
      expect(first!.startUtc.toISOString()).toBe("2027-07-26T07:00:00.000Z");
    });

    it("the same UTC moment can be a working day in Tokyo and a weekend in NY", () => {
      // 2027-01-30 14:00 UTC = Sat 23:00 Tokyo (weekend) but Sat 09:00 NY
      // Both are weekends actually. Try : Sun 2027-01-31 00:00 UTC = Sun 09:00 Tokyo, Sat 19:00 NY
      const moment = new Date("2027-01-31T00:00:00Z");
      const pattern: WorkPattern = {
        sunday: [{ start: "09:00", end: "12:00" }],
        saturday: [{ start: "09:00", end: "12:00" }],
      };
      expect(isWorkingDay(pattern, moment, "Asia/Tokyo")).toBe(true); // Sunday in Tokyo
      expect(isWorkingDay(pattern, moment, "America/New_York")).toBe(true); // Saturday in NY
    });
  });

  describe("custom patterns", () => {
    it("supports overlapping multiple windows per day", () => {
      const pattern: WorkPattern = {
        monday: [
          { start: "08:00", end: "10:00" },
          { start: "13:00", end: "18:00" },
        ],
      };
      const mon = new Date("2027-01-25T12:00:00Z");
      const w = getWorkPatternWindowsForDay(pattern, mon, "Europe/Paris");
      expect(w).toHaveLength(2);
      expect(workingMinutesOnDay(pattern, mon, "Europe/Paris")).toBe(120 + 300);
    });

    it("returns no windows for an undefined day", () => {
      const pattern: WorkPattern = { monday: [{ start: "09:00", end: "17:00" }] };
      const tue = new Date("2027-01-26T12:00:00Z");
      expect(getWorkPatternWindowsForDay(pattern, tue, "Europe/Paris")).toEqual([]);
    });
  });
});
