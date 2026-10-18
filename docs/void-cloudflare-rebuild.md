# ブログを Void + Cloudflare 構成に作り直す（D1 + 管理画面エディタ + Markdown 配信）

## 背景・目的

現状は FUNSTACK Static で全ページをビルド時に静的 HTML 化し、Vercel に置いている。記事は `content/posts/*.md` を直接編集する運用。
これを Void（Vite ベースのフルスタック SDK / CLI、Cloudflare Workers 上で動く）と Cloudflare 向けに作り直し、次を実現する。

1. 自分だけがログインできる管理画面で、Web UI から記事を書ける（その場でプレビュー）
2. 記事は DB（D1）に保存する
3. 記事は Markdown としても配信する（例: `/posts/<slug>.md`）
4. 既存の見た目・機能（タグ・検索・RSS・sitemap・OG 画像・目次・シェーダー等）は維持する

> 注意: 参考記事（azukiazusa.dev）はこの環境のネットワーク制限で取得できなかった。代わりに Void の OSS リポジトリ（voidzero-dev/void、v1.1.11 時点）の `docs/` を直接読んで確認した内容に基づく。記事固有の補足があれば着手時に追記する。

## Void の前提（リポジトリの docs で確認済み）

- アプリ種別は 3 つ: **Void アプリ**（API routes / pages mode / auth / crons / queues）、メタフレームワーク（TanStack Start, React Router 等）、静的サイト。
- **Pages mode**: `pages/` に React コンポーネントを置くとルートになり、隣の `*.server.ts` の `loader`（GET でデータ取得）と `action`（フォーム/変更）を持てる。初回はサーバーレンダリング、以降は SPA 遷移（Inertia 風）。`ssr = false` でクライアント描画にもできる。`pages/` と `routes/`（API）は併用可。React 用に `@void/react`。
- **ISR**: `void.config.ts` の `routing.revalidate`（パス別 TTL）または `.server.ts` の `export const revalidate`。**`revalidate({ paths })` / `revalidate({ all: true })`（`void/isr`）でオンデマンド無効化**できるので、記事の公開・更新時に呼べる。Cookie / Authorization 付きのリクエストはキャッシュを素通りするので管理画面と干渉しない。
- **D1**: `void/db`（Drizzle）、`void db generate` でマイグレーション生成、`void deploy` で適用。`db.batch()` 対応。
- **R2**: `void/storage` の `storage.put/get/delete`。アップロードファイルは `nosniff` と `Content-Disposition: attachment` で配信するよう注意書きあり。
- **認証**: `void/auth` が **Better Auth を設定済みで提供**（メール+パスワード、`providers: ["github"]` 等のソーシャルも可、`requireAuth(c)` で保護）。**Void 管理の認証は「ネイティブ Void アプリ」でのみ対応で、メタフレームワークでは Better Auth を自前で使う**。認証テーブルは同じ DB に作られる。
- **Markdown**: `@void/md` は `markdown-exit` + `markdown-it` プラグイン + Shiki の JS エンジン（`@shikijs/engine-javascript`）で、**純 JS なので Workers で動く**。`pages/*.md` を直接ルートにもできる。
- 設定は `void.config.ts`。シークレットは `void secret put`。

## 方針

### アーキテクチャ（推奨）: 完全静的 → Worker で動的配信 + キャッシュ

| 領域                       | 方針                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 公開ページ                 | **Pages mode**（`pages/*.tsx` + `*.server.ts`）で SSR。loader は **D1 ではなく R2 の公開スナップショットを読む**（下の「コスト方針」）。`revalidate` で ISR、公開・更新時に `revalidate({ paths })` で無効化 |
| 管理画面 `/admin`          | Pages mode の `ssr = false` ページ、または SPA。保存系は `action` / `routes/api/admin/**`（`requireAuth`）                                                                                                   |
| 記事データ                 | D1 が正。Drizzle で `posts` / `tags` / `post_tags` / `assets`                                                                                                                                                |
| Markdown 配信              | `GET /posts/:slug.md` で本文（frontmatter 付き）を `text/markdown` で返す。`<link rel="alternate" type="text/markdown">` も付与                                                                              |
| 画像                       | R2。管理画面からペースト/D&D でアップロード                                                                                                                                                                  |
| 認証                       | 自分 1 人専用。Void 組み込みの Better Auth（`providers: ["github"]` + 許可ユーザーのホワイトリスト、サインアップは自分以外拒否）か Cloudflare Access                                                         |
| feed / sitemap / 検索 / OG | ビルド時生成をやめ、Worker ルート + キャッシュ。OG は公開時に生成して R2                                                                                                                                     |

