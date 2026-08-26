(ns voxelforge.contract-test
  "voxelforge の面どうしの契約を固定する。

  この repo は state-less な L3 dispatcher であって、計算は LangGraph Server
  （`mitama-voxelforge-pool`）と RunPod 側に居る。したがってこの repo の実体は
  アルゴリズムではなく、**複数の面が同じ actor・同じ lexicon・同じ安全境界に
  ついて同じことを言っている**という合意である:

    src/app.ts                          thin edge（probe・Bearer 解決・NSID 転送）
    src/dispatcher.ts                   bpmn-dispatcher への HMAC 署名転送
    svelte/src/routes/xrpc/[...path]/   実際に配備される XRPC 面（MCP router 転送）
    kotoba/src/types.ts                 記録面の lexicon と validator
    wrangler.jsonc                      配備（main / routes / vars）
    kotodama.jsonld                     actor identity（DID / nanoid / nsidPrefixes）
    package.json / README.edn           名前と版
    migration.edn                       抽出元の path
    CLAUDE.md                           運用手順（smoke の実引数を含む）

  どの面も他を import していないので、片方だけ動いた drift は throw しない
  —— identity 文書と worker が別の lexicon を名乗っても配備は成功し、
  dispatcher の prefix routing が空振りして初めて分かる。

  ## 2 つの NSID 名前空間が同居している（2026-08-26 実測）

  edge が serve する XRPC は `com.etzhayyim.voxelforge.*` で、identity 文書の
  `nsidPrefixes` と記録面の collection は `com.etzhayyim.apps.voxelforge.*` で
  ある。**どちらも現に存在する別の名前空間**であって、片方が誤植ではない
  （CLAUDE.md 自身が表では `apps.` 無し、Forbidden 節の lexicon path では
  `apps/` 有りと、両方を書いている）。ここは両方を pin して、片方が動いたら
  見えるようにする —— 「どちらが正か」はこのテストの決めることではない。

  ## 配備されるのは thin edge ではない（2026-08-26 実測）

  `wrangler.main` は SvelteKit の build 出力を指しており、`src/app.ts` は
  配備の実行経路に**入っていない**。しかも 2 つの面は**信頼モデルが違う**:
  thin edge は PDS binding で Bearer を解決してから転送し、配備される
  svelte route は authorization をそのまま MCP router へ委譲する。
  下の `deployed-*` 群は後者を pin する —— thin edge の guard を検査した
  緑を、配備面の安全性の証拠として読ませないためである。

  ## 抽出の床

  各抽出は見つからなければ throw する。**『抽出できなかった』が
  『合意している』と同じ顔をしてはならない** —— 正規表現は実装が
  変わると静かに空振りし、空振りは合格と同じ緑を返すからである。"
  (:require [clojure.string :as str]
            [clojure.test :refer [deftest is testing]]
            ["fs" :as fs]))

;; ─── 抽出（見つからなければ throw） ─────────────────────────────────────

(defn- slurp-file [path] (fs/readFileSync path "utf8"))

(defn- extract-1
  "re の第 1 group を返す。見つからなければ throw —— 空振りを緑にしない。"
  [src re path what]
  (or (second (re-find re src))
      (throw (ex-info (str "extraction failed: " what " not found in " path)
                      {:path path :what what}))))

(defn- present!
  "literal が src に在ることを要求する。抽出の床（bool を返さない）。"
  [src literal path what]
  (when-not (str/includes? src literal)
    (throw (ex-info (str "extraction floor: " what " not found in " path)
                    {:path path :what what :literal literal})))
  literal)

(defn- get!
  "map から k を取る。無ければ throw —— nil は『合意している』の顔をする。"
  [m k path what]
  (let [v (get m k ::missing)]
    (when (= v ::missing)
      (throw (ex-info (str "extraction floor: " what " missing in " path)
                      {:path path :what what :key k})))
    v))

(defn- non-empty! [coll path what]
  (when (empty? coll)
    (throw (ex-info (str "extraction floor: 0 " what " extracted from " path)
                    {:path path :what what})))
  coll)

