/**
 * voxelforge kotoba — 3D design pipeline (text/image/CAD → mesh+voxel).
 *
 * Per ADR-2605080700 (LangGraph 3D pipeline) + ADR-2606011400 (Consensys
 * product-front / infra-back) + ADR-2605172400 (3-axis) + ADR-2605181100
 * (kotoba E2E encrypted-record envelope). Founder directive 2026-06-03:
 * PII / CUI / confidential migrate to etzhayyim when E2E-safe.
 *
 * SPLIT (derived from the 4 voxelforge lexicons, NOT assumptions):
 *
 *   PLAINTEXT AT records (public catalog / operational metadata, no subject
 *   content) — sdk.write / sdk.read:
 *     - artifact: content-addressed output catalog (b2 refs, sha256, byteSize,
 *       voxelDim, polygonCount, generator). Hashes + storage pointers, no IP.
 *       Mirrors listArtifacts/coverage. Frontable open metadata.
 *     - run: operational run status / timing / cost metadata (status, node,
 *       startedAt, finishedAt, costJpyMicro). No design content. Mirrors getRun.
 *
 *   E2E-ENCRYPTED (kotoba envelope, com.etzhayyim.encrypted.record) —
 *   sdk.encryptedWrite / sdk.encryptedRead, read-cap = owner DID (auto) +
 *   explicit recipients:
 *     - design: the caller's *authored* input — prompt / cadCode (proprietary
 *       CAD source up to 32k) / palette / params. This is user design IP and
 *       private content; the substrate never sees it in plaintext. Mirrors the
 *       generate input.
 *
 *   STAYS etzhayyim (consumed via consent-capability; NOT a collection) — the
 *   regulated EXECUTION acts: RunPod 6000-Ada GPU inference (TRELLIS / ComfyUI
 *   3D-Pack) + CadQuery sandbox exec (compute), and B2 artifact-byte custody /
 *   presigned-URL minting (storage custody). The resulting DATA records migrate
 *   (artifact/run plaintext, design E2E); only EXECUTION stays etzhayyim.
 *
 * AT-Lexicon: no float. byteSize/voxelDim/polygonCount/costJpyMicro/estimated
 * are integers; money kept as JPY-micro integer (already integer in lexicon).
 */

// ─── Plaintext collections ──────────────────────────────────────────
export const ARTIFACT_COLLECTION = "com.etzhayyim.apps.voxelforge.artifact";
export const RUN_COLLECTION = "com.etzhayyim.apps.voxelforge.run";
// ─── E2E inner-type (body shape inside the encrypted envelope) ───────
export const DESIGN_INNER_TYPE = "com.etzhayyim.apps.voxelforge.design";

export const VOXELFORGE_DID_PREFIX = "did:web:voxelforge.etzhayyim.com:" as const;

export type DesignKind = "text" | "image" | "cad";
export type TargetFormat = "glb" | "vox" | "both";
export type ArtifactFormat = "glb" | "vox" | "voxel_grid_json" | "manifest_json";
export type Generator = "trellis" | "comfy3d" | "cadquery";
export type RunStatus = "pending" | "running" | "completed" | "failed" | "interrupted";

// ─── Artifact (PLAINTEXT, public content-addressed catalog) ─────────

export interface ArtifactRecord {
  did: string;
  artifactId: string;
  designId: string;
  runId: string;
  format: ArtifactFormat;
  b2Bucket: string;
  b2Key: string;
  sha256Hex: string;
  byteSize: number;
  voxelDim?: number;
  polygonCount?: number;
  generatedBy: Generator;
  createdAt: string;
}
export interface ArtifactView extends ArtifactRecord {
  artifactUri: string;
}
export interface RegisterArtifactInput {
  artifactId: string;
  designId: string;
  runId: string;
  format: ArtifactFormat;
  b2Bucket: string;
  b2Key: string;
  sha256Hex: string;
  byteSize: number;
  voxelDim?: number;
  polygonCount?: number;
  generatedBy: Generator;
}
export interface RegisterArtifactOutput {
  status: "registered" | "alreadyExists" | "rejected";
  artifactUri?: string;
  did?: string;
  artifactId?: string;
  error?: string;
}
export interface ListArtifactsInput {
  designId?: string;
  format?: ArtifactFormat;
  generatedBy?: Generator;
  limit?: number;
  cursor?: string;
}
export interface ListArtifactsOutput {
  items: ArtifactView[];
  cursor?: string;
  total: number;
}
export interface GetArtifactInput {
  artifactId: string;
}
export interface GetArtifactOutput {
  artifact?: ArtifactView;
  error?: string;
}

