/**
 * voxelforge kotoba — registry.
 *
 * Plaintext path (artifact / run): sdk.write / sdk.read — public content-
 * addressed catalog + operational run metadata. FK via exists() (artifact →
 * run lookup; getRun joins artifacts by runId). Coverage = countAll rollup.
 *
 * E2E path (design): sdk.encryptedWrite / sdk.encryptedRead — caller-authored
 * input IP (prompt / cadCode / palette / params) sealed in the kotoba envelope
 * (ADR-2605181100), read-cap = owner DID (+ explicit recipients). The substrate
 * never sees the design content in plaintext.
 *
 * STAYS etzhayyim (consent-capability): RunPod GPU inference + CadQuery exec + B2
 * byte custody / presign. Only the EXECUTION acts; the data records live here.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  ARTIFACT_COLLECTION,
  RUN_COLLECTION,
  DESIGN_INNER_TYPE,
  artifactDidFor,
  runDidFor,
  artifactRkey,
  runRkey,
  designRkey,
  isUint,
  isVoxelDim,
  isArtifactFormat,
  isGenerator,
  isRunStatus,
  isDesignKind,
  isTargetFormat,
  type ArtifactRecord,
  type ArtifactView,
  type CoverageInput,
  type CoverageOutput,
  type DesignBody,
  type DesignView,
  type GetArtifactInput,
  type GetArtifactOutput,
  type GetDesignInput,
  type GetDesignOutput,
  type GetRunInput,
  type GetRunOutput,
  type ListArtifactsInput,
  type ListArtifactsOutput,
  type ListDesignsInput,
  type ListDesignsOutput,
  type ListRunsInput,
  type ListRunsOutput,
  type RecordRunInput,
  type RecordRunOutput,
  type RegisterArtifactInput,
  type RegisterArtifactOutput,
  type RunRecord,
  type RunView,
  type SubmitDesignInput,
  type SubmitDesignOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── FK helper (exists) ─────────────────────────────────────────────

async function exists(e: Etzhayyim, collection: string, rkey: string): Promise<boolean> {
  const resp = await e.read({ collection, rkey }).catch(() => ({ records: [] as Array<{ value: unknown }> }));
  return !!resp.records[0];
}

// ─── Artifact (PLAINTEXT) ───────────────────────────────────────────

export async function registerArtifact(e: Etzhayyim, input: RegisterArtifactInput): Promise<RegisterArtifactOutput> {
  if (!input.artifactId || !input.designId || !input.runId) return { status: "rejected", error: "missingRequiredFields" };
  if (!input.b2Bucket || !input.b2Key || !input.sha256Hex) return { status: "rejected", error: "missingStorageRef" };
  if (!isArtifactFormat(input.format)) return { status: "rejected", error: "invalidFormat" };
  if (!isGenerator(input.generatedBy)) return { status: "rejected", error: "invalidGenerator" };
  if (!isUint(input.byteSize)) return { status: "rejected", error: "invalidByteSize" };
  if (input.voxelDim !== undefined && !isUint(input.voxelDim)) return { status: "rejected", error: "invalidVoxelDim" };
  if (input.polygonCount !== undefined && !isUint(input.polygonCount)) return { status: "rejected", error: "invalidPolygonCount" };
  // FK: artifact must reference an existing run.
  if (!(await exists(e, RUN_COLLECTION, runRkey(input.runId)))) return { status: "rejected", error: "unknownRun" };

  const rkey = artifactRkey(input.artifactId);
  const prior = await e.read<ArtifactRecord>({ collection: ARTIFACT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (prior.records[0]?.value) {
    return { status: "alreadyExists", artifactUri: prior.records[0].uri, did: prior.records[0].value.did, artifactId: input.artifactId };
  }
  const now = new Date().toISOString();
  const did = artifactDidFor(input.artifactId);
  const record: ArtifactRecord = {
    did,
    artifactId: input.artifactId,
    designId: input.designId,
    runId: input.runId,
    format: input.format,
    b2Bucket: input.b2Bucket,
    b2Key: input.b2Key,
    sha256Hex: input.sha256Hex,
    byteSize: input.byteSize,
    voxelDim: input.voxelDim,
    polygonCount: input.polygonCount,
    generatedBy: input.generatedBy,
    createdAt: now,
  };
  const receipt = await e.write({ collection: ARTIFACT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "registered", artifactUri: receipt.uri, did, artifactId: input.artifactId };
}

export async function listArtifacts(e: Etzhayyim, input: ListArtifactsInput = {}): Promise<ListArtifactsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<ArtifactRecord>({ collection: ARTIFACT_COLLECTION, cursor: input.cursor, limit });
  const items: ArtifactView[] = resp.records
    .filter((r) => !input.designId || r.value.designId === input.designId)
    .filter((r) => !input.format || r.value.format === input.format)
    .filter((r) => !input.generatedBy || r.value.generatedBy === input.generatedBy)
    .map((r) => ({ ...r.value, artifactUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

export async function getArtifact(e: Etzhayyim, input: GetArtifactInput): Promise<GetArtifactOutput> {
  if (!input.artifactId) return { error: "invalidArtifactId" };
  const resp = await e.read<ArtifactRecord>({ collection: ARTIFACT_COLLECTION, rkey: artifactRkey(input.artifactId) }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r?.value) return { error: "notFound" };
  return { artifact: { ...r.value, artifactUri: r.uri } };
}

// ─── Run (PLAINTEXT operational metadata) ───────────────────────────

export async function recordRun(e: Etzhayyim, input: RecordRunInput): Promise<RecordRunOutput> {
  if (!input.runId || !input.designId) return { status: "rejected", error: "missingRequiredFields" };
  if (!isRunStatus(input.status)) return { status: "rejected", error: "invalidStatus" };
  if (input.costJpyMicro !== undefined && !isUint(input.costJpyMicro)) return { status: "rejected", error: "invalidCost" };

  const rkey = runRkey(input.runId);
  const prior = await e.read<RunRecord>({ collection: RUN_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const now = new Date().toISOString();
  const did = runDidFor(input.runId);
  const isUpdate = !!prior.records[0]?.value;
  const record: RunRecord = {
    did,
    runId: input.runId,
    designId: input.designId,
    status: input.status,
    currentNode: input.currentNode,
    errorText: input.errorText,
    startedAt: input.startedAt ?? prior.records[0]?.value.startedAt ?? now,
    finishedAt: input.finishedAt,
    costJpyMicro: input.costJpyMicro,
    createdAt: prior.records[0]?.value.createdAt ?? now,
  };
  const receipt = await e.write({ collection: RUN_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: isUpdate ? "updated" : "recorded", runUri: receipt.uri, did, runId: input.runId };
}

export async function listRuns(e: Etzhayyim, input: ListRunsInput = {}): Promise<ListRunsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<RunRecord>({ collection: RUN_COLLECTION, cursor: input.cursor, limit });
  const items: RunView[] = resp.records
    .filter((r) => !input.designId || r.value.designId === input.designId)
    .filter((r) => !input.status || r.value.status === input.status)
    .map((r) => ({ ...r.value, runUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

/** Mirrors the getRun lexicon: run status + its materialized artifacts. */
export async function getRun(e: Etzhayyim, input: GetRunInput): Promise<GetRunOutput> {
  if (!input.runId) return { artifacts: [], error: "invalidRunId" };
  const resp = await e.read<RunRecord>({ collection: RUN_COLLECTION, rkey: runRkey(input.runId) }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r?.value) return { artifacts: [], error: "notFound" };
  // Join artifacts by runId (scan, plaintext public catalog).
  const artifacts: ArtifactView[] = [];
  let cursor: string | undefined;
  while (artifacts.length < DEFAULT_MAX_SCAN) {
    const page = await e.read<ArtifactRecord>({ collection: ARTIFACT_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const a of page.records) {
      if (a.value.runId === input.runId) artifacts.push({ ...a.value, artifactUri: a.uri });
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return { run: { ...r.value, runUri: r.uri }, artifacts };
}

// ─── Design (E2E-ENCRYPTED — caller-authored input IP) ──────────────

export async function submitDesign(e: Etzhayyim, input: SubmitDesignInput): Promise<SubmitDesignOutput> {
  if (!input.designId) return { status: "rejected", error: "missingDesignId" };
  if (!isDesignKind(input.kind)) return { status: "rejected", error: "invalidKind" };
  if (!isTargetFormat(input.targetFormat)) return { status: "rejected", error: "invalidTargetFormat" };
  // kind-conditioned required content (mirrors generate lexicon semantics).
  if (input.kind === "text" && !input.prompt) return { status: "rejected", error: "promptRequired" };
  if (input.kind === "image" && !input.imageUrl) return { status: "rejected", error: "imageUrlRequired" };
  if (input.kind === "cad" && !input.cadCode) return { status: "rejected", error: "cadCodeRequired" };
  if (input.targetVoxelDim !== undefined && !isVoxelDim(input.targetVoxelDim)) return { status: "rejected", error: "invalidTargetVoxelDim" };
  if (input.palette !== undefined && (!Array.isArray(input.palette) || input.palette.length > 256)) return { status: "rejected", error: "invalidPalette" };

  const body: DesignBody = {
    designId: input.designId,
    kind: input.kind,
    targetFormat: input.targetFormat,
    prompt: input.prompt,
    imageUrl: input.imageUrl,
    cadCode: input.cadCode,
    palette: input.palette,
    targetVoxelDim: input.targetVoxelDim,
    referenceArtifactId: input.referenceArtifactId,
    submittedAt: input.submittedAt ?? new Date().toISOString(),
  };
  // Read-cap = owner DID (sender, auto-wrapped) + any explicit recipients.
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: DESIGN_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: designRkey(input.designId),
  });
  return { status: "submitted", uri: receipt.uri, keyId: receipt.keyId, designId: input.designId };
}

async function scanDesigns(e: Etzhayyim, maxScan: number): Promise<DesignView[]> {
  const out: DesignView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<DesignBody>({ innerType: DESIGN_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    }
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listDesigns(e: Etzhayyim, input: ListDesignsInput = {}): Promise<ListDesignsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanDesigns(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((d) => !input.kind || d.kind === input.kind);
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getDesign(e: Etzhayyim, input: GetDesignInput): Promise<GetDesignOutput> {
  if (!input.designId) return { error: "invalidDesignId" };
  const all = await scanDesigns(e, DEFAULT_MAX_SCAN);
  const found = all.find((d) => d.designId === input.designId);
  if (!found) return { error: "notFound" };
  return { design: found };
}

// ─── Coverage rollup (countAll) ─────────────────────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);

  const artifactsByFormat: Record<string, number> = {};
  const artifactsByGenerator: Record<string, number> = {};
  let artifactCount = 0;
  let artifactCursor: string | undefined;
  while (artifactCount < maxScan) {
    const page = await e.read<ArtifactRecord>({ collection: ARTIFACT_COLLECTION, cursor: artifactCursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      artifactsByFormat[r.value.format] = (artifactsByFormat[r.value.format] ?? 0) + 1;
      artifactsByGenerator[r.value.generatedBy] = (artifactsByGenerator[r.value.generatedBy] ?? 0) + 1;
      artifactCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    artifactCursor = page.cursor;
  }

  const runsByStatus: Record<string, number> = {};
  let runCount = 0;
  let runCursor: string | undefined;
  while (runCount < maxScan) {
    const page = await e.read<RunRecord>({ collection: RUN_COLLECTION, cursor: runCursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      runsByStatus[r.value.status] = (runsByStatus[r.value.status] ?? 0) + 1;
      runCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    runCursor = page.cursor;
  }

  const designCount = (await scanDesigns(e, maxScan)).length;

  return {
    designCount,
    runCount,
    artifactCount,
    runsByStatus,
    artifactsByFormat,
    artifactsByGenerator,
    truncated: artifactCount >= maxScan || runCount >= maxScan || designCount >= maxScan,
  };
}
