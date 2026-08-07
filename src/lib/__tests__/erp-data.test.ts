import { describe, it, expect } from "vitest";
import { approverFor, canApprove, inr, type Role } from "../erp-data";

describe("approverFor", () => {
  it("returns Administrator for amounts up to 50,000", () => {
    expect(approverFor(0)).toBe("Administrator");
    expect(approverFor(1)).toBe("Administrator");
    expect(approverFor(25000)).toBe("Administrator");
    expect(approverFor(50000)).toBe("Administrator");
  });

  it("returns A1 for amounts from 50,001 to 5,00,000", () => {
    expect(approverFor(50001)).toBe("A1");
    expect(approverFor(100000)).toBe("A1");
    expect(approverFor(250000)).toBe("A1");
    expect(approverFor(500000)).toBe("A1");
  });

  it("returns A1+ for amounts above 5,00,000", () => {
    expect(approverFor(500001)).toBe("A1+");
    expect(approverFor(1000000)).toBe("A1+");
    expect(approverFor(9999999)).toBe("A1+");
  });

  it("handles boundary values correctly", () => {
    expect(approverFor(50000)).toBe("Administrator");
    expect(approverFor(50001)).toBe("A1");
    expect(approverFor(500000)).toBe("A1");
    expect(approverFor(500001)).toBe("A1+");
  });
});

describe("canApprove", () => {
  describe("Supervisor role", () => {
    it("cannot approve any amount", () => {
      expect(canApprove("Supervisor", 1000)).toBe(false);
      expect(canApprove("Supervisor", 50000)).toBe(false);
      expect(canApprove("Supervisor", 500000)).toBe(false);
      expect(canApprove("Supervisor", 5000000)).toBe(false);
    });
  });

  describe("Administrator role", () => {
    it("can approve amounts up to 50,000", () => {
      expect(canApprove("Administrator", 1000)).toBe(true);
      expect(canApprove("Administrator", 50000)).toBe(true);
    });

    it("cannot approve amounts above 50,000", () => {
      expect(canApprove("Administrator", 50001)).toBe(false);
      expect(canApprove("Administrator", 500000)).toBe(false);
      expect(canApprove("Administrator", 5000000)).toBe(false);
    });
  });

  describe("A1 role", () => {
    it("can approve amounts up to 5,00,000", () => {
      expect(canApprove("A1", 1000)).toBe(true);
      expect(canApprove("A1", 50000)).toBe(true);
      expect(canApprove("A1", 50001)).toBe(true);
      expect(canApprove("A1", 500000)).toBe(true);
    });

    it("cannot approve amounts above 5,00,000", () => {
      expect(canApprove("A1", 500001)).toBe(false);
      expect(canApprove("A1", 5000000)).toBe(false);
    });
  });

  describe("A1+ role", () => {
    it("can approve any amount", () => {
      expect(canApprove("A1+", 1000)).toBe(true);
      expect(canApprove("A1+", 50000)).toBe(true);
      expect(canApprove("A1+", 500000)).toBe(true);
      expect(canApprove("A1+", 500001)).toBe(true);
      expect(canApprove("A1+", 5000000)).toBe(true);
    });
  });
});

describe("inr", () => {
  it("formats numbers as Indian Rupees with no decimals", () => {
    expect(inr(1000)).toBe("₹1,000");
    expect(inr(50000)).toBe("₹50,000");
    expect(inr(500000)).toBe("₹5,00,000");
    expect(inr(5000000)).toBe("₹50,00,000");
  });

  it("handles zero", () => {
    expect(inr(0)).toBe("₹0");
  });
});
