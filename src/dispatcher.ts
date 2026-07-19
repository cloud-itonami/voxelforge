// Dispatcher — voxelforge.etzhayyim.com → bpmn-dispatcher (K8s ClusterIP) →
// LangGraph Server /runs (ADR-2605080600 / ADR-2605080700).
//
// Trust model (ADR-2604282300 §Addendum 2026-04-30):
//   x-internal-trust = HMAC-SHA256(DISPATCHER_INTERNAL_SECRET, `${ts}.${body}`)
//   bridge headers: x-etzhayyim-actor-did / x-etzhayyim-org-did / x-etzhayyim-trace-id /
//                    x-etzhayyim-product-scope (optional)
//
// 60-second timeout (LangGraph runs are background; this only times the
// initial submit / status read, not the full generate).

const DISPATCH_TIMEOUT_MS = 60_000;

type DispatcherEnv = {
  BPMN_DISPATCHER_URL: string;
  DISPATCHER_INTERNAL_SECRET?: string;
};

export interface DispatcherCallerContext {
  did: string;
  orgDid: string;
  activeDid?: string;
  productScope?: "yata" | "obj" | null;
}

export interface DispatchVoxelforgeXrpcArgs {
  env: DispatcherEnv;
  nsid: string;
  method: string;
  body: unknown;
  params: Record<string, string>;
  auth: DispatcherCallerContext;
}

export async function dispatchVoxelforgeXrpc(
  args: DispatchVoxelforgeXrpcArgs,
): Promise<Response> {
  const { env, nsid, method, body, params, auth } = args;
  const base = env.BPMN_DISPATCHER_URL.replace(/\/$/, "");
  const url = new URL(`${base}/xrpc/${nsid}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const ts = Date.now().toString();
  const bodyText = body == null ? "" : JSON.stringify(body);
  const sig = env.DISPATCHER_INTERNAL_SECRET
    ? await hmacHex(env.DISPATCHER_INTERNAL_SECRET, `${ts}.${bodyText}`)
    : "";

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-internal-trust": sig,
    "x-internal-trust-ts": ts,
    "x-etzhayyim-actor-did": auth.activeDid ?? auth.did,
    "x-etzhayyim-org-did": auth.orgDid,
    "x-etzhayyim-trace-id": crypto.randomUUID(),
  };
  if (auth.productScope) headers["x-etzhayyim-product-scope"] = auth.productScope;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DISPATCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url.toString(), {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : bodyText,
      signal: ctl.signal,
    });
    const respBody = await resp.arrayBuffer();
    return new Response(respBody, {
      status: resp.status,
      headers: forwardedHeaders(resp.headers),
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return Response.json(
        { error: "GatewayTimeout", message: "bpmn-dispatcher timed out" },
        { status: 504 },
      );
    }
    return Response.json(
      { error: "BackendUnavailable", message: String((err as Error)?.message ?? err) },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}

function forwardedHeaders(src: Headers): Headers {
  const out = new Headers();
  for (const [k, v] of src.entries()) {
    const lk = k.toLowerCase();
    if (lk === "content-type" || lk === "content-length" || lk.startsWith("x-etzhayyim-")) {
      out.set(k, v);
    }
  }
  return out;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
