import { describe, expect, it } from "vitest";
import { invitationEmail } from "./invitation";

describe("invitationEmail", () => {
  it("includes the invite URL in both html and text bodies", () => {
    const url = "https://app.example.com/invitations/abc123";
    const r = invitationEmail({
      inviteUrl: url,
      tenantName: "Acme",
      inviterName: "Sam",
      role: "AGENT",
    });
    expect(r.html).toContain(url);
    expect(r.text).toContain(url);
  });

  it("subject names both the inviter and the tenant", () => {
    const r = invitationEmail({
      inviteUrl: "https://x",
      tenantName: "Acme Distribution",
      inviterName: "Sam Cooper",
      role: "ADMIN",
    });
    expect(r.subject).toContain("Sam Cooper");
    expect(r.subject).toContain("Acme Distribution");
  });

  it("greets by name when inviteeName is supplied, else generic", () => {
    const named = invitationEmail({
      inviteUrl: "https://x",
      tenantName: "Acme",
      inviterName: "Sam",
      role: "AGENT",
      inviteeName: "Lina",
    });
    expect(named.html).toContain("Bonjour Lina,");
    expect(named.text.startsWith("Bonjour Lina,")).toBe(true);

    const generic = invitationEmail({
      inviteUrl: "https://x",
      tenantName: "Acme",
      inviterName: "Sam",
      role: "AGENT",
      inviteeName: null,
    });
    expect(generic.html).toContain("Bonjour,");
  });

  it("renders the role label lowercased", () => {
    const r = invitationEmail({
      inviteUrl: "https://x",
      tenantName: "Acme",
      inviterName: "Sam",
      role: "AGENT",
    });
    expect(r.html).toContain("agent");
    expect(r.text).toContain("agent");
  });

  it("includes the recognize-or-ignore footer", () => {
    const r = invitationEmail({
      inviteUrl: "https://x",
      tenantName: "Acme",
      inviterName: "Sam",
      role: "AGENT",
    });
    expect(r.html).toMatch(/don't recognize this invitation/);
    expect(r.text).toMatch(/don't recognize this invitation/);
  });
});
