# 作業ログ — FUNSTACK 静的ブログ

参考手順書: `/Users/tsukaryu/Documents/funstack-static-test/docs/build-from-scratch.md`

このファイルは「実際にこのリポジトリでやったこと」を記録する。
タスクを終えるたびに追記していく（参考手順書はあくまで設計図、こちらは実際の作業履歴）。

## 進捗サマリ

| フェーズ | 内容 | 状態 |
| --- | --- | --- |
| 環境 | mise で Node / pnpm を固定 | ✅ 完了 |
| 0 | 前提（Node 20+ / pnpm） | ✅ 完了 |
| 1 | 初期化・依存・設定ファイル | 🚧 進行中 |
| 2 | アプリの骨組み | ⬜ 未着手 |
| 3 | コンテンツ & Markdown レンダリング | ⬜ 未着手 |
| 4 | lib（ユーティリティ & ビルド時生成） | ⬜ 未着手 |
| 5 | コンポーネント | ⬜ 未着手 |
| 6 | ページ | ⬜ 未着手 |
| 7 | build entry | ⬜ 未着手 |
| 8 | スタイル | ⬜ 未着手 |
| 9 | サンプル記事 | ⬜ 未着手 |
| 10 | ビルドと配信 | ⬜ 未着手 |

---

## ログ

### 2026-06-13 — 環境構築: mise で Node / pnpm を固定

- `mise.toml` を作成し、ツールを固定:
  - `node = "24.16.0"`（最新 LTS）
  - `pnpm = "11.6.0"`（最新）
- 当初は `node = "26.3.0"`（最新 Current）にしたが、LTS 方針に切り替え。
- 作業中に mise 本体が古く（2025.12.5）、新しい pnpm のアセット名解決に失敗したため
  `brew upgrade mise` で `2026.6.6` に更新。
- `mise trust` 済み。`mise install` で両ツールのインストール・動作確認まで完了
  （`node v24.16.0` / `pnpm 11.6.0`）。

> 備考: 参考手順書フェーズ 0 は「Node 20+（v24 系で確認）」なので、LTS 24 系で要件を満たす。

### 2026-06-13 — フェーズ1: `package.json` の整理

`pnpm init` 直後のデフォルトを参考手順書の構成に合わせて整理。

- 削除:
  - `main: "index.js"`（バンドラ構成では不要）
  - `keywords` / `author`（空のプレースホルダ）
  - `license: "ISC"`（`private: true` のため不要）
  - ダミーの `test` スクリプト
  - `devEngines` → 標準の `engines` に置き換え
- 追加・変更:
  - `private: true`
  - `description` を実態に合わせて記入
  - `scripts` を dev / build / preview / start に整備
  - `engines`（node `>=24.16.0` / pnpm `>=11.6.0`、`mise.toml` のピンと整合）
  - `packageManager: "pnpm@11.6.0"` を明示
