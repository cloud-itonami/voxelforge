// voxelforge.etzhayyim.com — L3 dispatcher CF Worker (ADR-2605080700).
//
// Surfaces:
//   /health, /_app/meta                          edge probe (no auth)
//   /xrpc/com.etzhayyim.voxelforge.generate       procedure (Bearer auth)
//   /xrpc/com.etzhayyim.voxelforge.getRun         query     (Bearer auth)
//   /xrpc/com.etzhayyim.voxelforge.listArtifacts  query     (Bearer auth)
//   /xrpc/com.etzhayyim.voxelforge.coverage       query     (Bearer auth)
//
// Auth: Bearer sk_live_* / ES256 JWT → PDS service binding
// `/_internal/resolve-auth` returns { did, orgDid, activeDid, productScope }.
// Dispatch: forwards to bpmn-dispatcher with x-internal-trust HMAC.
//
// LangGraph backend: bpmn-dispatcher routes
// `com.etzhayyim.voxelforge.*` to LangGraph Server `/runs` (per
// ADR-2605080600 Phase 3). This Worker stays state-less.

import { Hono } from "hono";
import { dispatchVoxelforgeXrpc } from "./dispatcher";

type Env = {
  VOXELFORGE_VERSION?: string;
  VOXELFORGE_ACTOR_DID?: string;
  BPMN_DISPATCHER_URL: string;
  PDS_URL?: string;
  AUTHN_URL?: string;
  DISPATCHER_INTERNAL_SECRET?: string;
  PDS_SERVICE?: { fetch(req: Request): Promise<Response> };
  AUTHN_SERVICE?: { fetch(req: Request): Promise<Response> };
  HYPERDRIVE?: unknown;
  etzhayyim_METERING_DISABLED?: string;
};

interface AuthContext {
  did: string;
  orgDid: string;
  activeDid?: string;
  productScope?: "yata" | "obj" | null;
}

declare module "hono" {
  interface ContextVariableMap {
    auth?: AuthContext;
  }
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) =>
  c.json({ ok: true, app: "voxelforge", ts: new Date().toISOString() }),
);

app.get("/_worker/health", (c) =>
  c.json({ ok: true, app: "voxelforge", ts: new Date().toISOString() }),
);

app.get("/_app/meta", (c) =>
  c.json({
    app: "etzhayyim-project-voxelforge",
    did: c.env.VOXELFORGE_ACTOR_DID ?? "did:web:voxelforge.etzhayyim.com",
    version: c.env.VOXELFORGE_VERSION ?? "0.0.0",
    layer: "L3-dispatcher",
    surfaces: [
      "/xrpc/com.etzhayyim.voxelforge.generate",
      "/xrpc/com.etzhayyim.voxelforge.getRun",
      "/xrpc/com.etzhayyim.voxelforge.listArtifacts",
      "/xrpc/com.etzhayyim.voxelforge.coverage",
    ],
    backend: c.env.BPMN_DISPATCHER_URL,
    formats: ["glb", "vox", "voxel_grid_json", "manifest_json"],
    generators: ["trellis", "comfy3d", "cadquery"],
  }),
);

async function resolveAuthContext(req: Request, env: Env): Promise<AuthContext | null> {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return null;
  if (!env.PDS_SERVICE?.fetch) return null;

  try {
    const resp = await env.PDS_SERVICE.fetch("https://atproto/_internal/resolve-auth", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: h },
      body: JSON.stringify({}),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Partial<AuthContext> & { ok?: boolean };
    if (!data?.did || !data?.orgDid) return null;
    return {
      did: data.did,
      orgDid: data.orgDid,
      activeDid: data.activeDid,
      productScope: (data.productScope as AuthContext["productScope"]) ?? null,
    };
  } catch {
    return null;
  }
}

app.use("*", async (c, next) => {
  const path = c.req.path;
  if (path === "/health" || path === "/_worker/health" || path === "/_app/meta") {
    return next();
  }
  const auth = await resolveAuthContext(c.req.raw, c.env);
  if (!auth) {
    return c.json({ error: "AuthRequired", message: "Bearer token required" }, 401);
  }
  c.set("auth", auth);
  await next();
});

app.all("/xrpc/com.etzhayyim.voxelforge.:method", async (c) => {
  const method = c.req.param("method");
  const auth = c.var.auth;
  if (!auth) {
    return c.json({ error: "AuthRequired" }, 401);
  }
  const nsid = `com.etzhayyim.voxelforge.${method}`;
  let body: unknown = undefined;
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
  }
  const params = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  return dispatchVoxelforgeXrpc({
    env: c.env,
    nsid,
    method: c.req.method,
    body,
    params,
    auth,
  });
});

app.notFound((c) => c.json({ error: "NotFound", path: c.req.path }, 404));
app.onError((err, c) => {
  console.error("[voxelforge] unhandled", err);
  return c.json({ error: "Internal", message: String(err?.message ?? err) }, 500);
});

export default app;
