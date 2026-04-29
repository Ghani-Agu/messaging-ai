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
import { StubInstagramClient } from "./stub";
import {
  _resetMetaAppSecretWarnFlagForTests,
  verifyMetaSignature,
} from "../meta/signatures";

const IG_USER_ID = "17841_IG_TEST";
const IGSID_TARGET = "8888_TEST_IGSID";

const fakeChannel: Channel = {
  id: "chn_ig_test",
  tenantId: "tnt_test",
  type: "INSTAGRAM",
  displayName: "Test Instagram",
  status: "CONNECTED",
  config: {
    provider: "meta-cloud",
    igUserId: IG_USER_ID,
    igUsername: "test_official",
    pageId: "100000_PAGE_TEST",
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
  tmpRoot = mkdtempSync(join(tmpdir(), "stub-instagram-"));
  process.chdir(tmpRoot);
  suiteFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", suiteFetch);
  process.env.META_APP_SECRET = "test_instagram_meta_app_secret";
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

describe("StubInstagramClient.sendMessage", () => {
  it("returns a mid.STUB_<uuid>-shaped providerMessageId", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const c = new StubInstagramClient({ channel: fakeChannel, credentials });
    const r = await c.sendMessage({ to: IGSID_TARGET, content: "hello" });
    expect(r.providerMessageId).toMatch(
      /^mid\.STUB_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("appends one JSONL line per send to .stub-deliveries/instagram.jsonl", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const c = new StubInstagramClient({ channel: fakeChannel, credentials });
    await c.sendMessage({ to: "igsid_a", content: "first" });
    await c.sendMessage({ to: "igsid_b", content: "second" });
    const path = join(tmpRoot, ".stub-deliveries", "instagram.jsonl");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last.channelId).toBe(fakeChannel.id);
    expect(last.igUserId).toBe(IG_USER_ID);
    expect(last.to).toBe("igsid_b");
    expect(last.content).toBe("second");
  });

  it("delivery callback POSTs object='instagram' Meta-shape payload signed with META_APP_SECRET", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    vi.useFakeTimers();
    suiteFetch.mockClear();

    const c = new StubInstagramClient({ channel: fakeChannel, credentials });
    const { providerMessageId } = await c.sendMessage({
      to: IGSID_TARGET,
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

    const rawBody = init.body as string;
    const signature = init.headers["X-Hub-Signature-256"];
    expect(
      verifyMetaSignature({
        rawBody,
        signatureHeader: signature,
        secret: process.env.META_APP_SECRET!,
      }),
    ).toBe(true);

    const parsed = JSON.parse(rawBody);
    expect(parsed.object).toBe("instagram");
    expect(parsed.entry[0].id).toBe(IG_USER_ID);
    const delivery = parsed.entry[0].messaging[0].delivery;
    expect(delivery.mids).toEqual([providerMessageId]);
  });
});

describe("StubInstagramClient.getProfile", () => {
  it("returns a deterministic stub profile with username + name", async () => {
    const c = new StubInstagramClient({ channel: fakeChannel, credentials });
    expect(await c.getProfile({ igsid: IGSID_TARGET })).toEqual({
      username: "stub_user",
      name: "Stub Customer",
    });
  });
});
