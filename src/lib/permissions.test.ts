import { describe, expect, it } from "vitest";
import {
  PERMISSION_SLUGS,
  ROLE_PRESETS,
  getEffectivePermissions,
  hasPermission,
  isPermissionSlug,
  labelForPermission,
} from "./permissions";

describe("hasPermission", () => {
  it("returns true when the slug is in the list", () => {
    expect(hasPermission(["conversations:view", "products:view"], "products:view")).toBe(
      true,
    );
  });

  it("returns false when the slug is absent", () => {
    expect(hasPermission(["conversations:view"], "products:edit")).toBe(false);
  });

  it("returns false against an empty list", () => {
    expect(hasPermission([], "dashboard:view")).toBe(false);
  });
});

describe("ROLE_PRESETS", () => {
  it("OWNER preset contains every defined permission slug", () => {
    expect([...ROLE_PRESETS.OWNER].sort()).toEqual([...PERMISSION_SLUGS].sort());
  });

  it("ADMIN preset excludes members:edit but includes every other slug", () => {
    expect(ROLE_PRESETS.ADMIN).not.toContain("members:edit");
    const missing = PERMISSION_SLUGS.filter(
      (s) => s !== "members:edit" && !ROLE_PRESETS.ADMIN.includes(s),
    );
    expect(missing).toEqual([]);
  });

  it("AGENT preset includes conversations + view-only on knowledge", () => {
    expect(ROLE_PRESETS.AGENT).toContain("conversations:view");
    expect(ROLE_PRESETS.AGENT).toContain("conversations:edit");
    expect(ROLE_PRESETS.AGENT).toContain("products:view");
    expect(ROLE_PRESETS.AGENT).not.toContain("products:edit");
    expect(ROLE_PRESETS.AGENT).not.toContain("qna:edit");
    expect(ROLE_PRESETS.AGENT).not.toContain("business-info:edit");
  });

  it("VIEWER preset is :view-only (no edit permissions)", () => {
    for (const slug of ROLE_PRESETS.VIEWER) {
      expect(slug.endsWith(":view")).toBe(true);
    }
    // And the obvious view ones are present.
    expect(ROLE_PRESETS.VIEWER).toContain("dashboard:view");
    expect(ROLE_PRESETS.VIEWER).toContain("conversations:view");
  });
});

describe("isPermissionSlug", () => {
  it("narrows known slugs", () => {
    expect(isPermissionSlug("conversations:view")).toBe(true);
  });

  it("rejects unknown / typo slugs", () => {
    expect(isPermissionSlug("conversations:VIEW")).toBe(false);
    expect(isPermissionSlug("unknown:slug")).toBe(false);
    expect(isPermissionSlug("")).toBe(false);
  });
});

describe("getEffectivePermissions", () => {
  it("OWNER always gets the full slug list regardless of stored permissions", () => {
    const e = getEffectivePermissions({ role: "OWNER", permissions: [] });
    expect([...e].sort()).toEqual([...PERMISSION_SLUGS].sort());
  });

  it("non-OWNER gets the stored list filtered to known slugs", () => {
    const e = getEffectivePermissions({
      role: "AGENT",
      permissions: ["products:view", "totally-bogus", "qna:view"],
    });
    expect(e).toEqual(["products:view", "qna:view"]);
  });

  it("non-OWNER with empty stored list resolves to []", () => {
    expect(
      getEffectivePermissions({ role: "VIEWER", permissions: [] }),
    ).toEqual([]);
  });
});

describe("labelForPermission", () => {
  it("returns a human label for each slug", () => {
    for (const slug of PERMISSION_SLUGS) {
      const label = labelForPermission(slug);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
