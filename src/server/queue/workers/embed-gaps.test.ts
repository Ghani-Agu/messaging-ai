import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock all I/O so the test exercises just the cluster decision tree.
vi.mock("@/server/queue/queues", () => ({
  EMBED_QUEUE_NAME: "embed",
}));
vi.mock("@/server/queue/connection", () => ({
  createRedisConnection: () => ({}),
}));
vi.mock("bullmq", () => ({
  Worker: class {
    constructor() {}
    on() {}
  },
  UnrecoverableError: class extends Error {},
}));

vi.mock("@/server/ai/embeddings", () => ({
  embed: vi.fn(async () => ({
    vectors: [[0.1, 0.2, 0.3]],
    provider: "voyage" as const,
  })),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    knowledgeItem: { findUnique: vi.fn() },
    qnaPair: { findUnique: vi.fn() },
  },
}));

vi.mock("@/server/db/knowledge-gaps", () => ({
  attachGapEmbedding: vi.fn(),
  countClusterCandidates: vi.fn(),
  findBestClusterCandidate: vi.fn(),
  getGapForEmbedding: vi.fn(),
  setKnowledgeGapClusterKey: vi.fn(),
}));

// Stub these too — the worker imports them but the tests don't exercise
// the chunks / items / qna code paths.
vi.mock("@/server/db/knowledge", () => ({
  appendSourceLog: vi.fn(),
  attachEmbeddings: vi.fn(),
  incrementSourceProgressEmbedded: vi.fn(),
  listUnembeddedChunksByIds: vi.fn(),
  maybeMarkSourceReady: vi.fn(),
  updateSourceStatus: vi.fn(),
}));
vi.mock("@/server/db/items", () => ({
  attachItemEmbedding: vi.fn(),
  buildItemEmbedText: vi.fn(),
}));
vi.mock("@/server/db/qna", () => ({
  attachQnaEmbedding: vi.fn(),
}));

import { embed } from "@/server/ai/embeddings";
import { prisma } from "@/server/db/client";
import {
  attachGapEmbedding,
  countClusterCandidates,
  findBestClusterCandidate,
  getGapForEmbedding,
  setKnowledgeGapClusterKey,
} from "@/server/db/knowledge-gaps";
import { GAP_CLUSTER_CANDIDATE_CAP } from "@/server/knowledge/limits";

// Now load the worker module — its handler is exported indirectly
// through the BullMQ Worker constructor's processor function. We
// extract the handler by importing the file and re-creating a Job-like
// stub that calls the matching arm directly.
//
// Because the file's switch dispatches on job.name, we can invoke the
// `embed-gaps-batch` arm by constructing a minimal Job with that name
// and the data we want. The Worker constructor only sets up listeners —
// the processor is the second argument. To extract it, we monkey-patch
// the Worker mock above to capture it.
let processor: ((job: unknown) => Promise<unknown>) | null = null;

vi.mock("bullmq", () => ({
  Worker: class {
    constructor(_name: string, p: (job: unknown) => Promise<unknown>) {
      processor = p;
    }
    on() {}
  },
  UnrecoverableError: class extends Error {},
}));

import { startEmbedWorker } from "./embed";

beforeEach(() => {
  vi.clearAllMocks();
  processor = null;
  startEmbedWorker(); // captures `processor`
});

afterEach(() => {
  vi.clearAllMocks();
});

async function runHandler(gapIds: string[]) {
  if (!processor) throw new Error("processor not captured");
  return processor({
    name: "embed-gaps-batch",
    data: { tenantId: "t1", gapIds },
    opts: { attempts: 1 },
    attemptsMade: 0,
  });
}

// Stable embedding stub — every embed call returns the same vector so
// candidate similarity is governed entirely by what findBestClusterCandidate
// returns (we control that via its mock).
const STUB_VECTOR = [0.1, 0.2, 0.3];

beforeEach(() => {
  vi.mocked(embed).mockResolvedValue({
    vectors: [STUB_VECTOR],
    provider: "voyage" as const,
  });
  // Default $queryRaw stub: returns the gap's stored embedding text when
  // runClusterStep re-reads the vector.
  vi.mocked(prisma.$queryRaw).mockResolvedValue([
    { vec: `[${STUB_VECTOR.join(",")}]` },
  ]);
});