// ─── Run (PLAINTEXT, operational status / timing / cost metadata) ───

export interface RunRecord {
  did: string;
  runId: string;
  designId: string;
  status: RunStatus;
  currentNode?: string;
  errorText?: string;
  startedAt: string;
  finishedAt?: string;
  /** JPY-micro integer (1 JPY = 1_000_000 micro). */
  costJpyMicro?: number;
  createdAt: string;
}
export interface RunView extends RunRecord {
  runUri: string;
}
export interface RecordRunInput {
  runId: string;
  designId: string;
  status: RunStatus;
  currentNode?: string;
  errorText?: string;
  startedAt?: string;
  finishedAt?: string;
  costJpyMicro?: number;
}
export interface RecordRunOutput {
  status: "recorded" | "updated" | "rejected";
  runUri?: string;
  did?: string;
  runId?: string;
  error?: string;
}
export interface GetRunInput {
  runId: string;
}
export interface GetRunOutput {
  run?: RunView;
  artifacts: ArtifactView[];
  error?: string;
}
export interface ListRunsInput {
  designId?: string;
  status?: RunStatus;
  limit?: number;
  cursor?: string;
}
export interface ListRunsOutput {
  items: RunView[];
  cursor?: string;
  total: number;
}

// ─── Design (E2E-ENCRYPTED — caller-authored input IP / private content) ─

export interface DesignBody {
  designId: string;
  kind: DesignKind;
  targetFormat: TargetFormat;
  prompt?: string;
  imageUrl?: string;
  cadCode?: string;
  palette?: string[];
  targetVoxelDim?: number;
  referenceArtifactId?: string;
  submittedAt: string;
}
export interface DesignView extends DesignBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface SubmitDesignInput {
  designId: string;
  kind: DesignKind;
  targetFormat: TargetFormat;
  prompt?: string;
  imageUrl?: string;
  cadCode?: string;
  palette?: string[];
  targetVoxelDim?: number;
  referenceArtifactId?: string;
  submittedAt?: string;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface SubmitDesignOutput {
  status: "submitted" | "rejected";
  uri?: string;
  keyId?: string;
  designId?: string;
  error?: string;
}
export interface GetDesignInput {
  designId: string;
}
export interface GetDesignOutput {
  design?: DesignView;
  error?: string;
}
export interface ListDesignsInput {
  kind?: DesignKind;
  limit?: number;
  cursor?: string;
}
export interface ListDesignsOutput {
  items: DesignView[];
  cursor?: string;
  total: number;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  designCount?: number;
  runCount?: number;
  artifactCount?: number;
  runsByStatus?: Record<string, number>;
  artifactsByFormat?: Record<string, number>;
  artifactsByGenerator?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

const ARTIFACT_FORMATS: readonly ArtifactFormat[] = ["glb", "vox", "voxel_grid_json", "manifest_json"];
const GENERATORS: readonly Generator[] = ["trellis", "comfy3d", "cadquery"];
const RUN_STATUSES: readonly RunStatus[] = ["pending", "running", "completed", "failed", "interrupted"];
const DESIGN_KINDS: readonly DesignKind[] = ["text", "image", "cad"];
const TARGET_FORMATS: readonly TargetFormat[] = ["glb", "vox", "both"];

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
export function isArtifactFormat(s: unknown): s is ArtifactFormat {
  return typeof s === "string" && (ARTIFACT_FORMATS as readonly string[]).includes(s);
}
export function isGenerator(s: unknown): s is Generator {
  return typeof s === "string" && (GENERATORS as readonly string[]).includes(s);
}
export function isRunStatus(s: unknown): s is RunStatus {
  return typeof s === "string" && (RUN_STATUSES as readonly string[]).includes(s);
}
export function isDesignKind(s: unknown): s is DesignKind {
  return typeof s === "string" && (DESIGN_KINDS as readonly string[]).includes(s);
}
export function isTargetFormat(s: unknown): s is TargetFormat {
  return typeof s === "string" && (TARGET_FORMATS as readonly string[]).includes(s);
}
export function isVoxelDim(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 8 && n <= 256;
}
export function artifactDidFor(id: string): string {
  return `${VOXELFORGE_DID_PREFIX}art:${id.toLowerCase()}`;
}
export function runDidFor(id: string): string {
  return `${VOXELFORGE_DID_PREFIX}run:${id.toLowerCase()}`;
}
export function artifactRkey(id: string): string {
  return `art-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
export function runRkey(id: string): string {
  return `run-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
export function designRkey(id: string): string {
  return `design-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
