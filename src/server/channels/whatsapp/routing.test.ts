import { describe, expect, it } from "vitest";
import { extractPhoneNumberId } from "./routing";

describe("extractPhoneNumberId", () => {
  it("pulls phone_number_id from a valid envelope", () => {
    expect(
      extractPhoneNumberId({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "phn_abc" },
                },
              },
            ],
          },
        ],
      }),
    ).toBe("phn_abc");
  });

  it("returns null on missing entry", () => {
    expect(extractPhoneNumberId({})).toBeNull();
  });

  it("returns null on non-array entry", () => {
    expect(extractPhoneNumberId({ entry: "x" })).toBeNull();
  });

  it("returns null on missing metadata.phone_number_id", () => {
    expect(
      extractPhoneNumberId({
        entry: [{ changes: [{ value: { metadata: {} } }] }],
      }),
    ).toBeNull();
  });

  it("returns null on empty entry array", () => {
    expect(extractPhoneNumberId({ entry: [] })).toBeNull();
  });

  it("tolerates non-object inputs", () => {
    expect(extractPhoneNumberId(null)).toBeNull();
    expect(extractPhoneNumberId(undefined)).toBeNull();
    expect(extractPhoneNumberId("string")).toBeNull();
    expect(extractPhoneNumberId(42)).toBeNull();
  });

  it("walks past malformed entries to find a valid one", () => {
    expect(
      extractPhoneNumberId({
        entry: [
          { changes: "broken" },
          {
            changes: [
              { value: { metadata: { phone_number_id: "phn_walked" } } },
            ],
          },
        ],
      }),
    ).toBe("phn_walked");
  });
});
