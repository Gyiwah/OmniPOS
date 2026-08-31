import { isUuid, uuidv7, uuidv7Timestamp } from "@/src/core/ids/uuidv7";
import { __resetUuidv7State } from "@/src/core/ids/uuidv7";

describe("uuidv7", () => {
  beforeEach(() => {
    __resetUuidv7State();
  });

  it("produces well-formed UUIDs with version 7 and the RFC variant", () => {
    for (let i = 0; i < 200; i += 1) {
      const id = uuidv7();
      expect(isUuid(id)).toBe(true);
      expect(id[14]).toBe("7");
      expect("89ab").toContain(id[19]);
    }
  });

  it("does not collide across a large batch", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50_000; i += 1) seen.add(uuidv7());
    expect(seen.size).toBe(50_000);
  });

  it("is lexicographically sortable in generation order", () => {
    const ids = Array.from({ length: 5_000 }, () => uuidv7());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it("stays monotonic within a single frozen millisecond", () => {
    const spy = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const ids = Array.from({ length: 2_000 }, () => uuidv7());
      expect([...ids].sort()).toEqual(ids);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      spy.mockRestore();
    }
  });

  it("never regresses when the wall clock moves backwards", () => {
    const spy = jest.spyOn(Date, "now");
    spy.mockReturnValue(1_700_000_000_000);
    const before = uuidv7();
    // Simulate an NTP correction dragging the terminal clock back a full minute.
    spy.mockReturnValue(1_699_999_940_000);
    const after = Array.from({ length: 100 }, () => uuidv7());
    spy.mockRestore();

    expect(after.every((id) => id > before)).toBe(true);
    expect([...after].sort()).toEqual(after);
  });

  it("embeds a recoverable creation timestamp", () => {
    const at = 1_700_000_000_000;
    const spy = jest.spyOn(Date, "now").mockReturnValue(at);
    const id = uuidv7();
    spy.mockRestore();
    expect(uuidv7Timestamp(id)).toBe(at);
  });

  it("rejects non-UUID strings", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});
