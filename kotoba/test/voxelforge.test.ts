import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  registerArtifact,
  listArtifacts,
  getArtifact,
  recordRun,
  listRuns,
  getRun,
  submitDesign,
  listDesigns,
  getDesign,
  coverage,
} from "../src/index.js";

const OWNER = "did:web:voxelforge.etzhayyim.com";

function seedRun(e: any, runId: string, designId: string, status = "running") {
  return recordRun(e, { runId, designId, status: status as any, startedAt: "2026-06-03T00:00:00.000Z" });
}

describe("voxelforge kotoba (kotoba-E2E split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("run (PLAINTEXT operational metadata)", () => {
    it("records, updates, validates, lists/filters", async () => {
      expect((await seedRun(e, "r1", "d1", "pending")).status).toBe("recorded");
      // update same run → status updated, createdAt preserved
      expect((await recordRun(e, { runId: "r1", designId: "d1", status: "completed", finishedAt: "2026-06-03T00:01:00.000Z", costJpyMicro: 90000000 })).status).toBe("updated");
      expect((await recordRun(e, { runId: "rX", designId: "d", status: "bogus" as any })).status).toBe("rejected");
      expect((await recordRun(e, { runId: "rY", designId: "d", status: "running", costJpyMicro: -5 })).status).toBe("rejected");
      await seedRun(e, "r2", "d2", "failed");
      expect((await listRuns(e)).total).toBe(2);
      expect((await listRuns(e, { status: "failed" })).total).toBe(1);
      expect((await listRuns(e, { designId: "d1" })).total).toBe(1);
    });
  });

  describe("artifact (PLAINTEXT content-addressed catalog)", () => {
    it("registers under an existing run (FK), dedups, validates, lists/filters", async () => {
      await seedRun(e, "r1", "d1");
      // FK: cannot register against unknown run
      expect((await registerArtifact(e, { artifactId: "a0", designId: "d1", runId: "ghost", format: "glb", b2Bucket: "b", b2Key: "k", sha256Hex: "h", byteSize: 10, generatedBy: "trellis" })).status).toBe("rejected");

      const ok = await registerArtifact(e, { artifactId: "a1", designId: "d1", runId: "r1", format: "glb", b2Bucket: "etzhayyim-nats", b2Key: "voxelforge/v1/d1/model.glb", sha256Hex: "abc", byteSize: 2048, polygonCount: 1200, generatedBy: "trellis" });
      expect(ok.status).toBe("registered");
      expect(ok.artifactUri).toBeTruthy();
      // dedup
      expect((await registerArtifact(e, { artifactId: "a1", designId: "d1", runId: "r1", format: "glb", b2Bucket: "b", b2Key: "k", sha256Hex: "abc", byteSize: 2048, generatedBy: "trellis" })).status).toBe("alreadyExists");
      // validation: bad format / negative byteSize
      expect((await registerArtifact(e, { artifactId: "aX", designId: "d1", runId: "r1", format: "stl" as any, b2Bucket: "b", b2Key: "k", sha256Hex: "h", byteSize: 1, generatedBy: "trellis" })).status).toBe("rejected");
      expect((await registerArtifact(e, { artifactId: "aY", designId: "d1", runId: "r1", format: "vox", b2Bucket: "b", b2Key: "k", sha256Hex: "h", byteSize: -1, generatedBy: "cadquery" })).status).toBe("rejected");

      await registerArtifact(e, { artifactId: "a2", designId: "d1", runId: "r1", format: "vox", b2Bucket: "etzhayyim-nats", b2Key: "voxelforge/v1/d1/model.vox", sha256Hex: "def", byteSize: 4096, voxelDim: 64, generatedBy: "cadquery" });
      expect((await listArtifacts(e)).total).toBe(2);
      expect((await listArtifacts(e, { format: "vox" })).total).toBe(1);
      expect((await listArtifacts(e, { generatedBy: "trellis" })).total).toBe(1);
      expect((await listArtifacts(e, { designId: "d1" })).total).toBe(2);

      const got = await getArtifact(e, { artifactId: "a1" });
      expect(got.artifact?.sha256Hex).toBe("abc");
      expect(got.artifact?.polygonCount).toBe(1200);
      expect((await getArtifact(e, { artifactId: "nope" })).error).toBe("notFound");
    });

    it("getRun joins run + its artifacts", async () => {
      await seedRun(e, "r1", "d1", "completed");
      await registerArtifact(e, { artifactId: "a1", designId: "d1", runId: "r1", format: "glb", b2Bucket: "b", b2Key: "k1", sha256Hex: "h1", byteSize: 10, generatedBy: "trellis" });
      await registerArtifact(e, { artifactId: "a2", designId: "d1", runId: "r1", format: "manifest_json", b2Bucket: "b", b2Key: "k2", sha256Hex: "h2", byteSize: 20, generatedBy: "trellis" });
      const run = await getRun(e, { runId: "r1" });
      expect(run.run?.status).toBe("completed");
      expect(run.artifacts.length).toBe(2);
      expect((await getRun(e, { runId: "ghost" })).error).toBe("notFound");
    });
  });

  describe("design (E2E-ENCRYPTED caller-authored input IP)", () => {
    it("seals via encryptedWrite, round-trips via encryptedRead, validates kind-content", async () => {
      const ok = await submitDesign(e, { designId: "d1", kind: "cad", targetFormat: "both", cadCode: "import cadquery as cq\nresult = cq.Workplane('XY').box(10,10,5)", targetVoxelDim: 32 });
      expect(ok.status).toBe("submitted");
      expect(ok.keyId).toBeTruthy();
      // kind-conditioned content required
      expect((await submitDesign(e, { designId: "dX", kind: "text", targetFormat: "glb" })).status).toBe("rejected"); // no prompt
      expect((await submitDesign(e, { designId: "dY", kind: "image", targetFormat: "vox" })).status).toBe("rejected"); // no imageUrl
      expect((await submitDesign(e, { designId: "dZ", kind: "text", targetFormat: "glb", prompt: "p", targetVoxelDim: 4 })).status).toBe("rejected"); // voxelDim<8

      const got = await getDesign(e, { designId: "d1" });
      expect(got.design?.cadCode).toContain("cadquery");
      expect(got.design?.kind).toBe("cad");
      await submitDesign(e, { designId: "d2", kind: "text", targetFormat: "glb", prompt: "small wooden cabin" });
      expect((await listDesigns(e)).total).toBe(2);
      expect((await listDesigns(e, { kind: "cad" })).total).toBe(1);
    });

    it("enforces read-cap: a non-recipient DID cannot decrypt the design", async () => {
      await submitDesign(e, { designId: "d1", kind: "text", targetFormat: "glb", prompt: "private proprietary prompt" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listDesigns(outsider)).total).toBe(0);
      expect((await getDesign(outsider, { designId: "d1" })).error).toBe("notFound");
    });

    it("grants read-cap to an explicit recipient", async () => {
      const partner = "did:web:partner.example";
      const r = await submitDesign(e, { designId: "d1", kind: "cad", targetFormat: "vox", cadCode: "result = None", recipients: [partner] });
      expect(r.status).toBe("submitted");
      expect((await listDesigns(e)).total).toBe(1);
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext runs + artifacts + E2E designs with breakdowns", async () => {
      await seedRun(e, "r1", "d1", "completed");
      await seedRun(e, "r2", "d2", "failed");
      await registerArtifact(e, { artifactId: "a1", designId: "d1", runId: "r1", format: "glb", b2Bucket: "b", b2Key: "k1", sha256Hex: "h1", byteSize: 10, generatedBy: "trellis" });
      await registerArtifact(e, { artifactId: "a2", designId: "d1", runId: "r1", format: "vox", b2Bucket: "b", b2Key: "k2", sha256Hex: "h2", byteSize: 20, generatedBy: "trellis" });
      await submitDesign(e, { designId: "d1", kind: "cad", targetFormat: "both", cadCode: "result=None" });
      const cov = await coverage(e);
      expect(cov.runCount).toBe(2);
      expect(cov.artifactCount).toBe(2);
      expect(cov.designCount).toBe(1);
      expect(cov.runsByStatus?.completed).toBe(1);
      expect(cov.runsByStatus?.failed).toBe(1);
      expect(cov.artifactsByFormat?.glb).toBe(1);
      expect(cov.artifactsByGenerator?.trellis).toBe(2);
      expect(cov.truncated).toBe(false);
    });
  });
});
