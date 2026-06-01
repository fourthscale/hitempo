import { describe, it, expect } from "vitest";
import {
  evaluateNextContactStatus,
  type ContactStatus,
} from "@/lib/contacts/contact-status";

describe("evaluateNextContactStatus", () => {
  describe("auto-promote on outbound_sent", () => {
    it("to_contact → contacted", () => {
      expect(evaluateNextContactStatus("to_contact", { kind: "outbound_sent" })).toBe(
        "contacted",
      );
    });

    it("contacted → no change (already past outbound milestone)", () => {
      expect(evaluateNextContactStatus("contacted", { kind: "outbound_sent" })).toBeNull();
    });
  });

  describe("auto-promote on inbound_received", () => {
    it("contacted → replied", () => {
      expect(evaluateNextContactStatus("contacted", { kind: "inbound_received" })).toBe(
        "replied",
      );
    });

    it("to_contact → replied (skip-ahead when reply arrives before any logged outbound)", () => {
      expect(evaluateNextContactStatus("to_contact", { kind: "inbound_received" })).toBe(
        "replied",
      );
    });
  });

  describe("never demotes", () => {
    it("replied stays put on outbound (next outreach doesn't undo a reply)", () => {
      expect(evaluateNextContactStatus("replied", { kind: "outbound_sent" })).toBeNull();
    });

    it("replied stays put on a second inbound", () => {
      expect(
        evaluateNextContactStatus("replied", { kind: "inbound_received" }),
      ).toBeNull();
    });
  });

  describe("never overrides manual statuses", () => {
    const manualStatuses: ContactStatus[] = [
      "to_follow_up",
      "qualified",
      "not_interested",
    ];
    for (const s of manualStatuses) {
      it(`${s} : ignored on outbound_sent`, () => {
        expect(evaluateNextContactStatus(s, { kind: "outbound_sent" })).toBeNull();
      });
      it(`${s} : ignored on inbound_received`, () => {
        expect(evaluateNextContactStatus(s, { kind: "inbound_received" })).toBeNull();
      });
    }
  });

  describe("unknown status (forward-compat)", () => {
    it("returns null rather than throwing", () => {
      expect(
        evaluateNextContactStatus("future_status_xyz", { kind: "outbound_sent" }),
      ).toBeNull();
    });
  });
});
