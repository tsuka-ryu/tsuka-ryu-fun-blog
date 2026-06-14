# プロジェクトメモ

FUNSTACK Static で作る静的技術ブログ。

## 作業フロー

- 初期構築は `/Users/tsukaryu/Documents/funstack-static-test/docs/build-from-scratch.md`（設計図）に
  沿って進め、フェーズ 13 までで全フェーズ完了済み。この設計図は**構築当時の参照用**として残す。
- 以降の変更は `docs/build-log.md` に追記して記録する。これは ADR 的な変更履歴で、
  「何を・なぜそう決めたか（採用理由・却下した代替案・ハマりどころ）」を残すのが目的。
  単なる作業メモではなく、後から判断の経緯を追えるようにすること。
- 進捗サマリ（フェーズ）は全完了済みなので通常は更新不要。新たに大きな作業単位を
  立てたときだけ追記する。

## 環境

- `mise.toml` で Node / pnpm を固定（node 24.16.0 / pnpm 11.6.0）。
- パッケージマネージャは pnpm。
- TypeScript はネイティブ版 `@typescript/native-preview`（`tsgo`）に一本化。
  型チェックは `pnpm typecheck`（= `tsgo --noEmit`）。

## ディレクトリ構成

手順書のフラット構成ではなく、結線を `src/app/` に集約する方針:

- `src/app/` — フレームワーク結線（Root / App / ClientApp / entries / build）。
  `entries`・`build` のパスは `vite.config.ts` で `./src/app/...` を指定。
- `src/components/` — UI 部品（Layout / Header / Footer / Counter など）。
- `src/pages/` — ページコンポーネント。
- `src/markdown/` — mdast → React レンダラー。
- `src/lib/` — ユーティリティ（site / format / feed / search / og など）。
- `src/og/` — OG 画像生成。
- `src/content.ts` — Markdown 読み込み & ox-content 変換（サーバー）。
- `src/constants.ts` — サイト共通定数（`SITE_TITLE` など）。`lib/site.ts` 相当はここに寄せる。

## 進め方の方針

- ファイルは依存の末端から作り、未作成モジュール依存はスタブではなく
  **コメントアウト**で逃がして各コミットを tsgo green に保つ。
- コード内コメントは日本語で書く。
- コメントは**コードだけを読む人に通じる自己完結した内容**にする。デザイン案の符牒
  （例「06 Marginalia」）・フェーズ番号・別ドキュメントの固有名など、外部文脈が
  ないと意味が取れない参照は書かない。「何を・なぜ」をその場の言葉で説明する。
- import は相対パスではなく **subpath imports**（package.json の `"#*": "./src/*"`）を使う。
  例: `#constants.js` / `#components/Layout.js` / `#app/App.js`（拡張子は `.js` 規約）。
