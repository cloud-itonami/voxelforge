# voxelforge.etzhayyim.com — 3D design pipeline (text/image/CAD → mesh+voxel)

Authoritative: ADR-2605080700 + ADR-2605080600 (LangGraph Server) + ADR-2605010000 (RunPod 6000 Ada).

## Layer

L3 Dispatcher (CF Worker, edge). State-less. All compute lives in
`mitama-voxelforge-pool` LangGraph Server (Granian) which calls RunPod
6000 Ada unified pod (`vyp99t9px7h4dl`) for TRELLIS / ComfyUI 3D-Pack /
CadQuery exec, and writes artifacts to B2 + RisingWave directly.

## Surfaces

| Path | Purpose |
|---|---|
| `/xrpc/com.etzhayyim.voxelforge.generate` | procedure — submit text/image/CAD design, returns `runId` |
| `/xrpc/com.etzhayyim.voxelforge.getRun` | query — poll a run's status / artifact URIs |
| `/xrpc/com.etzhayyim.voxelforge.listArtifacts` | query — filter by designId / actor / format |
| `/xrpc/com.etzhayyim.voxelforge.coverage` | query — counters + format breakdown |
| `/health`, `/_app/meta` | edge probe |

## Output formats

| File | Use |
|---|---|
| `model.glb` | gltf-binary; Three.js / Blender / Unreal / Godot / kami-engine `kami-gltf` |
| `model.vox` | MagicaVoxel; convert externally to `.litematic` / `.mcstructure` for Minecraft Java |
| `voxel_grid.json` | kami-voxel-native palette + RLE; used by isekai browser side |
| `manifest.json` | content hashes + dimensions + generator routing record |

All artifacts live at `b2://etzhayyim-nats/voxelforge/v1/{designId}/...`.

## Generators (RunPod 6000 Ada unified pod)

| Generator | Trigger | Endpoint |
|---|---|---|
| TRELLIS | `kind=text` or `kind=image` (default) | `https://vyp99t9px7h4dl-5000.proxy.runpod.net/v1/generate` |
| ComfyUI 3D-Pack | `kind=image` (operator override; better at sharp objects) | `https://vyp99t9px7h4dl-8188.proxy.runpod.net/api/...` |
| CadQuery | `kind=cad` | exec inside LangGraph node sandbox (`kotodama.voxelforge.converters.exec_cadquery`) |

## Auth

- `Bearer sk_live_*` — etzhayyim API key (PDS verifies via `vertex_api_key`)
- `Bearer <ES256-JWT>` — AT Protocol session JWT
- Worker forwards Authorization to PDS service binding
  `/_internal/resolve-auth`, gets `{ did, orgDid, activeDid, productScope }`,
  then HMAC-signs forward to bpmn-dispatcher.

## Forwarding model

```
Client → CF Worker (voxelforge.etzhayyim.com)
   ↓ auth middleware → PDS_SERVICE binding /_internal/resolve-auth
   ↓ resolved { did, orgDid, activeDid, productScope }
   ↓ POST https://dispatcher.etzhayyim.com/xrpc/com.etzhayyim.voxelforge.{method}
      headers: x-internal-trust=<HMAC>, x-etzhayyim-{org,actor}-did, x-etzhayyim-trace-id
bpmn-dispatcher (K8s ClusterIP)
   ↓ NSID prefix routing (com.etzhayyim.voxelforge.* → langgraph backend)
voxelforge-langgraph (mitama-voxelforge-pool, Granian :8000)
   ↓ /runs (POST) — start StateGraph
   ↓ Pregel: parse → route → generate → post → voxelize → export → register
   → RunPod 6000 Ada (TRELLIS / ComfyUI)
   → B2 (.glb / .vox / .json)
   → RisingWave Hyperdrive INSERT (vertex_voxelforge_artifact)
```

## Forbidden

- Direct RunPod calls from this CF Worker — RunPod URL only known to LangGraph Server pod env.
- Direct B2 PUT from this CF Worker — artifacts only written from LangGraph nodes.
- `sdk.pds.dispatch({ type: "com.atproto.repo.createRecord", ... })` for `com.etzhayyim.voxelforge.*` — domain writes go to Hyperdrive direct (ADR-0036).
- Adding new XRPC endpoints outside the 4 lexicons in `00-contracts/lexicons/com/etzhayyim/apps/voxelforge/`. New methods require an ADR addendum + lexicon PR.
- Federable AT Repo emit — voxelforge is `non-federable` per the deps.toml federable whitelist policy (no `app.bsky.*` derive, no `subscribeRepos` exposure).

## Deploy

```bash
cd 60-apps/etzhayyim-project-voxelforge
wrangler secret put DISPATCHER_INTERNAL_SECRET  # shared with K8s bpmn-dispatcher-auth
etzhayyim deploy --no-svelte
```

## Smoke

```bash
# 1. Edge health (no auth)
curl https://voxelforge.etzhayyim.com/health
curl https://voxelforge.etzhayyim.com/_app/meta

# 2. Submit a text-driven design (Bearer required)
curl -X POST https://voxelforge.etzhayyim.com/xrpc/com.etzhayyim.voxelforge.generate \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "text",
    "prompt": "small wooden cabin with stone chimney",
    "targetFormat": "both",
    "targetVoxelDim": 64
  }'
# → { "runId": "...", "designId": "at://did:web:voxelforge.etzhayyim.com/...", "status": "running", "estimatedSeconds": 90 }

# 3. Poll
curl "https://voxelforge.etzhayyim.com/xrpc/com.etzhayyim.voxelforge.getRun?runId=..." \
  -H "Authorization: Bearer sk_live_xxxxx"

# 4. CAD path (no GPU needed)
curl -X POST https://voxelforge.etzhayyim.com/xrpc/com.etzhayyim.voxelforge.generate \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "cad",
    "cadCode": "import cadquery as cq\nresult = cq.Workplane(\"XY\").box(10, 10, 5)",
    "targetFormat": "both",
    "targetVoxelDim": 32
  }'
```
