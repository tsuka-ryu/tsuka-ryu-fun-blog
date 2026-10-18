# プロジェクトメモ

Void + Cloudflare（Workers・D1・R2）で動かす技術ブログ。自分だけがログインする管理画面（`/admin`）で記事を書き、
HTML と Markdown（`/posts/<slug>.md`）の両方で配信する。公開側は D1 を読まず、R2 のスナップショットだけを読む。
**設計の全体像は `docs/architecture.md`。**

## 作業フロー

- 作業の前に `docs/void-cloudflare-rebuild.md` を読む（作り直しの計画・現在地・決定事項・受け入れ条件）。
  実装は Phase 7 まで完了。残りは Phase 8（本番への切り替え。Cloudflare のアカウントが要る**人間の作業**）で、
  その確認項目は同じ文書の表にある。会話や記憶には頼らない。
- 変更は `docs/build-log.md` に追記して記録する。これは ADR 的な変更履歴で、「何を・なぜそう決めたか
  （採用理由・却下した代替案・ハマりどころ）」を残すのが目的。単なる作業メモではなく、後から判断の経緯を追えるようにする。
- 計画のフェーズが進んだら、同じ PR の中で `docs/void-cloudflare-rebuild.md` のチェックボックスと「現在地」を更新する。
- Spike を進める中で出た疑問と答え（ソースで確認したものと推測を区別して書く）は `docs/void-spike-qa.md`。
  質問が出たら、ここに追記する。料金や上限のような事実は、記憶ではなく公式ドキュメントで確かめてから書く。
- Spike の再現手順と本番での確認手順は `docs/void-spike-verification.md`。Spike のコードは
  `~/Documents/vite/void-spike`（GitHub の `tsuka-ryu/void-spike`、private）。このリポジトリには入れない。
- 初期構築（FUNSTACK Static 版）の設計図 `/Users/tsukaryu/Documents/funstack-static-test/docs/build-from-scratch.md` は、
  構築当時の参照用として残している（現在の構成とは違う）。

## 環境

- `mise.toml` で Node / pnpm を固定（node 24.22.0 / pnpm 11.6.0。Void の要件は Node 24.21 以上）。パッケージマネージャは pnpm。
- ローカルの環境変数は `docs/local-env.md`（`.env`。ダミーの GitHub 認証情報が要る。島（アイランド）の書き方の決まりもここ）。
- push 前のフック（`lefthook.yml`）が整形・lint・型チェック・単体テスト・ビルドを回す。ビルドは `URLPattern` を使うので、
  **Node 22 以下ではフックが落ちる。** Node 24 を `PATH` の先頭に付けて push する（フックは飛ばさない）。
- PR のマージはスカッシュのみ（リベースマージは許可されていない）。
- TypeScript はネイティブ版 `@typescript/native-preview`（`tsgo`）に一本化。型チェックは `pnpm typecheck`
  （本体・`vrt/`・`scripts/` を、それぞれの tsconfig で）。
- 単体テストは `pnpm test`（Node）。パーサーの単体テストは、ブラウザでも `pnpm run test:browser`（Chromium）で動かせる。
- 公開側の品質確認（記事・`.md`・OG・feed・下書きの非公開・**D1 を使わないこと**）は `pnpm build && node scripts/qa-preview.ts`。
  管理画面の通しの確認は `node scripts/e2e-admin.mjs`（開発サーバーを起動しておく）。
- 見た目の確認は VRT（`vrt/`、`pnpm run test:vrt`）。使い方は `vrt/README.md`。記事やサイトの見た目を変えたら、
  `pnpm build` のあとで VRT を回し、意図した差分だけベースラインを更新する。
- このリポジトリには CI がない。VRT・QA・E2E は手動で回す。
- `void db generate` は、失敗しても `Migration generation complete.` と出す。`db/migrations/` に `.sql` ができたかで見分ける。
- Void は、`.env` 以外の環境変数ファイル（`.env.example` など）があるとビルドを止める。

## ディレクトリ構成

- `pages/` — Void の Pages mode のページ（`*.island.tsx` と `*.server.ts` の組）。公開側と `admin/`（管理画面）。
- `routes/` — Hono のルート。`feed.xml` / `sitemap.xml` / `search-index.json` / `uploads/*` と、`api/admin/*`（管理 API）。
- `middleware/` — 共有データ、404、`/posts/<slug>.md`、`/og/<slug>.png`（ファイル名の途中にパラメータを置くルートは
  Void が展開しないので、ミドルウェアで処理する）。
- `db/` — D1 のスキーマ（`schema.ts`）とマイグレーション。`auth.ts` / `env.ts` / `void.config.ts`（認証・環境変数・設定・301）。
- `src/site/` — 公開関数・D1 の操作・R2 の読み書き・バックアップ・画像の検証。**公開側のコードは、ここのうち D1 に
  触れるモジュール（`posts.ts` / `publish.ts` / `admin*.ts` / `import-markdown.ts` / `backup.ts`）を import してはいけない**
  （`public-boundary.test.ts` が守る）。
- `src/admin/` — 管理画面の部品（エディタ・プレビュー・履歴・タグ・画像）。
- `src/markdown/` — 自作の Markdown パーサー（`parse/`。純 TS・依存ゼロ。サーバーとブラウザで同じコード）、mdast → React の
  描画、ハイライト、HTML 出力。
- `src/components/` — UI 部品（`Page` が枠。ヘッダー・本文・フッター）。`src/lib/` — ユーティリティ（feed / search / seo / time など）。
  `src/og/` — OG 画像（WASM 版 Takumi）。`src/content.ts` — 記事のデータ形式と集計（I/O なし）。`src/constants.ts` — サイト共通定数。
- `scripts/` — 取り込み・バックアップ・QA・E2E。`vrt/` — ビジュアルリグレッションテストとベースライン画像。
  `design/` — デザインの試作。

## 島（アイランド）の決まり

島は、ページのファイルで `with { island: ... }` を付けて import した、**default export** のコンポーネントだけが動く。
**`#` のサブパスではなく相対パスで import する。** レイアウトの中の島は動かない（描画されるだけ）ので、枠（`Page`）は各ページが使い、
検索欄などの島は各ページのファイルで作って渡す。島を足したら、開発サーバーを再起動する。詳しくは `docs/build-log.md` の Phase 5。

## 進め方の方針

- コード内コメントは日本語で書く。
- コメントは**コードだけを読む人に通じる自己完結した内容**にする。デザイン案の符牒（例「06 Marginalia」）・フェーズ番号・
  別ドキュメントの固有名など、外部文脈がないと意味が取れない参照は書かない。「何を・なぜ」をその場の言葉で説明する。
- import は相対パスではなく **subpath imports**（package.json の `"#*": "./src/*"`）を使う。
  例: `#site/read.js` / `#components/Page.js` / `#markdown/parse/index.js`（拡張子は `.js` 規約）。島だけは相対パス（上記）。
- `auth.ts` は起動時に Vite を通さず素の Node で読まれる。import には拡張子 `.ts` が要り、`cloudflare:workers` を
  import するモジュールを先頭で import してはいけない。
- 公開側のコードで D1 を使わない。重い処理は、リクエストごとではなく公開時に 1 回だけ行う。