describe("handleEmbedGapsBatch — cluster decision tree", () => {
  it("no candidate clears threshold → mints sole-member cluster", async () => {
    vi.mocked(getGapForEmbedding).mockResolvedValue({
      id: "g1",
      tenantId: "t1",
      question: "Q?",
      hasEmbedding: false,
    });
    vi.mocked(countClusterCandidates).mockResolvedValue(0);
    vi.mocked(findBestClusterCandidate).mockResolvedValue(null);

    const r = (await runHandler(["g1"])) as {
      embedded: number;
      clustered: number;
      skipped: number;
    };
    expect(r.embedded).toBe(1);
    expect(r.clustered).toBe(1);
    expect(r.skipped).toBe(0);

    // Sole-member cluster minted on the new gap only.
    const calls = vi.mocked(setKnowledgeGapClusterKey).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]!.gapId).toBe("g1");
    expect(calls[0]![0]!.clusterKey).toBeTruthy();
  });

  it("best candidate has clusterKey → joins existing cluster", async () => {
    vi.mocked(getGapForEmbedding).mockResolvedValue({
      id: "g1",
      tenantId: "t1",
      question: "Q?",
      hasEmbedding: false,
    });
    vi.mocked(countClusterCandidates).mockResolvedValue(5);
    vi.mocked(findBestClusterCandidate).mockResolvedValue({
      gapId: "g0-existing",
      clusterKey: "EXISTING-CLUSTER-KEY",
      score: 0.91,
    });

    const r = (await runHandler(["g1"])) as { clustered: number };
    expect(r.clustered).toBe(1);

    const calls = vi.mocked(setKnowledgeGapClusterKey).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toEqual({
      gapId: "g1",
      clusterKey: "EXISTING-CLUSTER-KEY",
    });
  });

  it("best candidate has null clusterKey → seeds new cluster from BOTH gaps", async () => {
    vi.mocked(getGapForEmbedding).mockResolvedValue({
      id: "g1",
      tenantId: "t1",
      question: "Q?",
      hasEmbedding: false,
    });
    vi.mocked(countClusterCandidates).mockResolvedValue(2);
    vi.mocked(findBestClusterCandidate).mockResolvedValue({
      gapId: "g0-orphan",
      clusterKey: null,
      score: 0.88,
    });

    await runHandler(["g1"]);

    // Both g1 and g0-orphan get the same fresh clusterKey.
    const calls = vi.mocked(setKnowledgeGapClusterKey).mock.calls;
    expect(calls).toHaveLength(2);
    const keyForG1 = calls.find((c) => c[0]!.gapId === "g1")![0]!.clusterKey;
    const keyForG0 = calls.find((c) => c[0]!.gapId === "g0-orphan")![0]!.clusterKey;
    expect(keyForG1).toBeTruthy();
    expect(keyForG1).toBe(keyForG0);
  });

  it("candidate count over cap → skip clustering, log warning, leave clusterKey null", async () => {
    vi.mocked(getGapForEmbedding).mockResolvedValue({
      id: "g1",
      tenantId: "t1",
      question: "Q?",
      hasEmbedding: false,
    });
    vi.mocked(countClusterCandidates).mockResolvedValue(GAP_CLUSTER_CANDIDATE_CAP + 1);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = (await runHandler(["g1"])) as {
      embedded: number;
      clustered: number;
      skipped: number;
    };
    expect(r.embedded).toBe(1);
    expect(r.clustered).toBe(0);
    expect(r.skipped).toBe(1);

    // findBestClusterCandidate must NOT have been called — we short-
    // circuit before the candidate scan.
    expect(vi.mocked(findBestClusterCandidate)).not.toHaveBeenCalled();
    // setKnowledgeGapClusterKey must NOT have been called — clusterKey
    // stays null.
    expect(vi.mocked(setKnowledgeGapClusterKey)).not.toHaveBeenCalled();
    // Warning should mention skipping.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("skipping clustering"),
    );
    warnSpy.mockRestore();
  });

  it("idempotency: already-embedded gap re-runs cluster step only", async () => {
    vi.mocked(getGapForEmbedding).mockResolvedValue({
      id: "g1",
      tenantId: "t1",
      question: "Q?",
      hasEmbedding: true, // already embedded
    });
    vi.mocked(countClusterCandidates).mockResolvedValue(0);
    vi.mocked(findBestClusterCandidate).mockResolvedValue(null);

    const r = (await runHandler(["g1"])) as {
      embedded: number;
      clustered: number;
    };

    // Embed wasn't re-called.
    expect(vi.mocked(embed)).not.toHaveBeenCalled();
    expect(vi.mocked(attachGapEmbedding)).not.toHaveBeenCalled();
    // Cluster step still ran.
    expect(r.embedded).toBe(0);
    expect(r.clustered).toBe(1);
    expect(vi.mocked(setKnowledgeGapClusterKey)).toHaveBeenCalledTimes(1);
  });

  it("tenant mismatch is skipped silently", async () => {
    vi.mocked(getGapForEmbedding).mockResolvedValue({
      id: "g1",
      tenantId: "wrong-tenant",
      question: "Q?",
      hasEmbedding: false,
    });

    const r = (await runHandler(["g1"])) as { embedded: number };
    expect(r.embedded).toBe(0);
    expect(vi.mocked(embed)).not.toHaveBeenCalled();
  });
});
