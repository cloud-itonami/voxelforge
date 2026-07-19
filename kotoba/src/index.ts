/**
 * voxelforge kotoba — barrel. 3D design pipeline (ADR-2605080700) split per
 * the founder E2E directive: public artifact/run catalog plaintext + caller-
 * authored design IP (prompt/cadCode/palette) sealed via kotoba E2E
 * (sdk.encryptedWrite/Read, ADR-2605181100). RunPod GPU inference + CadQuery
 * exec + B2 byte custody stay etzhayyim via consent-capability.
 */
export * from "./types.js";
export {
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
} from "./registry.js";
