# プロジェクトメモ

FUNSTACK Static で作る静的技術ブログ。

## 作業フロー

- 作業を進めるときは `/Users/tsukaryu/Documents/funstack-static-test/docs/build-from-scratch.md`（設計図／手順書）を参考にする。
- タスク完了ごとに `docs/build-log.md` に実際の作業内容を追記する。
  - build-from-scratch.md = 設計図、build-log.md = 実際の作業履歴。

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
- import は相対パスではなく **subpath imports**（package.json の `"#*": "./src/*"`）を使う。
  例: `#constants.js` / `#components/Layout.js` / `#app/App.js`（拡張子は `.js` 規約）。
