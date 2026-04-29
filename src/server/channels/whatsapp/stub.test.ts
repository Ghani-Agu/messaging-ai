import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Channel } from "@prisma/client";
import { StubWhatsAppClient } from "./stub";
import { verifyWhatsAppSignature } from "./signatures";

/**
 * Stub roundtrip + delivery-callback coverage. The stub writes to
 * `.stub-deliveries/whatsapp.jsonl` relative to process.cwd(), so we
 * cd into a fresh tmp directory for the duration of the suite and
 * snapshot what was written.
 */

const TEST_SECRET = "stub_test_webhook_secret_min_16chars";

const fakeChannel: Channel = {
  id: "chn_test",
  tenantId: "tnt_test",
  type: "WHATSAPP",
  displayName: "Test WhatsApp",
  status: "CONNECTED",
  config: {
    provider: "threesixtydialog",
    phoneNumberId: "phn_test_123",
    phoneNumber: "+213555000000",
  },
  credentials: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const credentials = {
  apiToken: "tok_stub_unused",
  webhookSecret: TEST_SECRET,
};

let tmpRoot: string;
let originalCwd: string;
let suiteFetch: ReturnType<typeof vi.fn>;

beforeAll(() => {
  originalCwd = process.cwd();
  tmpRoot = mkdtempSync(join(tmpdir(), "stub-whatsapp-"));
  process.chdir(tmpRoot);
  // Stub fetch suite-wide so the fire-and-forget delivery callbacks
  // scheduled by the JSONL tests don't crash when their setTimeout
  // fires after their test has completed (real-timer leak across
  // tests). Test 3 swaps to its own mock to verify the call.
  suiteFetch = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", suiteFetch);
});

afterAll(() => {
  vi.unstubAllGlobals();
  process.chdir(originalCwd);
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StubWhatsAppClient.sendMessage", () => {
  it("returns a stub_msg_<uuid>-shaped providerMessageId", async () => {
    // No NEXT_PUBLIC_APP_URL → callback is skipped (warning, not error).
    delete process.env.NEXT_PUBLIC_APP_URL;
    const client = new StubWhatsAppClient({
      channel: fakeChannel,
      credentials,
    });
    const res = await client.sendMessage({
      to: "+213555111222",
      content: "hello",
    });
    expect(res.providerMessageId).toMatch(
      /^stub_msg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("appends one JSONL line per send to .stub-deliveries/whatsapp.jsonl", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const client = new StubWhatsAppClient({
      channel: fakeChannel,
      credentials,
    });
    await client.sendMessage({ to: "+213555AAA", content: "first" });
    await client.sendMessage({ to: "+213555BBB", content: "second" });

    const path = join(tmpRoot, ".stub-deliveries", "whatsapp.jsonl");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last.channelId).toBe(fakeChannel.id);
    expect(last.phoneNumberId).toBe("phn_test_123");
    expect(last.to).toBe("+213555BBB");
    expect(last.content).toBe("second");
    expect(last.providerMessageId).toMatch(/^stub_msg_/);
  });

  it("delivery callback POSTs to /api/whatsapp/webhook with a valid HMAC signature", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    vi.useFakeTimers();

    // Reset the suite-wide fetch mock so this test owns its call count.
    suiteFetch.mockClear();

    const client = new StubWhatsAppClient({
      channel: fakeChannel,
      credentials,
    });
    const { providerMessageId } = await client.sendMessage({
      to: "+213555CCC",
      content: "callback test",
    });

    // Advance past the 500ms delivery delay.
    await vi.advanceTimersByTimeAsync(600);

    expect(suiteFetch).toHaveBeenCalledTimes(1);
    const callArgs = suiteFetch.mock.calls[0]!;
    const url = callArgs[0] as string;
    const init = callArgs[1] as RequestInit & { headers: Record<string, string> };
    expect(url).toBe("http://localhost:3000/api/whatsapp/webhook");
    expect(init.method).toBe("POST");

    // The body is the raw signed payload — re-verify the HMAC against
    // the same secret to prove the stub uses the real path. This is the
    // load-bearing assertion: signature regressions on the verification
    // side will surface as a false here.
    const rawBody = init.body as string;
    const signature = init.headers["X-360DIALOG-Signature"];
    expect(
      verifyWhatsAppSignature({
        rawBody,
        signatureHeader: signature,
        secret: TEST_SECRET,
      }),
    ).toBe(true);

    // The payload references the providerMessageId we just got back.
    const parsed = JSON.parse(rawBody);
    const status = parsed.entry[0].changes[0].value.statuses[0];
    expect(status.id).toBe(providerMessageId);
    expect(status.status).toBe("delivered");
    expect(parsed.entry[0].changes[0].value.metadata.phone_number_id).toBe(
      "phn_test_123",
    );
  });
});

describe("StubWhatsAppClient.getProfile", () => {
  it("returns a deterministic stub profile", async () => {
    const client = new StubWhatsAppClient({
      channel: fakeChannel,
      credentials,
    });
    expect(await client.getProfile({ phoneNumber: "+213555000000" })).toEqual({
      name: "Stub Customer",
    });
  });
});
