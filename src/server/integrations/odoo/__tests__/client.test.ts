import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock xmlrpc BEFORE importing the client ────────────────────────────────
// vi.hoisted() makes the module-scope variables available to vi.mock's
// factory (which runs before any of the module imports below execute).
//
// methodCallMock is the function the test suite assigns per-case behavior
// to. The factory wires it up so every xmlrpc client instance the production
// code creates funnels through the same mock — works around xmlrpc's pattern
// of "new client per call."

const { methodCallMock, createSecureClientMock } = vi.hoisted(() => {
  // `vi.fn<T extends Procedure>()` takes a single function-type parameter
  // in vitest 2.x. Type is inlined because vi.hoisted runs in its own
  // scope and outer declarations aren't visible here.
  type MethodCallFn = (
    method: string,
    params: unknown[],
    cb: (err: unknown, value: unknown) => void,
  ) => void;
  const methodCallMock = vi.fn<MethodCallFn>();
  const createSecureClientMock = vi.fn(() => ({
    methodCall: methodCallMock,
  }));
  return { methodCallMock, createSecureClientMock };
});

vi.mock("xmlrpc", () => ({
  default: {
    createSecureClient: createSecureClientMock,
  },
}));

// Now safe to import — the mock above is in place.
const { OdooClient } = await import("../client");
const { withRetry } = await import("../client");

const BASE_CONFIG = {
  url: "https://example.test",
  database: "demo",
  username: "user@example.test",
  password: "secret-do-not-leak-12345",
};