(defn- string-list
  "TS の `[\"a\", \"b\"]` を 1 群だけ取り出して vector にする。
   0 件なら throw —— 空の列は「一致している」と同じ顔をする。"
  [src re path what]
  (->> (str/split (extract-1 src re path what) #",")
       (map #(str/replace (str/trim %) #"^[\"']|[\"']$" ""))
       (remove str/blank?)
       vec
       (#(non-empty! % path what))))

(defn- all-matches
  "re の第 1 group を全部拾う。0 件なら throw。"
  [src re path what]
  (non-empty! (vec (map second (re-seq re src))) path what))

(defn- read-json [path]
  (js->clj (js/JSON.parse (slurp-file path)) :keywordize-keys true))

(defn- read-jsonc
  "wrangler.jsonc は行頭コメントだけを持ちうる。JSON に落として読む。"
  [path]
  (->> (str/split-lines (slurp-file path))
       (remove #(str/starts-with? (str/triml %) "//"))
       (str/join "\n")
       js/JSON.parse
       (#(js->clj % :keywordize-keys true))))

(def app-ts      (delay (slurp-file "src/app.ts")))
(def dispatch-ts (delay (slurp-file "src/dispatcher.ts")))
(def xrpc-route  (delay (slurp-file "svelte/src/routes/xrpc/[...path]/+server.ts")))
(def page-svelte (delay (slurp-file "svelte/src/routes/+page.svelte")))
(def types-ts    (delay (slurp-file "kotoba/src/types.ts")))
(def kotodama    (delay (read-json "kotodama.jsonld")))
(def wrangler    (delay (read-jsonc "wrangler.jsonc")))
(def pkg         (delay (read-json "package.json")))
(def readme      (delay (slurp-file "README.edn")))
(def migration   (delay (slurp-file "migration.edn")))
(def claude-md   (delay (slurp-file "CLAUDE.md")))

;; ─── thin edge / dispatcher から読む事実 ────────────────────────────────

(def edge
  (delay
   {:actor-did   (extract-1 @app-ts #"VOXELFORGE_ACTOR_DID \?\? \"(did:web:[^\"]+)\""
                            "src/app.ts" "actor DID fallback")
    :nsid-prefix (extract-1 @app-ts #"const nsid = `([a-z.]+)\$\{method\}`;"
                            "src/app.ts" "NSID template prefix")
    :route       (extract-1 @app-ts #"app\.all\(\"/xrpc/([a-z.]+):method\""
                            "src/app.ts" "XRPC route prefix")
    :surfaces    (string-list @app-ts #"surfaces: \[([^\]]+)\]" "src/app.ts" "meta surfaces")
    :formats     (string-list @app-ts #"formats: \[([^\]]+)\]" "src/app.ts" "meta formats")
    :generators  (string-list @app-ts #"generators: \[([^\]]+)\]" "src/app.ts" "meta generators")}))

(def records
  (delay
   {:artifact-collection (extract-1 @types-ts #"ARTIFACT_COLLECTION = \"([^\"]+)\""
                                    "kotoba/src/types.ts" "ARTIFACT_COLLECTION")
    :run-collection      (extract-1 @types-ts #"RUN_COLLECTION = \"([^\"]+)\""
                                    "kotoba/src/types.ts" "RUN_COLLECTION")
    :design-inner-type   (extract-1 @types-ts #"DESIGN_INNER_TYPE = \"([^\"]+)\""
                                    "kotoba/src/types.ts" "DESIGN_INNER_TYPE")
    :did-prefix          (extract-1 @types-ts #"VOXELFORGE_DID_PREFIX = \"([^\"]+)\""
                                    "kotoba/src/types.ts" "VOXELFORGE_DID_PREFIX")
    :formats             (string-list @types-ts #"ARTIFACT_FORMATS: readonly ArtifactFormat\[\] = \[([^\]]+)\]"
                                      "kotoba/src/types.ts" "ARTIFACT_FORMATS")
    :generators          (string-list @types-ts #"GENERATORS: readonly Generator\[\] = \[([^\]]+)\]"
                                      "kotoba/src/types.ts" "GENERATORS")
    :design-kinds        (string-list @types-ts #"DESIGN_KINDS: readonly DesignKind\[\] = \[([^\]]+)\]"
                                      "kotoba/src/types.ts" "DESIGN_KINDS")
    :target-formats      (string-list @types-ts #"TARGET_FORMATS: readonly TargetFormat\[\] = \[([^\]]+)\]"
                                      "kotoba/src/types.ts" "TARGET_FORMATS")
    :voxel-dim-min       (js/parseInt (extract-1 @types-ts #"n >= (\d+) && n <= \d+"
                                                 "kotoba/src/types.ts" "isVoxelDim lower bound"))
    :voxel-dim-max       (js/parseInt (extract-1 @types-ts #"n >= \d+ && n <= (\d+)"
                                                 "kotoba/src/types.ts" "isVoxelDim upper bound"))}))

;; ─── identity ───────────────────────────────────────────────────────────

(deftest actor-identity-agrees-across-surfaces
  (let [did  (:actor-did @edge)
        host (get-in @kotodama [:routes 0 :host])]
    (testing "DID は 4 箇所に別々に書かれている。1 箇所だけ動くと did:web を解決した相手と喋る相手が別人になる"
      (is (= did (get-in @wrangler [:vars :VOXELFORGE_ACTOR_DID]))
          "src/app.ts の fallback と wrangler の VOXELFORGE_ACTOR_DID")
      (is (= did (:did @kotodama))
          "src/app.ts の fallback と kotodama.jsonld の did")
      (is (= did (str "did:web:" host))
          "DID の method-specific-id は kotodama の route host"))

    (testing "記録面の DID prefix は actor DID を親に持つ（別の親だと成果物の帰属が切れる）"
      (is (= (str did ":") (:did-prefix @records))
          "kotoba/src/types.ts の VOXELFORGE_DID_PREFIX は <actor DID>:"))

    (testing "配備の route host と identity 文書の host は同じ"
      (is (= (str host "/*") (get-in @wrangler [:routes 0 :pattern]))
          "wrangler の route pattern は <host>/*")
      (is (= (str "https://" host "/embed") (:embedUrl @kotodama))
          "kotodama の embedUrl は同じ host"))))

(deftest project-name-and-version-agree-across-surfaces
  (let [nm (get! @kotodama :name "kotodama.jsonld" "name")]
    (testing "worker 名が 1 面だけ動くと、配備先の逆引きが切れる"
      (is (= nm (:name @wrangler)) "kotodama name と wrangler の worker 名")
      (is (= nm (:name @pkg))      "kotodama name と package.json name")
      (is (str/includes? @page-svelte (str "\"project\": \"" nm "\""))
          "kotodama name と landing page の project"))
    (testing "version は 2 面が言う"
      (is (= (get-in @wrangler [:vars :VOXELFORGE_VERSION]) (:version @pkg))
          "wrangler の VOXELFORGE_VERSION と package.json version"))
    (testing "README.edn が名乗る repo 名は、migration が宣言した移設先と同じ"
      (let [readme-name (extract-1 @readme #":name \"([^\"]+)\"" "README.edn" ":name")
            dest        (extract-1 @migration #":destination \{:repository \"([^\"]+)\"\}"
                                   "migration.edn" ":destination :repository")]
        (is (= readme-name (last (str/split dest #"/")))
            "README.edn :name は migration の移設先 repo の basename")))))

(deftest extraction-source-path-agrees-across-three-surfaces
  (testing "抽出元 path が動くと、上流 monorepo への逆引きが 3 面でばらける"
    (let [src-path (extract-1 @migration #":path \"([^\"]+)\"" "migration.edn" ":source :path")]
      (is (str/includes? @page-svelte (str "\"relativePath\": \"" src-path "/"))
          "landing page の relativePath は migration の :source :path 配下")
      (is (str/includes? @claude-md (str "cd " src-path))
          "CLAUDE.md の deploy 手順は同じ path へ cd する"))))

(deftest backend-urls-agree-between-deploy-vars-and-identity-doc
  (let [vars (:vars @wrangler)
        deps (get! @kotodama :backendDependencies "kotodama.jsonld" "backendDependencies")]
    (testing "配備 var と identity 文書が別の上流を指すと、名乗る依存先と喋る相手が別になる"
      (is (= (:PDS_URL vars) (:atproto deps)) "PDS_URL と backendDependencies.atproto")
      (is (= (:AUTHN_URL vars) (:authn deps)) "AUTHN_URL と backendDependencies.authn"))
    (testing "配備される XRPC 面の既定 MCP router は、配備 var と同じ URL である"
      (is (= (:AGENTGATEWAY_MCP_ROUTER_URL vars)
             (extract-1 @xrpc-route #"DEFAULT_MCP_ROUTER_URL = '([^']+)'"
                        "svelte xrpc route" "DEFAULT_MCP_ROUTER_URL"))
          "wrangler の AGENTGATEWAY_MCP_ROUTER_URL と route の既定値"))
    (testing "framework の名乗りは配備 var と、上流へ送る header が一致する"
      (is (= (:APP_FRAMEWORK vars)
             (extract-1 @xrpc-route #"'x-etzhayyim-bff', '([^']+)'"
                        "svelte xrpc route" "x-etzhayyim-bff value"))
          "APP_FRAMEWORK と x-etzhayyim-bff header"))))

;; ─── 2 つの NSID 名前空間 ───────────────────────────────────────────────

(deftest edge-lexicon-and-record-lexicon-are-both-pinned
  (let [edge-prefix   (:nsid-prefix @edge)
        record-prefix (get-in @kotodama [:nsidPrefixes 0])]
    (testing "edge が serve する lexicon"
      (is (= "com.etzhayyim.voxelforge." edge-prefix)
          "NSID template の prefix")
      (is (= edge-prefix (:route @edge))
          "route の literal と NSID template は同じ prefix（片方だけ動くと 404 か誤転送）"))

    (testing "記録面と identity 文書が名乗る lexicon"
      (is (= "com.etzhayyim.apps.voxelforge" record-prefix)
          "kotodama の nsidPrefixes")
      (is (= (str record-prefix ".artifact") (:artifact-collection @records))
          "ARTIFACT_COLLECTION は nsidPrefixes 配下")
      (is (= (str record-prefix ".run") (:run-collection @records))
          "RUN_COLLECTION は nsidPrefixes 配下")
      (is (= (str record-prefix ".design") (:design-inner-type @records))
          "DESIGN_INNER_TYPE は nsidPrefixes 配下"))

    (testing "2 つは別の名前空間である —— 一致させたなら此処を畳んで契約に入れること"
      (is (not= (str record-prefix ".") edge-prefix)
          (str "edge=" edge-prefix " record=" record-prefix "."
               " —— 同じになったなら、この test を消して"
               " actor-identity-agrees-across-surfaces へ移すこと")))))

(deftest advertised-surfaces-name-methods-under-the-edge-lexicon
  (testing "/_app/meta が名乗る面が lexicon の外に出ると、dispatcher の prefix routing が空振りする"
    (let [prefix (:nsid-prefix @edge)]
      (doseq [s (:surfaces @edge)]
        (is (str/starts-with? s (str "/xrpc/" prefix))
            (str s " は /xrpc/" prefix " 配下")))))
  (testing "CLAUDE.md の表と /_app/meta は同じ面を名乗る"
    (doseq [s (:surfaces @edge)]
      (is (str/includes? @claude-md (str "`" s "`"))
          (str "CLAUDE.md の Surfaces 表に " s " が在る")))))

;; ─── thin edge の安全境界 ───────────────────────────────────────────────

(deftest edge-leaves-exactly-three-probe-paths-unauthenticated
  (testing "auth を素通しする path が 1 本増えると、その面が無認証で外に出る"
    (let [guard (extract-1 @app-ts #"if \((path === [^)]+)\) \{" "src/app.ts" "auth bypass guard")
          open  (set (map second (re-seq #"path === \"([^\"]+)\"" guard)))]
      (is (= #{"/health" "/_worker/health" "/_app/meta"} open)
          "bypass されるのは probe 3 本だけ")))
  (testing "bypass された 3 本は、実際に handler が在る"
    (doseq [p ["/health" "/_worker/health" "/_app/meta"]]
      (is (str/includes? @app-ts (str "app.get(\"" p "\""))
          (str p " の handler が在る")))))

(deftest edge-auth-fails-closed-on-every-unresolved-path
  (testing "解決できなかった Bearer が『解決できた』と同じ顔をすると、無認証が通る"
    (is (present! @app-ts "if (!h.startsWith(\"Bearer \")) return null;"
                  "src/app.ts" "non-Bearer rejected")
        "Bearer で始まらない authorization は null")
    (is (present! @app-ts "if (!env.PDS_SERVICE?.fetch) return null;"
                  "src/app.ts" "missing PDS binding rejected")
        "PDS binding が無ければ null（素通しではない）")
    (is (present! @app-ts "if (!resp.ok) return null;"
                  "src/app.ts" "non-ok resolve rejected")
        "PDS が 2xx を返さなければ null")
    (is (present! @app-ts "if (!data?.did || !data?.orgDid) return null;"
                  "src/app.ts" "partial claims rejected")
        "did と orgDid の両方が揃わなければ null（片方だけでは通さない）")
    (is (re-find #"\} catch \{\s*return null;" @app-ts)
        "PDS binding が throw しても null に落ちる"))
  (testing "null は 401 になる（次の handler へ落ちない）"
    (is (re-find #"\{ error: \"AuthRequired\"[^\n]*\}, 401\)" @app-ts)
        "auth が無ければ 401 AuthRequired")))

(deftest edge-confines-xrpc-to-the-voxelforge-lexicon
  (testing "prefix は route の literal そのものが守っている（定数が在るだけでは足りない）"
    (is (re-find #"app\.all\(\"/xrpc/com\.etzhayyim\.voxelforge\.:method\"" @app-ts)
        "XRPC handler は voxelforge lexicon の path にしか付いていない"))
  (testing "handler の中でも auth を取り直す（middleware だけに頼らない）"
    (is (re-find #"const auth = c\.var\.auth;\s*\n\s*if \(!auth\) \{" @app-ts)
        "auth が無ければ handler 自身が止める"))
  (testing "prefix に合わない経路は 404 で終わる"
    (is (re-find #"\{ error: \"NotFound\"[^\n]*\}, 404\)" @app-ts)
        "既定の返答は 404 NotFound")))

(deftest edge-does-not-let-query-params-decide-the-nsid
  (testing "method 部が params から来ると、任意の NSID を dispatcher へ通せる"
    (is (present! @app-ts "const method = c.req.param(\"method\");"
                  "src/app.ts" "method from path param")
        "method は path param から取る")
    (is (present! @app-ts "const nsid = `com.etzhayyim.voxelforge.${method}`;"
                  "src/app.ts" "nsid built from prefix + method")
        "NSID は prefix に method を継いで組む")))

;; ─── dispatcher の信頼境界 ──────────────────────────────────────────────

(deftest dispatcher-signs-the-timestamp-and-body-with-hmac-sha256
  (testing "署名の対象が body だけになると、同じ body の再送が永久に有効になる"
    (is (present! @dispatch-ts "`${ts}.${bodyText}`" "src/dispatcher.ts" "signed message")
        "署名対象は <ts>.<body>")
    (is (present! @dispatch-ts "\"x-internal-trust-ts\": ts" "src/dispatcher.ts" "ts header")
        "検証側が同じ ts を再構成できるよう header に載る"))
  (testing "hash が弱くなると、上流の信頼判定が偽造できる"
    (is (present! @dispatch-ts "{ name: \"HMAC\", hash: \"SHA-256\" }"
                  "src/dispatcher.ts" "HMAC-SHA256")
        "HMAC-SHA256 で署名する"))
  (testing "secret が無いときは署名を空にする（別の値をでっち上げない）"
    (is (re-find #"env\.DISPATCHER_INTERNAL_SECRET\s*\n?\s*\? await hmacHex" @dispatch-ts)
        "secret が bound されているときだけ署名する")))

(deftest dispatcher-prefers-the-delegated-actor-did
  (testing "activeDid を落とすと、代理実行が本人の名前で上流に届く"
    (is (present! @dispatch-ts "\"x-etzhayyim-actor-did\": auth.activeDid ?? auth.did"
                  "src/dispatcher.ts" "actor DID header")
        "actor DID header は activeDid を優先し、無ければ did"))
  (testing "org DID は別 header で必ず送る"
    (is (present! @dispatch-ts "\"x-etzhayyim-org-did\": auth.orgDid"
                  "src/dispatcher.ts" "org DID header")
        "org DID は auth から取る（要求元が指定できない）")))

(deftest dispatcher-forwards-only-allowlisted-response-headers
  (testing "上流の header を素通しすると、set-cookie 等が呼び出し元へ抜ける"
    (is (re-find #"lk === \"content-type\" \|\| lk === \"content-length\" \|\| lk\.startsWith\(\"x-etzhayyim-\"\)"
                 @dispatch-ts)
        "転送されるのは content-type / content-length / x-etzhayyim-* のみ")
    (is (present! @dispatch-ts "const out = new Headers();" "src/dispatcher.ts" "fresh header set")
        "上流の Headers を再利用せず、空から組み立てる")))

(deftest dispatcher-bounds-the-submit-and-separates-failure-modes
  (testing "timeout が無いと、edge の要求が上流の停止に道連れになる"
    (is (= "60_000" (extract-1 @dispatch-ts #"const DISPATCH_TIMEOUT_MS = ([0-9_]+);"
                               "src/dispatcher.ts" "DISPATCH_TIMEOUT_MS"))
        "submit の上限は 60 秒")
    (is (present! @dispatch-ts "setTimeout(() => ctl.abort(), DISPATCH_TIMEOUT_MS)"
                  "src/dispatcher.ts" "abort wired to timeout")
        "その定数が実際に AbortController を撃つ")
    (is (present! @dispatch-ts "clearTimeout(timer)" "src/dispatcher.ts" "timer cleared")
        "timer は finally で必ず解除する"))
  (testing "timeout と到達不能を同じ status にすると、上流の停止と落ちが区別できない"
    (is (re-find #"\"GatewayTimeout\"[\s\S]{0,120}status: 504" @dispatch-ts)
        "AbortError は 504 GatewayTimeout")
    (is (re-find #"\"BackendUnavailable\"[\s\S]{0,120}status: 502" @dispatch-ts)
        "それ以外の失敗は 502 BackendUnavailable")))

(deftest dispatcher-normalizes-the-base-url-before-appending-the-nsid
  (is (re-find #"env\.BPMN_DISPATCHER_URL\.replace\(/\\/\$/, \"\"\)" @dispatch-ts)
      "末尾スラッシュを畳んでから /xrpc/ を継ぐ"))

;; ─── edge が名乗る能力と、記録面が受け付ける値 ─────────────────────────

(deftest advertised-formats-and-generators-match-the-record-validators
  (testing "edge が名乗る format を記録面が拒否すると、生成は成功して登録だけが落ちる"
    (is (= (:formats @edge) (:formats @records))
        "/_app/meta の formats と ARTIFACT_FORMATS は順序まで含めて同一"))
  (testing "edge が名乗る generator を記録面が拒否すると、同じことが起きる"
    (is (= (:generators @edge) (:generators @records))
        "/_app/meta の generators と GENERATORS は順序まで含めて同一")))

(deftest documented-smoke-arguments-are-accepted-by-the-record-validators
  (testing "手順書の実引数が validator に弾かれると、書いてあるとおりに叩いて失敗する"
    (doseq [d (all-matches @claude-md #"\"targetVoxelDim\": (\d+)" "CLAUDE.md" "targetVoxelDim values")]
      (let [n (js/parseInt d)]
        (is (and (>= n (:voxel-dim-min @records)) (<= n (:voxel-dim-max @records)))
            (str "targetVoxelDim " n " は isVoxelDim の範囲 "
                 (:voxel-dim-min @records) "–" (:voxel-dim-max @records) " の中"))))
    (doseq [f (all-matches @claude-md #"\"targetFormat\": \"([a-z]+)\"" "CLAUDE.md" "targetFormat values")]
      (is (contains? (set (:target-formats @records)) f)
          (str "targetFormat " f " は TARGET_FORMATS に在る")))
    (doseq [k (all-matches @claude-md #"\"kind\": \"([a-z]+)\"" "CLAUDE.md" "kind values")]
      (is (contains? (set (:design-kinds @records)) k)
          (str "kind " k " は DESIGN_KINDS に在る")))))

;; ─── 実際に配備される面 ─────────────────────────────────────────────────

(deftest deployed-entry-is-the-sveltekit-build-not-the-thin-edge
  (testing "配備される main と、package が main と名乗る path は別物である"
    (is (= "svelte/.svelte-kit/cloudflare/_worker.js" (:main @wrangler))
        "wrangler.main は SvelteKit の build 出力")
    (is (= "src/app.ts" (:main @pkg))
        "package.json.main は thin edge を名乗る"))
  (testing "assets の配信元も同じ build 出力の下に在る"
    (is (str/starts-with? (get-in @wrangler [:assets :directory]) "./svelte/.svelte-kit/cloudflare/")
        "assets.directory は SvelteKit build の client 側")))

(deftest deployed-xrpc-route-delegates-auth-upstream-and-never-caches
  (testing "配備される面は authorization を上流へ渡す（ここで削ると上流が誰とも判定できない）"
    (is (present! @xrpc-route "const headers = new Headers(event.request.headers);"
                  "svelte xrpc route" "inbound headers copied")
        "inbound header をそのまま引き継ぐ")
    (is (not (str/includes? @xrpc-route "headers.delete('authorization')"))
        "authorization は削らない —— 認証は MCP router に委譲されている"))
  (testing "inbound の host header は上流へ持ち越さない"
    (is (present! @xrpc-route "headers.delete('host');" "svelte xrpc route" "host stripped")
        "host は削ってから上流へ送る"))
  (testing "XRPC 応答が cache されると、actor 状態が別の閲覧者へ漏れる"
    (is (present! @xrpc-route "headers.set('cache-control', 'no-store');"
                  "svelte xrpc route" "no-store on every response")
        "noStore が全応答に cache-control: no-store を付ける"))
  (testing "preflight は POST に閉じる"
    (is (present! @xrpc-route "'access-control-allow-methods': 'POST,OPTIONS'"
                  "svelte xrpc route" "preflight methods")
        "許可 method は POST,OPTIONS のみ"))
  (testing "NSID が空の要求は上流へ送らない"
    (is (present! @xrpc-route "if (!nsid) return noStore({ error: 'Missing XRPC method' }, { status: 400 });"
                  "svelte xrpc route" "empty nsid rejected")
        "path が空なら 400 で止める")))

;; ─── 既知の穴を封じ込める ───────────────────────────────────────────────

(def known-unset-deploy-vars
  "2026-08-26 実測。`src/dispatcher.ts` は `env.BPMN_DISPATCHER_URL` を
   **fallback 無しで deref** し（`.replace(...)`）、`src/app.ts` の Env は
   これを必須と型付けしているのに、`wrangler.jsonc` の vars にこの名前は
   無い。値そのものは `kotodama.backendDependencies.bpmnDispatcher` が
   知っている。secret として注入されている可能性はあるが、URL は secret
   ではないので、少なくとも 2 面が食い違っている。

   **穴を封じ込めるが、封じ込めたことを黙らせない** —— var が足された日に
   このテストが赤くなり、そのとき `backend-urls-agree-between-deploy-vars-and-identity-doc`
   へ移して kotodama の値と突き合わせるところまで手が届く。"
  #{"BPMN_DISPATCHER_URL"})

(deftest known-unset-deploy-vars-are-still-unset
  (testing "例外表が現実とずれたら、例外表の方を直させる"
    (doseq [v known-unset-deploy-vars]
      (is (not (contains? (:vars @wrangler) (keyword v)))
          (str v " が wrangler の vars に入った —— known-unset-deploy-vars から外して "
               "backend-urls-agree-between-deploy-vars-and-identity-doc に入れること"))))
  (testing "その名前は今も、fallback 無しで deref されている"
    (is (present! @dispatch-ts "env.BPMN_DISPATCHER_URL.replace" "src/dispatcher.ts"
                  "unguarded BPMN_DISPATCHER_URL deref")
        "dispatcher は BPMN_DISPATCHER_URL を素で deref する"))
  (testing "値を知っている面は在る（移すときの突き合わせ先）"
    (is (string? (get-in @kotodama [:backendDependencies :bpmnDispatcher]))
        "kotodama.backendDependencies.bpmnDispatcher が値を持つ")))
