# tsuka-ryu fun blog

Void + Cloudflare（Workers・D1・R2）で動かす技術ブログ。自分だけがログインする管理画面で、
記事を Web UI で書き、その場でプレビューして、公開できる。記事は HTML と Markdown（`/posts/<slug>.md`）の両方で配信する。

## 特徴

- **管理画面（`/admin`）** — GitHub ログイン（自分のアカウントだけ）。CodeMirror 6 のエディタ、公開時と同じ検証をかけた
  プレビュー（エラーは行番号付きで、クリックで該当行へ）、自動保存、バージョン履歴と差分、画像のペースト（WebP に変換して R2 へ）、タグ管理。
- **D1 は管理画面専用、公開側は R2 だけを読む** — D1 の従量課金で請求が跳ねないよう、公開のたびに R2 にスナップショット
  （記事・`.md`・OG 画像・一覧・feed・sitemap・検索索引）を書き出し、読者のリクエストは D1 に触れない。ISR でキャッシュする。
- **自作の Markdown パーサー**（純 TypeScript・依存ゼロ）— サーバーとブラウザで同じコードが動く。
- **OG 画像・シンタックスハイライトは公開時に 1 回だけ** — WASM 版 Takumi と shiki（JavaScript の正規表現エンジン）。
- **移行前後の見た目を VRT で保証** — Vitest のブラウザモード + Playwright。

## 技術スタック

| ツール                         | 役割                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| Void（`void` / `@void/react`） | Cloudflare Workers 上のフレームワーク（Pages mode + 島）。D1・R2・認証・ISR |
| Cloudflare D1 / R2             | 編集用のデータ / 公開スナップショットと画像                                 |
| Better Auth（Void 経由）       | GitHub ログイン                                                             |
| CodeMirror 6                   | 管理画面のエディタ                                                          |
| shiki / `@takumi-rs/wasm`      | ハイライト / OG 画像                                                        |
| React 19 / Vite 8              | UI / バンドラ                                                               |
| Vitest / Playwright            | 単体テスト・VRT / ブラウザ操作                                              |

## 必要環境

- Node.js `24.22.0`（Void の要件は 24.21 以上）、pnpm `>=11.6.0`（`mise.toml` でピン留め。`mise install` で導入）
- TypeScript はネイティブ版 [`@typescript/native-preview`](https://www.npmjs.com/package/@typescript/native-preview)（`tsgo`）

## セットアップ & コマンド

```bash
mise install                   # Node / pnpm を mise.toml のバージョンで導入
pnpm install
# .env を作る                  # docs/local-env.md の内容を書く（ダミーの認証情報が要る）
pnpm exec void db migrate      # ローカルの D1 に migration を流す
pnpm dev                       # 開発サーバー（http://localhost:5173。ADMIN_DEV_BYPASS=1 なら /admin に入れる）

pnpm typecheck                 # 型チェック（本体・VRT・scripts）
pnpm lint                      # oxlint
pnpm format:check              # oxfmt
pnpm test                      # 単体テスト
pnpm build                     # 本番ビルド
pnpm run test:vrt              # 見た目の確認（先に pnpm build。vrt/README.md）
node scripts/qa-preview.ts     # 公開側の品質確認（先に pnpm build）
node scripts/e2e-admin.mjs     # 管理画面の通しの確認（開発サーバーを起動しておく）
```

既存の記事（`content/posts/*.md`）をローカルの環境に取り込むには、開発サーバーを起動して、
`ADMIN_API_TOKEN=... node scripts/import-posts.ts http://localhost:5173`（冪等。何度流しても重複しない）。

## ディレクトリ構成

```
content/posts/*.md   既存の記事（取り込み元。取り込んだあとの正は D1）
db/                  D1 のスキーマとマイグレーション
auth.ts / env.ts     認証の設定 / 環境変数の定義
pages/ routes/ middleware/   Void のページ・ルート・ミドルウェア（管理画面は pages/admin/ と routes/api/admin/）
src/site/            公開関数・D1 の操作・R2 の読み書き・バックアップ
src/admin/           管理画面の部品
src/markdown/        自作パーサー（parse/）と描画
src/components/ src/lib/ src/og/   UI 部品・ユーティリティ・OG 画像
scripts/             取り込み・バックアップ・QA・E2E
vrt/                 ビジュアルリグレッションテスト
docs/                設計・計画・作業履歴・運用
```

設計の解説は [docs/architecture.md](docs/architecture.md)、検索の仕組みは [docs/search.md](docs/search.md)、
バックアップと復元は [docs/backup.md](docs/backup.md)、ローカルの環境変数は [docs/local-env.md](docs/local-env.md)、
判断の経緯は [docs/build-log.md](docs/build-log.md)、作り直しの計画と現在地は
[docs/void-cloudflare-rebuild.md](docs/void-cloudflare-rebuild.md) を参照。開発の方針は [CLAUDE.md](CLAUDE.md)。

## 記事の書き方

管理画面（`/admin`）の「新規作成」から書く。slug（URL）・タイトル・日付・説明・タグと、本文の Markdown を入力して、
プレビューでエラーがないことを確かめてから「公開する」。公開すると、HTML と `/posts/<slug>.md` で配信され、一覧・タグ・feed・
sitemap・検索・OG 画像に反映される。取り下げると、すべてから消える（下書きと履歴は残る）。

## デプロイ

Cloudflare にデプロイする（`pnpm exec void deploy --platform cloudflare`。2 回目以降は `--atomic` が要ることがある）。手順と、本番でしか確認できない項目は
[docs/void-spike-verification.md](docs/void-spike-verification.md) と
[docs/void-cloudflare-rebuild.md](docs/void-cloudflare-rebuild.md)（Phase 8）を参照。必要な環境変数（本番）は
`ADMIN_GITHUB_ID` / `AUTH_GITHUB_CLIENT_ID` / `AUTH_GITHUB_CLIENT_SECRET`（`void secret put`）。
