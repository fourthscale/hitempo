import { describe, it, expect } from "vitest";
import { formatDateInTz } from "@/lib/i18n/format-date";

// 2026-06-04T07:00:00Z = 09:00 Europe/Paris (summer, DST = UTC+2)
//                     = 16:00 Asia/Tokyo
//                     = 03:00 America/New_York
const SUMMER_UTC = new Date("2026-06-04T07:00:00Z");

// 2026-01-15T07:00:00Z = 08:00 Europe/Paris (winter, no DST = UTC+1)
const WINTER_UTC = new Date("2026-01-15T07:00:00Z");

describe("formatDateInTz", () => {
  it("formats summer UTC instant in Europe/Paris correctly (DST handling)", () => {
    const out = formatDateInTz(SUMMER_UTC, "fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(out).toMatch(/09:00/);
  });

  it("formats winter UTC instant in Europe/Paris correctly (no DST)", () => {
    const out = formatDateInTz(WINTER_UTC, "fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(out).toMatch(/08:00/);
  });

  it("crosses dateline correctly — Tokyo afternoon for an early-morning UTC", () => {
    const out = formatDateInTz(SUMMER_UTC, "en-US", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    expect(out).toMatch(/16:00/);
  });

  it("crosses dateline correctly — New York is 4h behind UTC in summer (EDT)", () => {
    const out = formatDateInTz(SUMMER_UTC, "en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    expect(out).toMatch(/03:00/);
  });

  it("respects locale for date wording", () => {
    const fr = formatDateInTz(SUMMER_UTC, "fr-FR", {
      timeZone: "Europe/Paris",
      dateStyle: "long",
    });
    const en = formatDateInTz(SUMMER_UTC, "en-US", {
      timeZone: "Europe/Paris",
      dateStyle: "long",
    });
    expect(fr).toMatch(/juin/i);
    expect(en).toMatch(/June/i);
  });

  it("accepts ISO strings and number timestamps", () => {
    const fromIso = formatDateInTz("2026-06-04T07:00:00Z", "fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
    });
    const fromMillis = formatDateInTz(SUMMER_UTC.getTime(), "fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(fromIso).toMatch(/09:00/);
    expect(fromMillis).toMatch(/09:00/);
  });

  it("returns empty string for null / undefined / NaN", () => {
    expect(formatDateInTz(null, "fr-FR", { timeZone: "Europe/Paris" })).toBe("");
    expect(formatDateInTz(undefined, "fr-FR", { timeZone: "Europe/Paris" })).toBe("");
    expect(formatDateInTz("not-a-date", "fr-FR", { timeZone: "Europe/Paris" })).toBe("");
  });

  it("falls back to UTC when given a bogus timezone (no throw)", () => {
    const out = formatDateInTz(SUMMER_UTC, "fr-FR", {
      // @ts-expect-error — intentionally invalid for the test
      timeZone: "Mars/Olympus",
      hour: "2-digit",
      minute: "2-digit",
    });
    // Should not throw, should produce some string
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("defaults to medium date + short time when no style override is given", () => {
    const out = formatDateInTz(SUMMER_UTC, "fr-FR", {
      timeZone: "Europe/Paris",
    });
    // medium FR date: "4 juin 2026", short time: "09:00"
    expect(out).toContain("2026");
    expect(out).toMatch(/09:00/);
  });
});