### コスト方針: D1 は管理画面専用、公開側は D1 を読まない

D1 は読み取り行数・書き込み行数での従量課金で、全件スキャンや想定外のアクセス増で請求が跳ねる事故がありうる。そのため **D1 は管理画面（認証済みの自分だけ）からのみ使い、公開側のアクセスでは一切クエリしない**構成にする。

- **D1 = 編集用の正**: 下書き・公開済みの記事、タグ、アセット管理。アクセス元は `/admin` と `/api/admin/*` のみ
- **R2 = 公開スナップショット**: 公開・更新・削除のたびに、公開側が必要とするものを R2 に書き出す
  - 記事ごと: `published/posts/<slug>.json`（frontmatter + パース済み AST + 目次）と `published/posts/<slug>.md`（`/posts/<slug>.md` 配信とバックアップを兼ねる）
  - 一覧系: `published/index.json`（記事一覧・タグ集計）、`published/search-index.json`（検索インデックス）、`feed.xml`、`sitemap.xml`、OG 画像
- **公開ページの loader は R2 を読む**（R2 は egress 無料・読み取りは安価な Class B 操作）。さらに ISR の TTL を長め（例: 1 日〜無期限）にして、更新は `revalidate({ paths })` で明示的に無効化する。R2 読み取りの回数自体も最小化する
- **ISR の更新方針（決定）**: TTL は長く（1 日〜無期限）し、公開・更新・削除の直後に `revalidate({ paths })` で関連ページを即無効化する（その記事、トップ、記事が属するタグページ、タグ一覧、feed、sitemap）。短い TTL を保険にする案は不採用（無効化の失敗は公開操作側で検知してリトライする）
- **`.md` 配信（決定）**: `/posts/<slug>.md` は R2 に保存した原文（frontmatter + 本文）をそのまま `Content-Type: text/markdown; charset=utf-8` で返す。バックアップと同一ファイル。記事ページに `<link rel="alternate" type="text/markdown" href="/posts/<slug>.md">` を付ける。`llms.txt` / `llms-full.txt` は当面作らない（必要になったら公開時の生成物として追加）。`draft` 記事は R2 の公開側には書き出さないので配信されない
- **URL（決定）**: 現行の URL 体系（`/posts/<slug>`、`/tags/<tag>` など、`.html` なし）をそのまま維持する。`/posts/<slug>/` や `/posts/<slug>.html` などの揺れは、`void.config.ts` の redirects で正規 URL へ 301。既存の被リンク・検索エンジン・RSS の購読を壊さない。移行後は旧 URL の一覧（sitemap.xml）と全件突き合わせて 200/301 を確認する
- **公開操作は 1 つの関数に集約**: D1 を更新 → スナップショットを R2 に書き出し → ISR を無効化、を同一処理で行う。途中失敗時は D1 側のステータスを公開済みにしない（再実行で冪等に直る設計）
- **D1 の使い方の規律**: すべてのクエリは索引に乗せる（`slug` unique、`status` + `date` の複合索引など）。`SELECT *` の全件取得を避け、一覧は列を絞って `LIMIT` を付ける。管理画面の一覧もページングする。`explain` で行数を確認する
- **歯止め**: Cloudflare 側に利用量アラート/予算通知を設定する。管理画面 API にもレート制限を掛ける（認証済みでも暴走を防ぐ）。Spike で実際の読み取り行数を計測する
- **検索（決定）**: 公開時に `search-index.json` を再生成して R2 に置き、現行と同じクライアント検索を維持する（D1 FTS5 は使わない。記事が大幅に増えたら再検討）

FUNSTACK Static / Router は外す。`src/components` / `src/pages` / `src/markdown` / CSS は極力流用。

### フレームワーク選択肢

- A. Void ネイティブ + Pages mode（`@void/react`）【推奨】: SSR・ISR・D1・R2・Better Auth がすべて組み込みで揃う。React をそのまま使える。
- B. framework モード（React Router / TanStack Start 等）: Void 管理の認証が使えず Better Auth を自前で統合する必要があり、層が増える。
- C. `output: "static"` で静的生成を維持し管理画面だけ Worker 化: 投稿ごとに再ビルドが要り DB の意味が薄い。却下寄り。

A で進める前提で、Phase 0 の Spike で現行の `src/markdown` レンダラーと shiki が Pages mode 上で動くことを確認する。

### 最大のリスク: ネイティブ依存が Workers で動かない