describe("OdooClient", () => {
  beforeEach(() => {
    methodCallMock.mockReset();
    createSecureClientMock.mockClear();
  });

  describe("authenticate()", () => {
    it("returns the uid on success", async () => {
      methodCallMock.mockImplementation((_method, _params, cb) => {
        cb(null, 7);
      });
      const client = new OdooClient(BASE_CONFIG);
      const uid = await client.authenticate();
      expect(uid).toBe(7);
    });

    it("rejects when uid is false (Odoo's 'wrong password' signal)", async () => {
      methodCallMock.mockImplementation((_method, _params, cb) => {
        cb(null, false);
      });
      const client = new OdooClient(BASE_CONFIG);
      await expect(client.authenticate()).rejects.toThrow(
        /authentication failed/i,
      );
    });

    it("rejects when uid is 0", async () => {
      methodCallMock.mockImplementation((_method, _params, cb) => {
        cb(null, 0);
      });
      const client = new OdooClient(BASE_CONFIG);
      await expect(client.authenticate()).rejects.toThrow(
        /authentication failed/i,
      );
    });
  });

  describe("executeKw()", () => {
    it("passes the correct positional args (db, uid, password, model, method, args, kwargs)", async () => {
      // First call: authenticate. Second call: executeKw on product.template.
      const calls: Array<{ method: string; params: unknown[] }> = [];
      methodCallMock.mockImplementation((method, params, cb) => {
        calls.push({ method, params });
        if (method === "authenticate") cb(null, 42);
        else cb(null, [{ id: 1 }]);
      });
      const client = new OdooClient(BASE_CONFIG);
      const result = await client.executeKw<unknown[]>(
        "product.template",
        "search_read",
        [[["sale_ok", "=", true]]],
        { fields: ["id", "name"], limit: 5, offset: 0 },
      );
      expect(result).toEqual([{ id: 1 }]);

      // Two underlying methodCall invocations:
      //  - 'authenticate' → [db, user, password, {}]
      //  - 'execute_kw'   → [db, uid, password, model, method, args, kwargs]
      expect(calls).toHaveLength(2);
      expect(calls[0]?.method).toBe("authenticate");
      expect(calls[1]?.method).toBe("execute_kw");
      expect(calls[1]?.params).toEqual([
        "demo",
        42,
        "secret-do-not-leak-12345",
        "product.template",
        "search_read",
        [[["sale_ok", "=", true]]],
        { fields: ["id", "name"], limit: 5, offset: 0 },
      ]);
    });

    it("reuses cached uid across repeated calls", async () => {
      let authCount = 0;
      methodCallMock.mockImplementation((method, _params, cb) => {
        if (method === "authenticate") {
          authCount++;
          cb(null, 99);
        } else {
          cb(null, []);
        }
      });
      const client = new OdooClient(BASE_CONFIG);
      await client.executeKw("product.template", "search_read", [[]]);
      await client.executeKw("product.template", "search_read", [[]]);
      await client.executeKw("product.template", "search_read", [[]]);
      expect(authCount).toBe(1);
    });
  });

  describe("withRetry()", () => {
    it("succeeds on first attempt without retrying", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      const result = await withRetry(fn);
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries once on a generic network error", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce("ok");
      const result = await withRetry(fn);
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry on auth errors (AccessDenied)", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("AccessDenied: bad pw"));
      await expect(withRetry(fn)).rejects.toThrow(/AccessDenied/);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry on auth errors ('invalid credentials')", async () => {
      const fn = vi
        .fn()
        .mockRejectedValue(new Error("XML-RPC fault: invalid credentials"));
      await expect(withRetry(fn)).rejects.toThrow(/invalid credentials/);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("surfaces the last error after exhausting retries on transient errors", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));
      await expect(withRetry(fn)).rejects.toThrow(/ETIMEDOUT/);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("password redaction", () => {
    it("does not appear in any error message thrown by the client", async () => {
      // Force an upstream fault. The error message should not contain
      // the password under any code path.
      methodCallMock.mockImplementation((_method, _params, cb) => {
        cb(new Error("upstream gateway error 502"), null);
      });
      const client = new OdooClient(BASE_CONFIG);
      let caughtError: Error | undefined;
      try {
        await client.authenticate();
      } catch (e) {
        caughtError = e as Error;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError?.message ?? "").not.toContain(BASE_CONFIG.password);
    });

    it("does not appear in the AccessDenied auth-failure path", async () => {
      methodCallMock.mockImplementation((_method, _params, cb) => {
        cb(new Error("AccessDenied"), null);
      });
      const client = new OdooClient(BASE_CONFIG);
      let caughtError: Error | undefined;
      try {
        await client.authenticate();
      } catch (e) {
        caughtError = e as Error;
      }
      expect(caughtError?.message ?? "").not.toContain(BASE_CONFIG.password);
    });

    it("does not appear in the 'uid is false' synthetic error", async () => {
      methodCallMock.mockImplementation((_method, _params, cb) => {
        cb(null, false);
      });
      const client = new OdooClient(BASE_CONFIG);
      let caughtError: Error | undefined;
      try {
        await client.authenticate();
      } catch (e) {
        caughtError = e as Error;
      }
      expect(caughtError?.message ?? "").not.toContain(BASE_CONFIG.password);
    });
  });
});

describe("timeout", () => {
  // Suppress the transient "PromiseRejectionHandled" warning that vitest's
  // fake-timer interaction produces during the retry loop: the first
  // timeout's rejection is settled inside the retry's catch a microtask
  // later, so it briefly appears "unhandled" between the timer firing
  // and withRetry observing it. Behavior is correct; the warning is just
  // bookkeeping noise specific to fake timers + async retry.
  let suppressed: ((reason: unknown, p: Promise<unknown>) => void) | null = null;

  beforeEach(() => {
    methodCallMock.mockReset();
    createSecureClientMock.mockClear();
    vi.useFakeTimers();
    suppressed = () => {};
    process.on("unhandledRejection", suppressed);
  });

  afterEach(() => {
    if (suppressed) process.off("unhandledRejection", suppressed);
    suppressed = null;
    vi.useRealTimers();
  });

  it("rejects after the configured timeout when xmlrpc never calls the callback", async () => {
    methodCallMock.mockImplementation((_method, _params, _cb) => {
      // Intentionally never call cb — simulates a hung XML-RPC call.
    });
    const client = new OdooClient(BASE_CONFIG);
    const promise = client.authenticate();
    // Pre-attach the assertion so the eventual rejection is observed in
    // the same chain and won't show up as "unhandled" once withRetry
    // exhausts its retries.
    const assertion = expect(promise).rejects.toThrow(/timed out/);
    // Advance through both retry attempts: each fires a 30s timeout,
    // separated by the 1s retry delay.
    await vi.advanceTimersByTimeAsync(31_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
  });
});
