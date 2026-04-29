import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Channel } from "@prisma/client";
import { StubMessengerClient } from "./stub";
import {
  _resetMetaAppSecretWarnFlagForTests,
  verifyMetaSignature,
} from "../meta/signatures";

const PAGE_ID = "100000_PAGE_TEST";
const PSID_TARGET = "9999_TEST_PSID";

const fakeChannel: Channel = {
  id: "chn_msgr_test",
  tenantId: "tnt_test",
  type: "MESSENGER",
  displayName: "Test Messenger",
  status: "CONNECTED",
  config: {
    provider: "meta-cloud",
    pageId: PAGE_ID,
    pageName: "Test Page",
  },
  credentials: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const credentials = { pageAccessToken: "stub-page-token-unused" };

let tmpRoot: string;
let originalCwd: string;
let suiteFetch: ReturnType<typeof vi.fn>;

beforeAll(() => {
  originalCwd = process.cwd();
  tmpRoot = mkdtempSync(join(tmpdir(), "stub-messenger-"));
  process.chdir(tmpRoot);
  // Suite-wide fetch stub so any leftover real-timer setTimeouts don't
  // hit a real localhost:3000 webhook after tests complete (same
  // pattern as whatsapp/stub.test.ts).
  suiteFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", suiteFetch);
  // Stub META_APP_SECRET so the signature path is exercised against a
  // known value.
  process.env.META_APP_SECRET = "test_messenger_meta_app_secret";
  _resetMetaAppSecretWarnFlagForTests();
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 700));
  vi.unstubAllGlobals();
  delete process.env.META_APP_SECRET;
  delete process.env.NEXT_PUBLIC_APP_URL;
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

describe("StubMessengerClient.sendMessage", () => {
  it("returns a mid.STUB_<uuid>-shaped providerMessageId", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const c = new StubMessengerClient({ channel: fakeChannel, credentials });
    const r = await c.sendMessage({ to: PSID_TARGET, content: "hello" });
    expect(r.providerMessageId).toMatch(
      /^mid\.STUB_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("appends one JSONL line per send to .stub-deliveries/messenger.jsonl", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const c = new StubMessengerClient({ channel: fakeChannel, credentials });
    await c.sendMessage({ to: "psid_a", content: "first" });
    await c.sendMessage({ to: "psid_b", content: "second" });
    const path = join(tmpRoot, ".stub-deliveries", "messenger.jsonl");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last.channelId).toBe(fakeChannel.id);
    expect(last.pageId).toBe(PAGE_ID);
    expect(last.to).toBe("psid_b");
    expect(last.content).toBe("second");
    expect(last.providerMessageId).toMatch(/^mid\.STUB_/);
  });

  it("delivery callback POSTs Meta-shape payload signed with META_APP_SECRET", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    vi.useFakeTimers();
    suiteFetch.mockClear();

    const c = new StubMessengerClient({ channel: fakeChannel, credentials });
    const { providerMessageId } = await c.sendMessage({
      to: PSID_TARGET,
      content: "callback test",
    });

    await vi.advanceTimersByTimeAsync(600);

    expect(suiteFetch).toHaveBeenCalledTimes(1);
    const callArgs = suiteFetch.mock.calls[0]!;
    const url = callArgs[0] as string;
    const init = callArgs[1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(url).toBe("http://localhost:3000/api/meta/webhook");
    expect(init.method).toBe("POST");

    const rawBody = init.body as string;
    const signature = init.headers["X-Hub-Signature-256"];
    // The load-bearing assertion: signature verifies against the same
    // secret the webhook handler will validate with — the stub uses
    // the real signing path, no bypass.
    expect(
      verifyMetaSignature({
        rawBody,
        signatureHeader: signature,
        secret: process.env.META_APP_SECRET!,
      }),
    ).toBe(true);

    const parsed = JSON.parse(rawBody);
    expect(parsed.object).toBe("page");
    expect(parsed.entry[0].id).toBe(PAGE_ID);
    const delivery = parsed.entry[0].messaging[0].delivery;
    expect(delivery.mids).toEqual([providerMessageId]);
  });

  it("fire-and-forget callback never blocks sendMessage's return", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    vi.useFakeTimers();
    const c = new StubMessengerClient({ channel: fakeChannel, credentials });
    const startedAt = Date.now();
    await c.sendMessage({ to: "psid_x", content: "no-block test" });
    // Real-time elapsed should be well under 500ms (we never advanced
    // fake timers); the fire-and-forget timer is still pending.
    expect(Date.now() - startedAt).toBeLessThan(500);
    // Fall back to draining timers so afterAll's stub-fetch path is
    // hit cleanly.
    await vi.advanceTimersByTimeAsync(600);
  });
});

describe("StubMessengerClient.getProfile", () => {
  it("returns a deterministic stub profile", async () => {
    const c = new StubMessengerClient({ channel: fakeChannel, credentials });
    expect(await c.getProfile({ psid: PSID_TARGET })).toEqual({
      firstName: "Stub",
      lastName: "Customer",
    });
  });

  it("does not require a real META_APP_SECRET to construct or call", async () => {
    delete process.env.META_APP_SECRET;
    _resetMetaAppSecretWarnFlagForTests();
    const c = new StubMessengerClient({ channel: fakeChannel, credentials });
    expect(await c.getProfile({ psid: PSID_TARGET })).toEqual({
      firstName: "Stub",
      lastName: "Customer",
    });
    process.env.META_APP_SECRET = "test_messenger_meta_app_secret";
  });
});
