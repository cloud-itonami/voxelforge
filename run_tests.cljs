#!/usr/bin/env nbb
;; run_tests.cljs — voxelforge の面契約検査。
;;
;;   nbb --classpath test run_tests.cljs
;;
;; voxelforge は state-less な L3 dispatcher で、実際の計算は LangGraph Server と
;; RunPod 側に居る。この repo の実体は『複数の面が同じ actor・同じ lexicon・同じ
;; 安全境界について同じことを言っている』という合意なので、依存ゼロの nbb +
;; cljs.test でそれを毎回確かめる。
;;
;; 依存を持たないのは意図である。`kotoba/` の vitest suite は
;; `@etzhayyim/sdk` を `workspace:*` で要求するが、この repo はもうその monorepo に
;; 居ないので **npm install が通らず、あの suite はここでは 1 度も走らない**
;; （実測 2026-08-26: node_modules は repo 内に 1 つも無い）。走れない検査は
;; 走って問題が無かった検査と同じ顔をするので、走る検査を別に置く。

(ns run-tests
  (:require [clojure.test :as t]
            [voxelforge.contract-test]))

(def green-marker "voxelforge contract: all green")

(defmethod t/report [:cljs.test/default :end-run-tests] [m]
  (if (t/successful? m)
    (println (str "\n" green-marker))
    (do (println "\nvoxelforge contract: FAILED")
        (js/process.exit 1))))

(t/run-tests 'voxelforge.contract-test)