| 現在               | 問題                    | 代替候補                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ox-content/napi` | `.node` は Workers 不可 | **決定: TypeScript で Markdown パーサーを自作する**（remark 等は使わない）。現行の mdast 互換の AST を出力し、`src/markdown/` のレンダラーを流用する。詳細は下の「自作パーサー」                                                                                                                                                                                                                                                                                                                                                                                                      |
| `takumi-js`（OG）  | 同上                    | **決定: 公開時に WASM 版（`@takumi-rs/wasm`。だめなら satori + resvg-wasm）で記事ごとに生成して R2 に保存し、配信は R2 から**（長期キャッシュ付き）。デザイン（`src/og/OgCard.tsx`）は流用し、フォント（Noto Sans JP）は Worker にバンドルまたは R2 から読む。生成は公開操作の中で 1 回だけ。Worker の CPU 時間・メモリ・フォント読み込みに収まるかを Spike で確認する。不採用: 全記事共通の 1 枚（記事ごとのタイトルが出ない）、アクセス時の動的生成（CPU 時間の上限に当たりやすく、キャッシュ設計も必要）。生成に失敗しても公開は止めず、共通のフォールバック画像を返して警告を残す |
| `shiki`            | 初期化が重い            | `@shikijs/engine-javascript`（Void の `@void/md` と同じ。WASM 不要）+ 必要言語のみ。または保存時にハイライト済みを DB に持つ                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `transliteration`  | 純 JS で基本 OK         | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

プレビューにはブラウザ側のパースも必要。自作パーサーを依存ゼロの純 TS にして、サーバー（SSR / 保存時検証）とブラウザ（エディタのライブプレビュー）で同じコードを使えば、本番とのズレがなくなる。

### 自作パーサー（`src/markdown/parse/` 想定）

- **出力**: 現行 `MdastNode`（`src/markdown/types.ts`）互換の AST。レンダラー・目次抽出（`toc.ts`）はほぼ無改修で動かす
- **対応範囲（決定: 実使用の範囲だけ）**: 既存 25 記事の棚卸し結果に基づき、見出し(h2〜h6)、段落、強調(太字/斜体)、インライン/フェンスコード(言語 + `title="..."` 記法)、リンク、画像、リスト(ネスト・番号付き)、引用、表、水平線、`<url>` 自動リンクに対応する。取り消し線・タスクリスト・脚注・生の HTML・数式・参照リンクは対応しない（必要になったら足す）。未対応構文を検出したら黙って無視せず lint エラーにして気づけるようにする。CommonMark / GFM の全仕様網羅は目標にしない
- **構成**: ブロック走査（行ベース）→ インライン解析の 2 段。frontmatter は別関数で分離
- **検証**: 現行 ox-content の出力を正解として、既存 25 記事の AST をスナップショット比較（差分ゼロを目標）。構文ごとの単体テスト（vitest）を追加
- **lint**: 現行の `lintMarkdown`（重複見出し・見出しレベル飛び・連続句読点など）相当は自作パーサー上のルールとして必要最小限を実装し、エディタ上に表示し、公開時の検証にも使う（下の「検証」）
- **性能**: 保存時とプレビュー（debounce）で毎回全文パースして問題ない規模。必要なら増分パースは後回し

### ビジュアルリグレッションテスト（移行時）

移行で見た目が変わっていないことを、**Vitest の browser mode（Playwright プロバイダ）+ `toMatchScreenshot`** で保証する。

- **手順**: ① 現行（FUNSTACK / Vercel 構成）の `pnpm build && pnpm preview` に対してベースライン画像を撮る → ② 同じテストを移行後の Void 構成（`void dev` / プレビュー環境）に向けて実行し、差分を検出する。ベースラインはリポジトリにコミットする
- **対象ページ**: トップ、記事ページ（コード・テーブル・画像・引用・リスト・目次を含む代表記事を数本）、タグ一覧、タグ詳細、About、404。ビューポートはデスクトップとモバイルの 2 種
- **自作パーサーの検証と兼ねる**: AST のスナップショット比較に加え、描画結果でも既存 25 記事すべてを撮って差分ゼロを確認する（記事数が多いので全記事は軽量設定、代表記事は高精細）
- **安定化**: シェーダー（`ShaderGimmick`）や View Transition などのアニメーションは VRT 時に停止/固定、または `mask` で除外。Web フォントの読み込み完了を待ってから撮る。閾値（`comparatorOptions`）は最小限に調整
- **環境差の扱い**: スクリーンショットは OS・フォントレンダリングで差が出るため、ベースライン生成と比較は**同じ環境（Linux の Chromium、CI かコンテナ）**に揃える。ローカル Mac での実行はベースラインとは別扱いにする
- **運用**: 移行完了後も VRT は残し、意図的な見た目変更のときだけ `-u` でベースライン更新する。管理画面のエディタ/プレビュー画面も追加で撮る（プレビューが本番表示と一致することの検証にもなる）
- **Spike で確認**: `toMatchScreenshot` の対応する Vitest バージョン、Playwright の Chromium の配置、既存の `pnpm` スクリプト（`test:vrt` など）と lefthook / CI への組み込み方

### 管理画面 MVP

- 記事一覧（下書き/公開/日付/タグ）、新規・編集・削除
- エディタ（CodeMirror 6）と、プレビュー（本番と同じレンダラー・CSS）を**タブで切り替える**（決定: 左右分割はしない。却下: 左右分割＝実装は増えるが書きながら確認できる案、WYSIWYG＝Markdown が正の構成・自作パーサーと整合しにくい）。タブを切り替えたときはエディタのカーソル位置付近をプレビューでも表示する
- title / slug / date / description / tags / draft のフォーム編集
- **自動保存（決定）**: 入力が数秒止まったときだけ、編集中の内容を D1 に下書きとして保存する（入力のたびには書かない。D1 の書き込み行数を抑える）。保存先は D1 のみで、公開側の R2 は触らないので公開済みの記事は変わらない。公開済みの記事を編集する場合は「公開中の版」と「編集中の下書き」を分けて持ち、「公開」を押したときだけ公開中の版を差し替える（公開操作は上の「コスト方針」の公開関数）。未保存の変更があるままタブを閉じようとしたら警告する。非公開への切替（公開取り下げ）も明示操作
- **バージョン履歴（決定: 残す）**: 自動保存・公開に合わせて版（リビジョン）を残し、管理画面から差分確認と巻き戻しができる。D1 のコストを抑えるため、版の保存は自動保存のたびではなく「前回の版から一定時間（例: 5 分）以上経ったとき」と「公開時」に限り、記事ごとに直近 N 件（例: 30 件、公開時の版は別枠で保持）を超えたら古い順に削除する。履歴の一覧は本文を含めず列を絞って取得し、本文は選択した 1 版だけ読む。具体的な間隔・件数は Spike で行数を計測して調整（要調整）
- 下書きの持ち方（同一行に列を足すか、別テーブルにするか）は 4 番「データモデル」で詰める
- **画像アップロード（決定）**: エディタへのペースト/ドラッグ&ドロップで R2 に上げ、`![alt](/images/<ハッシュ>.webp)` を自動挿入する。WebP に変換し、横幅の上限（例: 1600px）に収めて保存する。保存キーはサーバーが決める内容ハッシュ（同じ画像は重複しない）。配信は Worker 経由で長期キャッシュ（immutable）を付け、`nosniff` を付与する。変換の実行場所（ブラウザ側 / Cloudflare Images バインディング）は Spike で確認する。不採用: 変換なしの原本アップロード（巨大画像がそのまま配信される）、Cloudflare Images（契約・課金が増える）。既存の `public/blog/*.webp` は移行時に R2 へ移し、記事中のパスを置き換える（または旧パスを維持して配信）
- **検証（決定）**: 自動保存は常に通し、書きかけの内容を失わない。**公開時にだけ**現行 `src/content.ts` と同じ検証（frontmatter の必須項目・`date` の形式・`draft` の型、link/image URL の許可スキーム `SAFE_URL`、自作パーサーの lint）を行い、エラーがあれば公開を止めて行番号付きの一覧を表示する。warning 扱いの `NON_FATAL_RULES` 相当は警告表示のみ。**プレビューにもエラーを出す**: プレビューのタブを開いたとき（内容が変わるたびに再検証）、frontmatter の問題・危険な URL・lint のエラー/警告・未対応構文を、プレビュー上部に行番号付きの一覧で表示し、クリックでエディタの該当行にジャンプできる。エラーがあっても描画できる範囲のプレビューは出し、該当箇所にもインラインでエラー印を付ける（保存・公開の可否とは独立。公開時はエラーがあれば止める）。危険な URL は保存の段階でもエディタ上にその場で警告を出す。検証ロジックはパーサーと同じく純 TS にして、エディタ（ブラウザ）と公開 API（サーバー）で共通化する。公開 API 側でも必ず再検証する（クライアントの検証は信用しない）。不採用: 保存時にも拒否する案（自動保存と相性が悪い）、警告のみで常に公開できる案（壊れた記事・危険なリンクが出る）
- lint 結果表示
- 未認証は `/admin` と `/api/admin/*` を 401/リダイレクト。CSRF 対策必須

### データモデル案

**下書き・履歴の持ち方（決定: `posts` + `post_revisions` の 2 テーブル）**。公開中の版と編集中の下書きを別の場所に置くので混ざらず、履歴も同じ仕組みで済み、「公開中との差分」も D1 だけで出せる。不採用: 1 行に公開用・下書き用の列を二重に持つ案（項目追加のたびに 2 か所を直す必要があり、履歴は結局別テーブルになる）、`posts` を下書きだけにして公開中を R2 のみで持つ案（差分表示や公開状態の一覧に毎回 R2 が要り、D1 だけでは何が公開中か分からない）。

- `posts`（**公開中の版**。管理画面の一覧はここを軽く引く）: id, slug(unique), title, description, date, tags(JSON か `post_tags`), published_revision_id, published_at, updated_at。一度も公開していない記事は `published_revision_id` が NULL
- `post_revisions`（**編集中の下書き + 履歴**）: id, post_id, kind(`draft` | `snapshot` | `published`), title, description, date, tags, body, created_at。`kind = draft` は記事ごとに 1 行だけで、自動保存はこの行を上書きする。`snapshot` は一定時間ごとの版、`published` は公開時の版（別枠で保持し、件数上限の削除対象にしない）
- 公開時: 公開 API が検証 → `post_revisions` に `published` を追加 → `posts` を更新 → R2 スナップショット書き出し → ISR 無効化（失敗時は `posts` を更新しない／再実行で冪等）
- 索引: `posts(slug)` unique、`post_revisions(post_id, kind, created_at)`。履歴一覧は本文を引かない
- **タグ（決定: 正規化テーブル）**: `tags`(id, name, slug unique) と `post_tags`(post_id, tag_id, 公開中の版に対するもの)。`post_revisions` の下書きはタグ名の配列（JSON）で持ち、公開時に `post_tags` へ反映する。管理画面ではタグ入力に既存タグを候補として出し、表記ゆれの確認・タグ名の一括変更ができる。タグごとの記事数・一覧は公開時に集計して R2 の `index.json` に書く（公開側は D1 を読まない）。不採用: `posts` に JSON 配列で持つ案（集計は全記事の読み直し、名前変更が面倒）、現行の文字列のまま持つ案（候補表示が全記事の走査になる）。`tags.slug` は `transliteration` で生成する（現行と同じ。タグページの URL 互換を保つ）
- `assets`: id, r2_key, content_type, size, post_id?
- 検索はクライアント側インデックスを公開時に再生成して R2 に置く（上の「コスト方針」）

### 既存記事の移行

- **移行方法（決定: 1 回限りのインポートスクリプト）**: `content/posts/*.md`（25 ファイル）を読み、frontmatter と本文を `posts` / `post_revisions` に入れ、同時に R2 の公開スナップショット（記事 JSON・.md・一覧・検索インデックス・feed・sitemap）も生成する。slug はファイル名から取り、`date` はそのまま引き継ぐ。`draft: true` の記事は公開せず下書き（`kind = draft`）として入れる。**冪等**にして、2 回流しても重複せず更新だけが反映されるようにする（slug をキーに upsert）。公開と同じ検証・同じ公開関数を通す。移行後は旧 sitemap.xml の全 URL と配信結果を突き合わせて確認する。不採用: 管理画面のインポート機能（1 回限りの移行には作り込みすぎ）、手作業の貼り直し（日付や内容のミスが起きやすい）
- バックアップ必須（D1 エクスポート or 公開時に R2 へ .md 保存）
- `src/content.ts` の URL 検証・frontmatter 検証・draft 除外は、保存時（API）と配信時に移植

## ブランチ戦略（決定: 統合ブランチ + `gh stack` でフェーズを積む）

`main` は Vercel の本番に繋がっており、Phase 3 で FUNSTACK を外すと本番ビルドが落ちる。そのため `main` には切り替え（Phase 8）まで触れず、**統合ブランチを trunk にして、フェーズごとの PR を [`gh stack`](https://github.com/github/gh-stack)（GitHub 公式、public preview）のスタックとして積む**。

```
main                      ← 本番（Vercel）。切り替えまで現行のまま
 └─ claude/blog-void-cloudflare-rebuild-z7elll          ← 統合ブランチ（= スタックの trunk。`gh stack init --base claude/blog-void-cloudflare-rebuild-z7elll`）
     └─ phase-2-parser          (PR → claude/blog-void-cloudflare-rebuild-z7elll)
         └─ phase-3-foundation  (PR → phase-2-parser)
             └─ phase-4-publish (PR → phase-3-foundation)
                 └─ phase-5-admin
                     └─ phase-6-og-import
                         └─ phase-7-qa / phase-9-docs
```

- **スタックの外**: Phase 0（Spike）は捨てる前提の実験なので、スクラッチ用ブランチで行い、結果だけを `docs/build-log.md` に記録する。Phase 1（VRT のベースライン）は現行サイトを撮るだけで本番に影響しないため、`main` に直接 PR（`vrt-baseline` → `main`）で入れ、`main` を `claude/blog-void-cloudflare-rebuild-z7elll` に取り込む。これで移行前の状態が `main` に残り、後の比較に使える
- **スタック内（線形）**: Phase 2 → 3 → 4 → 5 → 6 → 7 → 9 の順に積む。スタックは線形なので、Phase 2 と 3 の並行作業はせず順番に積む（パーサーは依存がないため先に積んで問題ない）。各 PR は 1 つ下の層をベースにして、差分がそのフェーズ分だけになる
- **運用**: 下の層がレビューで直ったら `gh stack rebase` / `gh stack sync` で上の層を追従させる。下の層からマージし、マージされた層は rebase が `--onto` で自動追従する。`gh stack submit` で push と PR 作成・更新を一括で行う
- **切り替え（Phase 8）**: スタックの全層が `claude/blog-void-cloudflare-rebuild-z7elll` にマージされたら、`claude/blog-void-cloudflare-rebuild-z7elll` → `main` の PR を 1 本作り、Phase 7 の受け入れ条件を満たしてからマージ。DNS 切り替えはその後
- **注意**: `gh stack` は public preview のため、コマンドや挙動が変わる可能性がある。Claude のクラウドセッションには拡張が未インストールで、PR の作成・更新は GitHub MCP 経由でも行える。使えない場合は通常の PR（ベースを 1 つ下の層に指定）で同じ構造を手で組む

## フェーズ

進め方の共通ルール: 本番（Vercel）は切り替え（Phase 8）まで現行のまま動かし続ける。フェーズごとに PR を分け（上の「ブランチ戦略」のスタック）、各コミットで `pnpm typecheck`（tsgo）が通る状態を保つ（未作成モジュール依存はスタブではなくコメントアウトで逃がす）。判断の経緯は `docs/build-log.md` に都度追記する。コード内コメントは日本語、import は subpath imports（`#*`）。

依存の順序: 0 → 1 →（2 と 3 は並行可）→ 4 → 5 → 6 → 7 → 8 → 9。

### Phase 0: 検証 Spike（捨てる前提の実験）

- [ ] 参考記事と Void docs の通りに最小の Void アプリを作り、Workers に `void deploy` できる（Node 要件の確認: README では 24.21.0 以上、現状は mise で 24.16.0 固定）
- [ ] Pages mode で SSR + `revalidate({ paths })` による即時無効化が動く
- [ ] D1 / R2 / Better Auth（GitHub OAuth）がローカルと本番で動く
- [ ] shiki（JS エンジン）、`@takumi-rs/wasm`（OG）、画像変換（WebP / リサイズ）が Workers で動く。CPU 時間・メモリを計測
- [ ] 既存 25 記事の使用構文を棚卸し（済: 結果は「自作パーサー」の対応範囲に反映）
- [ ] 結果を `docs/build-log.md` に記録。動かない前提があれば方針を見直してこの計画に反映
- **完了条件**: 上記がすべて動く、または代替案が決まっている

### Phase 1: 移行前 VRT のベースライン取得（FUNSTACK を外す前）

- [ ] Vitest browser mode + Playwright（Chromium）+ `toMatchScreenshot` を導入
- [ ] 現行サイトで主要ページ（トップ、代表記事、タグ一覧、タグ詳細、About、404）と既存 25 記事のベースラインを、デスクトップ / モバイルの 2 ビューポートで撮ってコミット
- [ ] アニメーション（シェーダー等）の停止、Web フォント読み込み待ち、閾値を調整して、連続実行しても差分が出ない（安定している）
- [ ] `test:vrt` スクリプトを追加し、CI で動かす（Linux の Chromium に環境を揃える）
- **完了条件**: 現行サイトに対して VRT を 3 回連続で流して全て green

### Phase 2: 自作 Markdown パーサー（Phase 3 と並行可）

- [ ] `src/markdown/parse/` に純 TS の依存ゼロ実装（ブロック走査 → インライン解析、frontmatter 分離）。現行 `MdastNode` 互換の AST を出力
- [ ] 対応範囲は「自作パーサー」の節のとおり。未対応構文は lint エラー
- [ ] lint（重複見出し・見出しレベル飛び・連続句読点など）と検証（frontmatter・`SAFE_URL`）を、パーサーと同じく純 TS で実装
- [ ] 単体テスト（構文ごと）と、現行 ox-content の出力との AST スナップショット比較（既存 25 記事）
- **完了条件**: 既存 25 記事の AST が現行出力と差分ゼロ（意図した差は理由を記録）、単体テスト green。ブラウザ（Vitest browser mode）とサーバー（Node / Workers）の両方で同じ結果

### Phase 3: 土台（Void 導入・FUNSTACK 撤去）

- [ ] Void 導入（`voidPlugin()` + `@void/react`）、`void.config.ts`、`pages/` / `routes/` の骨組み
- [ ] D1 スキーマ（`posts` / `post_revisions` / `tags` / `post_tags` / `assets`）と索引、マイグレーション
- [ ] `src/components` / `src/pages` / `src/markdown` / CSS を Pages mode に移植。FUNSTACK 依存と `src/app/entries.tsx` / `build.ts` を撤去
- [ ] ox-content / takumi-js のネイティブ依存を `package.json` から外す（置き換えは Phase 2 / 6 で完了していること）
- **完了条件**: `void dev` でトップ・固定ページが表示される。typecheck / lint / format green

### Phase 4: 公開関数と公開側

- [ ] 公開関数（検証 → `post_revisions` 追加 → `posts` 更新 → R2 スナップショット書き出し → ISR 無効化）。冪等で、途中失敗時は `posts` を更新しない
- [ ] 公開ページ（トップ / 記事 / タグ一覧 / タグ詳細 / About / 404）の loader は R2 のみを読む（D1 を読まないことをテストで保証）
- [ ] `/posts/<slug>.md` 配信と `<link rel="alternate" type="text/markdown">`、`feed.xml`、`sitemap.xml`、検索インデックス（`search-index.json`）
- [ ] 旧 URL の揺れ（末尾スラッシュ・`.html`）の 301、`draft` 記事が公開側に一切出ないこと
- **完了条件**: テスト用の記事を公開関数で公開すると、HTML・`.md`・feed・sitemap・検索・タグページに反映され、取り下げると消える

### Phase 5: 認証と管理画面

- [ ] Better Auth + GitHub OAuth。自分の GitHub ID 以外はサインアップ拒否。`/admin` と `/api/admin/*` は `requireAuth`、未認証は 401 / リダイレクト。CSRF・レート制限
- [ ] 記事一覧（ページング、列を絞ったクエリ）、新規作成・編集・削除、公開 / 取り下げ
- [ ] エディタ（CodeMirror 6）とプレビューのタブ切替。プレビューにエラー一覧（行番号付き、クリックで該当行へジャンプ）とインラインのエラー印
- [ ] 自動保存（入力停止の数秒後に `draft` を上書き）、未保存警告、バージョン履歴（差分確認・巻き戻し、件数上限と削除）
- [ ] 画像アップロード（ペースト / ドラッグ&ドロップ → WebP 変換 → R2 → Markdown に自動挿入）と配信（長期キャッシュ・`nosniff`）
- [ ] タグ入力（既存タグの候補、表記ゆれの確認、タグ名の一括変更）
- **完了条件**: 自分のアカウントで記事を新規作成 → 画像を貼る → プレビューでエラーを確認 → 公開 → 公開側に反映、までを通しで実行できる。他アカウントでは入れない

### Phase 6: OG 画像・移行・バックアップ

- [ ] OG 画像を公開時に WASM で生成して R2 に保存・配信（失敗時はフォールバック画像 + 警告）
- [ ] 冪等なインポートスクリプトで既存 25 記事を D1 / R2 に取り込む（`draft: true` は下書き）。既存の `public/blog/*.webp` を R2 へ移す
- [ ] バックアップ: R2 の .md に加え、D1 のエクスポートを定期的に取得する手順
- **完了条件**: インポートを 2 回流しても重複しない。全 25 記事が公開側に表示される

### Phase 7: 品質確認（移行前後の比較）

- [ ] VRT（Phase 1 のベースライン）を Void 構成に向けて実行し、差分ゼロ（意図した変更は理由を添えてベースライン更新）
- [ ] 旧 sitemap.xml の全 URL を新環境に対して突き合わせ、200 または 301 であることを確認（404 ゼロ）
- [ ] RSS が購読リーダーで正常に取得できる、OG 画像が SNS のプレビューで表示される
- [ ] D1 の読み取り行数を計測し、公開側のアクセスで D1 が 0 回であることを確認。Cloudflare の利用量アラートを設定
- **完了条件**: 下の「受け入れ条件」を全て満たす

### Phase 8: 切り替え

- [ ] `tsuka-ryu.dev` のカスタムドメインを Cloudflare に向ける（DNS の TTL を事前に下げておく）。シークレットを `void secret put` で投入
- [ ] 切り替え直後に主要 URL・feed・OG を確認。問題があれば DNS を戻して Vercel に切り戻せる状態を一定期間維持
- [ ] 問題なければ `vercel.json` と Vercel プロジェクトを撤去
- **完了条件**: 本番ドメインで新構成が配信され、切り戻し期間（例: 1 週間）を問題なく経過

### Phase 9: ドキュメント

- [ ] `docs/build-log.md` に採用理由・却下した代替案・ハマりどころを追記
- [ ] `docs/architecture.md` を新構成に更新（`docs/search.md` も）
- [ ] `CLAUDE.md` の「ディレクトリ構成」「環境」を更新

## 決定事項

- **認証**: Void 組み込みの Better Auth + GitHub OAuth（`providers: ["github"]`）。自分の GitHub ID 以外はサインアップ拒否。却下: Cloudflare Access（ローカル開発で認証が効かず、Zero Trust 設定が別途必要）、メール+パスワード（パスワード管理と 1 人限定の追加実装が要る）
- **記事の置き場**: D1 が唯一の正。公開・更新のたびに `.md` を R2 にも保存し、バックアップ兼 `/posts/<slug>.md` 配信の元にする。却下: Git への二重管理（API 権限・失敗時リトライ・D1 との不一致対応が増える）、Git を正にする案（ブラウザ管理画面の要件と合わない）
- **Markdown パーサー**: TypeScript で自作。却下: remark/unified（依存が重く、方針として自作したい）
- **Void の成熟度リスク**: Void は 2026-10 に OSS 化されたばかり（v1.1.11 時点）。**特別な備えはせず最新版に追従する**。バージョン固定・薄いラッパー・素の Hono 構成への逃げ道は用意しない。不採用: バージョン固定 + ラッパー、Void 機能を最小化する構成（Void を使う利点が薄れる）。ただし、依存の更新で壊れたときに気づけるよう、移行後も VRT と型チェック・lint を CI で回し続ける

未決事項: なし。着手後の Spike（Phase 0）で確認する項目は各フェーズで検証する。

## 受け入れ条件

**機能**

- 自分の GitHub アカウントだけが管理画面にログインでき、他のアカウントは入れない（`/api/admin/*` も 401）
- 記事の作成・編集・削除・公開・取り下げができ、公開済み記事を編集しても「公開」を押すまで公開側は変わらない
- 自動保存で書きかけが失われず、バージョン履歴から差分確認と巻き戻しができる
- プレビューが本番と同じレンダラー・CSS で表示され、frontmatter・危険な URL・lint・未対応構文のエラーが行番号付きで出る。エラーがあると公開できない（公開 API 側でも再検証される）
- 画像をペーストするだけで R2 に保存され、Markdown に挿入される
- 公開記事が HTML と `/posts/<slug>.md`（frontmatter 付きの原文）の両方で配信され、`draft` や未公開の記事はどちらにも出ない

**移行・互換**

- 既存 25 記事が欠落なく移行され（`draft: true` は下書き）、本文・日付・タグが一致する
- 旧 sitemap.xml の全 URL が新環境で 200 または 301 になり、404 がない。タグ URL（`/tags/<tag>`）も変わらない
- RSS（`feed.xml`）・sitemap・検索・OG 画像が現行と同等に動く
- VRT（移行前ベースライン対比）が、主要ページと既存 25 記事で差分なし（意図した変更を除く）。自作パーサーの AST が既存 25 記事で現行出力と一致する

**コスト・運用**

- 公開側のアクセスで D1 へのクエリが 0 回（テストと、本番での読み取り行数の計測で確認）。D1 のクエリはすべて索引に乗り、管理画面の一覧はページングされる
- Cloudflare の利用量アラートが設定されている。D1 のバックアップ手順がある
- 公開操作が冪等で、途中失敗しても再実行で整合する

**品質・ドキュメント**

- `tsuka-ryu.dev` が Cloudflare から配信され、切り戻し期間を問題なく経過する
- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` と VRT が CI で green
- `docs/build-log.md`・`docs/architecture.md`・`CLAUDE.md` が新構成に更新されている

## 参考

- https://azukiazusa.dev/blog/void-vite-cloudflare-deploy
- https://void.cloud/guide/quickstart / https://void.cloud/guide/deployment / https://void.cloud/reference/config
- https://github.com/voidzero-dev/void
