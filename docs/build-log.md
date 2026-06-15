# 作業ログ — FUNSTACK 静的ブログ

参考手順書: `/Users/tsukaryu/Documents/funstack-static-test/docs/build-from-scratch.md`

このファイルは「実際にこのリポジトリでやったこと」を記録する。
タスクを終えるたびに追記していく（参考手順書はあくまで設計図、こちらは実際の作業履歴）。

## 進捗サマリ

| フェーズ | 内容                                 | 状態    |
| -------- | ------------------------------------ | ------- |
| 環境     | mise で Node / pnpm を固定           | ✅ 完了 |
| 0        | 前提（Node 20+ / pnpm）              | ✅ 完了 |
| 1        | 初期化・依存・設定ファイル           | ✅ 完了 |
| 2        | アプリの骨組み                       | ✅ 完了 |
| 3        | コンテンツ & Markdown レンダリング   | ✅ 完了 |
| 4        | lib（ユーティリティ & ビルド時生成） | ✅ 完了 |
| 5        | コンポーネント                       | ✅ 完了 |
| 6        | ページ                               | ✅ 完了 |
| 7        | build entry                          | ✅ 完了 |
| 8        | スタイル                             | ✅ 完了 |
| 9        | サンプル記事                         | ✅ 完了 |
| 10       | ビルドと配信                         | ✅ 完了 |
| 11       | README 追加                          | ✅ 完了 |
| 12       | 現行サイトの記事を移行               | ✅ 完了 |
| 13       | サイトデザインの見直し               | ✅ 完了 |

> フェーズ 11 以降は設計図（build-from-scratch.md）の範囲外で、本リポジトリ独自の追加フェーズ。
>
> - 11: プロジェクト直下に README を追加（概要・構成・開発/ビルド手順など）。
> - 12: 既存ブログ tsuka-ryu's blog（`tsuka-ryu-s-blog`）の実記事を移行。フェーズ9 で見た
>   strict lint の誤検知（`repeated-word` / `repeated-punctuation`）への対応もここで行う。
> - 13: サイトデザインの見直し（テンプレ然とした見た目を tsuka-ryu.dev 寄りに調整等）。

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

### 2026-06-13 — TypeScript ネイティブ版（tsgo）の導入

「TypeScript 7 系にしたい」が出発点だが、npm の `typescript` は `latest=6.0.3` までで
7.x は未公開（`next` も `6.0.0-dev` 系）。代わりに Go 製ネイティブ版プレビューを採用。

- `@typescript/native-preview`（`7.0.0-dev.20260612.1`）を devDependency に追加。
  - `tsgo` バイナリを提供。`pnpm exec tsgo --version` で動作確認済み。
- 既存の `typescript` 6 系はエディタ／型解決の互換のため残置（併存）。
- `scripts.typecheck` を `tsgo --noEmit` で追加（tsconfig.json 作成後に有効化）。

> メモ: `typescript` 7 系が正式公開されたら本体も差し替え検討。

### 2026-06-13 — `typescript` 6 を削除しネイティブ版に一本化

native-preview にはエディタ対応（VS Code 拡張「TypeScript (Native Preview)」＋
設定 `typescript.experimental.useTsgo`）が存在することを確認（microsoft/typescript-go）。
LSP は "nearly all features implemented" 段階。エディタも tsgo で動かせるため 6 を撤去。

- `pnpm remove typescript`（6.0.3 を削除）。peer に要求するパッケージは無く影響なし。
- `.vscode/settings.json` に `"typescript.experimental.useTsgo": true` を追加。
  - 各自 VS Code 拡張「TypeScript (Native Preview)」を入れるとエディタも tsgo になる。
- 型チェックは CLI / エディタとも tsgo に統一。

### 2026-06-13 — フェーズ1: `tsconfig.json` 作成（tsgo 対応）

参考手順書の tsconfig をベースに作成。tsgo（typescript-go の drop-in 互換）で
全オプションが通ることを確認済み。

- `target` / `lib` は手順書の `ES2022` から **`ESNext`** に変更（最新機能を使う方針）。
  - tsgo が `ES2023`/`ES2024`/`ES2025`/`ESNext` を受理することを probe で確認。
  - 実トランスパイルは Vite(esbuild) が担うため、ここは型・lib グローバル用途。
- その他は手順書どおり: `module: ESNext` / `moduleResolution: bundler` /
  `jsx: react-jsx` / `strict` 一式 / `verbatimModuleSyntax` / `isolatedModules` /
  `allowImportingTsExtensions` / `noEmit` など。
- `include: ["src", "vite.config.ts"]`。現状この2つが未作成のため
  `pnpm typecheck` は `TS18003: No inputs were found` を返すが、これは想定内
  （設定の互換エラーではない）。`src/` 追加後に解消する。
- 追加した厳格化オプション（いずれも tsgo で互換確認済み）:
  - `moduleDetection: "force"`（全ファイルをモジュール扱い）
  - `noUncheckedIndexedAccess: true`（`arr[i]`/`obj[key]` を `T | undefined` に）
  - `noImplicitOverride: true`（`override` キーワード強制）
- 見送り（記事レンダリング着手後に判断）: `exactOptionalPropertyTypes`、
  `noUncheckedSideEffectImports`（CSS の副作用 import 検査。`vite/client` 追加後に有効化）。

### 2026-06-13 — `.gitignore` 拡充 & `src/vite-env.d.ts` 追加

- `.gitignore` を手順書ベースに拡充（`.pnpm-store/` `build/` `.vite/` `.env*`
  `*.tsbuildinfo` `.cache/` など）。
  - 手順書は `.vscode/` を丸ごと無視するが、tsgo 用に `.vscode/settings.json` を
    意図的に追跡しているため `.vscode/*` + `!.vscode/settings.json` に調整。
- `src/vite-env.d.ts` を追加（`/// <reference types="vite/client" />`）。
  - これで `src/` に入力ファイルができ、`pnpm typecheck`（tsgo）が `TS18003` を
    出さず exit 0 になることを確認。

### 2026-06-13 — `vite.config.ts` 作成（フェーズ1完了）

手順書どおりに作成。コメントは日本語に統一。

- `funstackStatic({ entries: "./src/entries.tsx", build: "./src/build.ts", ssr: true })`
  と `react()` を plugins に設定。
- ネイティブ（NAPI）モジュール `@ox-content/napi` / `takumi-js` / `@takumi-rs/core` は
  `ssr.external` と `optimizeDeps.exclude` で除外（`.node` バイナリのバンドル回避）。
- tsgo 型チェック exit 0（`@funstack/static` のオプション型と整合）。
- `entries.tsx` / `build.ts` は未作成のため `vite build` はフェーズ2以降に実施。

> 補足: VS Code の Vitest 拡張が別ワークスペースフォルダ `uhyo/funstack-static`
> （パッケージ本体・`dist` 未ビルド）で `@funstack/static` 解決に失敗するエラーが出るが、
> 本ブログとは無関係（本ブログ側は `dist/index.mjs` 同梱で解決OK）。

### 2026-06-13 — フェーズ2: アプリの骨組み（5ファイル）

手順書どおりに骨組みを作成。コメントは日本語に統一。

- `src/Root.tsx` — HTML シェル（Server Component）。RSS リンクを `<head>` に配置。
- `src/ClientApp.tsx` — `@funstack/router` の `<Router>` をラップする Client Component。
- `src/App.tsx` — ルート定義。`getAllPosts()`/`getAllTags()` から記事・タグルートを動的生成。
  `defer()` で各ページを独立 RSC ペイロード化。
- `src/entries.tsx` — ルートツリーを走査し `/`→`index.html`、`/posts/x`→`posts/x.html`、
  `/*`→`404.html` に変換する `getEntries()`。
- `src/Counter.tsx` — Client Component の島デモ。
- tsgo 結果: エラー10件はすべて `App.tsx` が参照する**未作成モジュール**
  （`components/` `pages/` `content.js`）由来＝フェーズ3〜6で解消予定。骨組み4ファイル
  （Root/ClientApp/entries/Counter）自体はエラーなし。`ClientApp` の `./styles.css`
  （フェーズ8）は副作用 import なので未検査でエラーにならない。
- 方針: スタブ作成はコミットがノイジーになるため不採用。代わりに `App.tsx` の
  **未作成モジュール依存行をコメントアウト**し、`routes` を空配列にして現状で
  tsgo exit 0 を確保。フェーズ3〜6で各モジュールを作るたびに該当コメントを外す。
  （`entries.tsx` は空 `routes` でもそのまま通る。）

### 2026-06-13 — ディレクトリ構成の見直し（src/app/ に結線集約）

手順書のフラット構成は src 直下が散らかるため、結線系を `src/app/` に集約。

- 移動: `Root.tsx` `App.tsx` `ClientApp.tsx` `entries.tsx` → `src/app/`、
  `Counter.tsx` → `src/components/`。
- 参照更新: `Root` → `../constants.js`、`ClientApp` → `../styles.css`、
  `App` のコメント中パスを `../components` `../pages` `../content` に、
  `vite.config.ts` の `entries`/`build` を `./src/app/...` に。
- tsgo exit 0 を維持。構成方針は `CLAUDE.md` に明文化。
- 個別定数は `src/constants.ts`（`SITE_TITLE`）に集約。手順書の `lib/site.ts` 相当は
  ここに寄せる方針（後フェーズで統合）。
- `Root.tsx` に役割を説明する日本語コメントを関数直上に追加。

### 2026-06-13 — subpath imports 導入・各ファイルに役割コメント

- package.json に `"imports": { "#*": "./src/*" }` を追加（tsgo で解決を検証済み）。
  既存 import を相対パスから `#constants.js` / `#app/App.js` 等に統一。`../` を撤廃。
  方針は `CLAUDE.md` に明文化。
- フェーズ2の各ファイル（Root / ClientApp / App / entries / Counter）の主要関数に
  日本語の役割コメントを追加。Root の `<head>` 内インラインコメントは役割コメントと
  重複するため削除。

### 2026-06-13 — 島デモを Counter → シェーダーに差し替え

- `Counter.tsx` を削除し、`src/components/ShaderGimmick.tsx` を新規作成。
- `@paper-design/shaders-react`（`GrainGradient`）を**バージョン固定 `0.0.76`**で導入
  （0.0.x で破壊的変更が入るため exact 指定。react ^18||^19 対応）。
- 参考: `tsuka-ryu-s-blog` の `about/page.client.tsx`（Gimmick）。Next 固有の
  `next/dynamic`(`ssr:false`) と `next-themes` を除去し、**マウント＋400ms 遅延後に
  だけ描画する client-only ガード**（`useState`+`useEffect`+`setTimeout`）に置換。
  色は固定パレット（テーマ機構は未導入）。
- tsgo exit 0。未使用の島デモ（後でホームのヒーロー等に組み込み可）。

### 2026-06-14 — フェーズ3: コンテンツ & Markdown レンダリング（7ファイル）

手順書フェーズ3どおりに作成。コメントは日本語に翻訳、import は subpath（`#*`）に統一。
依存の末端から作成し、各段階で tsgo green を維持。

- `src/markdown/types.ts` — ox-content の mdast ノードのゆるい型 `MdastNode`、
  ノード型 → コンポーネントのレジストリ型 `MarkdownComponents`。
- `src/lib/toc.ts` — 見出しスラッグ付与（`slugify`、Unicode 文字を残し日本語見出し対応）と
  目次抽出（`extractToc`、h2〜h3、mdast に id を破壊的付与して返す）。`TocEntry`。
- `src/markdown/render.tsx` — `renderChildren` / `MarkdownNode`（type でレジストリ参照、
  未知は `unknown` フォールバック）。
- `src/markdown/highlight.ts` — shiki ハイライト（**ビルド時のみ**）。github-light/dark の
  デュアルテーマを CSS 変数で出力（`defaultColor: false`）。
  - shiki v4 で `codeToTokens` の `lang` 型が厳格化（`BundledLanguage | SpecialLanguage`）。
    手順書（`string`）のままだと TS2322。`isBundledLanguage` で絞った値を
    `BundledLanguage` にキャストし、未対応・未指定は `"text"` にして解消。
- `src/markdown/components.tsx` — mdast 各ノード → Server Component の既定レジストリ
  `defaultComponents`。`CodeBlock` は async SC で shiki トークンを自前 `<span>` 描画
  （`dangerouslySetInnerHTML` 不要）。`Heading` は extractToc の id を出力。
- `src/markdown/index.tsx` — `<Markdown root components>` 入口（components を
  defaultComponents にマージ）。型・サブモジュールを再エクスポート。
- `src/content.ts` — `import.meta.glob("../content/posts/*.md", { query:"?raw", eager })`
  で全記事を生文字列読み込み →`prepareSource`(frontmatter 分離)→`parse`(mdast)→
  `extractToc`。`getAllPosts`/`getPostBySlug`/`getAllTags`/`getTagBySlug`/`tagSlug`。
  ネイティブ（ox-content）はビルド時サーバーのみで動きクライアントに載らない設計。
- tsgo exit 0。`App.tsx` の content/pages 依存ルートはまだコメントのまま
  （`postRoutes`/`tagRoutes` は PostPage/TagPage = フェーズ6 に依存するため）。
  content.ts は src 配下で常時型検査され、未 import でも緑。
- まだ `content/posts/` に記事が無いため glob は空配列（型検査は glob を実行しないので影響なし）。
  サンプル記事はフェーズ9で追加。

### 2026-06-14 — リファクタ: MdastNode を判別可能ユニオン化（オプショナル撲滅）

`MdastNode` がレンダラーの全フィールドを optional で抱える「ゆるい 1 形」だったのを、
`type` で判別する判別可能ユニオンに変更。各ノードは自分の variant に必要なフィールド
だけを持つ。幽霊型は実データ差なので不適、tagged union が正解という整理。

- `src/markdown/types.ts` — `MdastNode` を union 化。テーブルは `TableRow`/`TableCell` を
  別型にし `children` の型を連鎖（`in` 無しで辿れる）。`NodeProps<T>`（`Extract` で
  variant を引く props ヘルパー）を追加。レジストリ型 `MarkdownComponents` /
  `MarkdownComponentProps` は廃止。
- `src/markdown/components.tsx` — レジストリ（`Record<string,...>`）を廃し、`MarkdownNode` を
  **switch ディスパッチ**に。各 case で `node` が自動 narrowing され**相関キャストはゼロ**。
  各コンポーネントは `NodeProps<"heading">` 等で自分の variant のみ受け取り、optional 由来の
  防御コード（`?? 1` 等）も除去。相互再帰のため `renderChildren` を同居。
  - レジストリの相関キャスト（TS #30581）は zod では消せない（値検証であって 2 値の相関は
    作れない）。override 機能は不要との判断で switch に倒して構造的に解消した。
- `src/markdown/render.tsx` — 削除（内容は components.tsx に同居）。
- `src/markdown/index.tsx` — `components` オーバーライド機能を削除。`Markdown` は `root` のみ。
- `src/lib/toc.ts` — 任意ノードを舐める `nodeText`/`walk` を `"value" in node` /
  `"children" in node` で narrowing。
- 残るキャストは `Unknown`（switch の `default`、型上 `never`）1 箇所のみ。union 外の type を
  ox-content が吐いた時のビルド保険で、相関キャストとは別物の境界キャスト。
- tsgo exit 0。`<Markdown>` はまだ未描画（フェーズ6 で消費）のため外部影響なし。

### 2026-06-14 — content.ts のビルド時検証を強化（frontmatter / parse / lint）

`src/content.ts` のレビューを起点に、壊れた記事をビルドに通さない方針へ寄せた。
記事はまだゼロ（`content/posts/` 未作成）なので既存への影響なし。最初の記事から効く。

- **frontmatter 検証** — `prepared.frontmatter as PostFrontmatter` の無検証キャストを
  `assertFrontmatter` に置換。`frontmatter` がオブジェクトであること、`title` が非空文字列、
  `date` が `YYYY-MM-DD`（`DATE_PATTERN`）であることを検証し、満たさなければ `throw`。
  - 当初「日付表記の統一を oxlint でできないか」を検討したが、oxlint は JS/TS コード用で
    `.md` の frontmatter（データ）は対象外。frontmatter スキーマは linter の守備範囲外なので
    ビルド時検証側（`assertFrontmatter`）で持つ住み分けにした。
- **parse エラー** — `console.warn` で握りつぶしていたのを `throw` に変更。
  `parsed.errors` があればビルド失敗。
- **Markdown lint 導入** — `@ox-content/napi` の `lintMarkdown` を本文（`prepared.content`）に
  適用する `lintPost` を追加。有効ルール: `duplicateHeadings` / `headingIncrement` /
  `maxConsecutiveBlankLines:1` / `repeatedPunctuation` / `repeatedWords` / `trailingSpaces`。
  - 実物で確認したところ、これらのルールは全て `severity:"warning"` を返し `errorCount` は
    0 のまま。`errorCount>0` だけだとビルドが止まらないため、**`error` か `warning` があれば
    `throw`**（`info` は `console.warn` のみ）にして strict 運用。
  - `spellcheck` は日本語で誤検知が多いため無効。
  - lint は frontmatter を除いた本文に当てる（診断の行番号は本文基準）。
- **`getAllPosts` のコピー返し** — 内部 `posts` の参照をそのまま返していたのを `[...posts]` に。
  呼び出し側の `sort` 等で内部配列が破壊されるのを防ぐ。
- インラインテスト（Vitest in-source）も検討したが、Vitest 未導入で一式の設定が要るため見送り。
- tsgo exit 0。コミット `c4e7c89`。

### 2026-06-14 — markdown レンダラーのレビュー対応 & URL スキーム検証

`src/markdown/components.tsx` のレビューを起点に、レンダラーの小改善とビルド時の
URL 安全性検証を追加した。記事はまだゼロのため既存への影響なし。

- **外部リンク判定** — `src/markdown/components.tsx` の `Link` で `node.url.startsWith("http")`
  を `EXTERNAL_URL = /^(https?:)?\/\//` に変更。`//example.com`（プロトコル相対）も外部扱いに
  なり、`target="_blank"` / `rel="noopener noreferrer"` が付く。`httpx://` の誤検出も解消。
- **タスクリスト判定** — `ListItem` の `node.checked === true || node.checked === false` を
  `typeof node.checked === "boolean"` に簡潔化（意図は同一）。
- **画像** — `<img>` に `loading="lazy"` / `decoding="async"` を付与。
- **URL スキーム検証（ビルド時）** — `src/content.ts` に `SAFE_URL` allowlist と再帰走査
  `validateUrls` を追加。link/image の `url` を検証し、`javascript:` / `data:` / `vbscript:`
  等の危険スキームを含む記事はビルド失敗に。許可: http(s) / mailto / tel / 絶対パス(/) /
  相対パス(./ ../) / フラグメント(#) / 拡張子付き素パス。パース直後（`extractToc` の前）に実行。
  - DOMPurify も検討したが不採用。当レンダラーは `dangerouslySetInnerHTML` を避けて React
    要素を直接組むため、サニタイズ対象の HTML 文字列が存在しない。`href`/`src` のスキーム検証は
    allowlist の方が適切で、ビルド時に寄せればランタイムコストもゼロ。
  - `validateUrls` は `"children" in node` で再帰する汎用走査。将来 image の width/height
    注入を入れる際もこの走査に相乗りできる形にした。
- **width/height 必須化は保留** — 「リモート画像も許可」方針だと、型で必須化した瞬間にリモート
  画像が寸法解決できずビルド失敗になり衝突する。リモート寸法の取得戦略（ビルド時 fetch か
  Markdown 明示記法か）が決まってから、ビルド時注入＋型必須化を一括で入れる方針。
- tsgo exit 0。`SAFE_URL` は実例 14 ケースで判定を確認済み。

### 2026-06-14 — フェーズ3 コードレビュー完了

フェーズ3（コンテンツ & Markdown レンダリング）のコードレビューを一通り実施。

- `src/markdown/components.tsx` — レビュー＋修正（外部リンク判定の正規表現化 / タスク判定の
  `typeof` 化 / `img` への `loading`・`decoding` 付与）。コミット `d06c70f`。
- `src/content.ts` — URL スキームのビルド時検証（`SAFE_URL` / `validateUrls`）を追加。同上。
- `src/markdown/highlight.ts` — レビューの結果、変更なしで OK と判断。shiki の実機確認で
  `token.htmlStyle` がオブジェクト（`--shiki-light/dark`）を返すこと、`rootStyle` が
  カスタムプロパティのみで `defaultColor:false` により React の camelCase 問題を回避できること、
  言語エイリアス（js/ts 等）が `bundledLanguages` に含まれることを確認。
- `src/markdown/index.tsx` / `src/lib/toc.ts` はユーザー判断でレビュー不要としてスキップ。

次回は **フェーズ4: lib（ユーティリティ & ビルド時生成）** から再開する。

### 2026-06-14 — フェーズ4: lib（ユーティリティ & ビルド時生成）

設計図フェーズ4の lib 群を実装し、続けて 1 ファイルずつレビューして調整した。
`src/lib/toc.ts` はフェーズ3で先行作成済みのため、残りの time / feed / search / og と
OG カード・日本語フォントを追加。いずれも記事がまだゼロのため、生成物の実行確認は
記事投入後（後フェーズ）。以下はレビュー反映後の最終状態。

- **`src/constants.ts`** — 設計図の `lib/site.ts` は作らず、CLAUDE.md 方針どおり
  constants に集約。`SITE_TITLE`（既存）に加え以下を追加:
  - `SITE_DESCRIPTION = "tsuka-ryuの個人ブログ"`（既存ブログ tsuka-ryu's blog の
    メタデータから流用）。
  - `SITE_URL = "https://tsuka-ryu.dev"`（本番オリジン。末尾スラッシュなし）。
  - `SITE_TIME_ZONE = "Asia/Tokyo"`（サイト全体の基準 TZ。後述の JST 統一の単一情報源）。
- **時刻は JST に統一（サーバー/クライアント共通）** — 時間処理を `src/lib/time.ts` に
  集約し、`Temporal.Now` を裸で呼ばず必ず `SITE_TIME_ZONE` 固定で扱う方針にした。SSG は
  サーバー（ビルド）とクライアント（ハイドレーション）で結果一致が必要なため、システム
  TZ 依存だとズレる。`#lib/time.js` 経由に揃えることで一致を保証する。
- **`src/lib/time.ts`（新規、`format.ts` を統合・置換）** — 時刻処理の単一モジュール。
  - `formatDate(date)` → "2026年6月7日"。`Temporal.PlainDate`（TZ なし暦日）なので表示は
    環境非依存。`month` は 1 始まりで `+1` 不要。日付妥当性は content.ts の frontmatter
    検証で担保済みのため、不正値は `PlainDate.from` の `RangeError` でビルドを落とす
    （握り潰さない＝レビューで try/catch を撤去）。
  - `nowInTokyo()` → `Temporal.Now.zonedDateTimeISO(SITE_TIME_ZONE)`。
  - `dateInTokyo(date)` → 記事日付を JST 0 時の `ZonedDateTime` に。
  - `toRfc822(zdt)` → RSS 用 RFC 822。オフセットは ZonedDateTime の実値（JST なら +0900）。
  - ※当初 `format.ts` として作成しレビュー済みだったが、「時刻まわりは全部統一」の方針で
    `time.ts` に集約し `format.ts` は削除。
- **`src/lib/feed.ts`** — RSS 2.0（`buildRssFeed`）と sitemap.xml（`buildSitemap`）を
  ビルド時生成。`getAllPosts` / `getAllTags` と `SITE_*` 定数を参照。XML エスケープと
  `SITE_URL` 基準の絶対 URL 解決を内包。pubDate / lastBuildDate は `#lib/time.js` 経由で
  JST 固定（`Sun, 07 Jun 2026 00:00:00 +0900` を実機確認）。sitemap の `/about`・`/tags` は
  フェーズ6のページ前提のハードコードで、結合解消を TODO コメントとして明記。
- **`src/lib/search.ts`** — `@ox-content/napi` の `buildSearchIndex` /
  `generateSearchModuleFromOptions` で検索インデックス JSON とクライアント用の
  純 JS BM25 ランタイムを生成。ネイティブモジュールはブラウザに出さない設計。本文収集は
  判別ユニオン `MdastNode` に合わせ `"value" in node` ガードで走査。`code` と `heading` は
  早期 return（レビューで heading を body に含めない＝見出し語の二重計上を解消）。
  仕組みは別途 `docs/search.md` に文書化し、コード冒頭から参照を張った。
- **`docs/search.md`（新規）** — 検索の仕組み（ビルド時生成→静的ファイル配信→クライアント
  ランタイムのデータフロー、`JsSearchDocument` のフィールド、`collectContent` の収集ルール、
  オプション、ネイティブモジュールがブラウザに来ない理由）を図入りで解説。
- **`src/og/OgCard.tsx`** — 1200×630 の OG カード。DOM/RSC ではなく Takumi が解釈する
  要素ツリーのため、多子ボックスは `display: flex`、テキストは "Noto Sans JP" 指定。
  同梱フォントの内蔵 family 名が "Noto Sans JP" であることを確認済み（豆腐回避）。
- **`src/lib/og.ts`** — Takumi（`takumi-js` の `render`）で記事ごとの OG PNG を
  `<outDir>/og/<slug>.png` に書き出す。フォントは `process.cwd()` 基準で
  `src/og/fonts/NotoSansJP-Bold.ttf` を読む。レビューで以下を反映:
  - render は CPU バウンドなため、`OG_CONCURRENCY = 4` 件ずつのバッチで並列数を制限。
  - 絵文字は `emoji: "twemoji"` を明示（SVG をビルド時に CDN 取得して描画）。全記事で
    `resourcesOptions.cache`（`Map`）を共有し、同一絵文字の再取得を防止。
- **日本語フォント同梱** — Takumi 既定フォントは CJK 非対応のため Noto Sans JP Bold
  （約 5.3MB）を `src/og/fonts/` に取得・コミット。
- **`@types/node` 導入 & tsconfig 調整** — og.ts が `node:fs/promises` / `node:path` /
  `process` を使うため、`@types/node@24` を devDependencies に追加し、tsconfig の
  `types` を `["node", "react", "react-dom"]` に拡張（設計図では未記載だった前提を補完）。
  後続フェーズの build entry（`src/app/build.ts`）も node ビルトインを使うため必須。
- **`temporal-polyfill-lite` 導入** — 時間処理は `Date` ではなくこの軽量 Temporal
  ポニーフィル（ESM-only / 型同梱）に統一。`import { Temporal } from "temporal-polyfill-lite"`
  の ponyfill 形（global は汚さない）。`moduleResolution: bundler` 前提を満たす。
- subpath imports（`#content.js` / `#constants.js` / `#lib/*.js` / `#og/*.js`）で結線。
  feed / search / og は build entry 未作成でも単独で完結する（依存は content / 定数のみ）。
- `pnpm typecheck`（tsgo）exit 0。

### 2026-06-14 — ドキュメント更新（architecture.md をフェーズ4反映）

フェーズ4の実装・レビューを受けて `docs/architecture.md` を更新。

- 全体像の生成物に OG 画像を追加。
- サーバー/クライアント境界の表に「OG 画像生成 / 検索インデックス構築 / RSS・sitemap 生成」
  の 3 行を追加（いずれもビルド時・サーバーのみ）。
- ディレクトリ構成に `lib/`（time / feed / search / og）と新規 `og/`（OgCard + fonts）、
  `constants.ts` の追加定数を反映。
- 新セクション「lib とビルド時生成（フェーズ4）」を追加。JST 固定の設計理由
  （ハイドレーション不一致回避）・`temporal-polyfill-lite`・feed・search（→ docs/search.md）・
  og の解説を記載。
- 「まだ無いもの」表からフェーズ4の行を削除。
- 検索の仕組みは別ドキュメント `docs/search.md`（フェーズ4で新規作成）に集約済み。

### 2026-06-14 — フェーズ5: コンポーネント（8ファイル）

設計図フェーズ5の UI 部品を `src/components/` に作成。コメントは日本語、import は
subpath（`#*`）に統一。依存の末端（葉）から作り、各段階で tsgo green を維持。

- `Footer.tsx` — 静的フッター（Server Component）。
- `Header.tsx` — `"use client"`。`useLocation` で現在地を取りナビをアクティブ表示。
- `TagList.tsx` — タグを `/tags/<slug>` リンクに。`tagSlug`（`#content.js`）を参照。
- `PostToc.tsx` — `extractToc` の id へのアンカーのみで構成（クライアント JS 不要）。
  `TocEntry`（`#lib/toc.js`）の depth/text/id を使用。最小 depth を 0 起点にインデント。
- `PostCard.tsx` — 記事サマリーカード。`Post`（`#content.js`）と `TagList` を消費。
  **設計図の差分**: 設計図は `lib/format.js` の `formatDate` を参照するが、本リポジトリは
  時刻処理を `lib/time.ts` に集約済みのため `#lib/time.js` から取る。
- `Seo.tsx` — React 19 の `<head>` 巻き上げを利用したメタデータ出力。
  **設計図の差分**: 設計図は `lib/site.ts` の `site.{name,url,description}` を参照するが、
  本リポジトリは `constants.ts` に集約しているため `SITE_TITLE`/`SITE_URL`/`SITE_DESCRIPTION`
  に置換。`absoluteUrl` の基準も `SITE_URL`。
- `SearchBox.tsx` — `"use client"`。`/search.js`（ビルド出力）を**実行時組み立ての指定子**で
  動的 import（`@vite-ignore`）し、`/search-index.json` に問い合わせ。両ファイルはビルド後の
  サイトにのみ存在するため、`pnpm dev` では無効状態にフォールバック。`/` ホットキー対応。
- `Layout.tsx` — Header/Footer で `<Outlet>` を挟む共通枠。本文は defer されるため `Suspense` で囲む。
- `App.tsx` は変更なし。Layout を含むルート結線はページ（フェーズ6）依存のためコメントのまま据え置き。
- `pnpm typecheck`（tsgo）exit 0。スタイル（`className`）はフェーズ8で当てる。

### 2026-06-14 — フェーズ5 コードレビュー（1 ファイルずつ）

8 コンポーネントを 1 ファイルずつレビューし、合意した範囲で修正。各修正後 tsgo exit 0。

- `Footer.tsx` — コピーライト行 `© {year} {SITE_TITLE}` を追加。年は `nowInTokyo().year`
  （JST 固定）、サイト名は `SITE_TITLE`。「Built with ...」のクレジットはそのまま。
- `Header.tsx` — ブランド名のハードコード `"FUNSTACK Blog"` を `SITE_TITLE` に。アクティブ
  リンクに `aria-current="page"` を付与（非アクティブは `undefined`）。`pathname === ""` は
  URL 由来で起こり得ない（`new URL().pathname` は最低 `"/"`）ため削除し `pathname === path` に。
  ナビは素の `<a>` のまま正しい（`@funstack/router` は Navigation API でアンカーを横取りする
  設計で `<Link>` は無い。フルリロードは `hardNavigate`/`hardReload`）。
- `TagList.tsx` — `<ul>` に `aria-label="タグ"` を追加。`tagSlug` を `#content.js` から取る件は
  TagList が Server Component のため現状問題なし（Client から使うとネイティブ混入リスク）。
- `PostToc.tsx` — 変更なし。`href="#id"` はルーター横取り対象外（`!event.hashChange`）で
  ネイティブのアンカージャンプが効くことを確認。
- `PostCard.tsx` — 変更なし。タイトルリンクとタグリンクは兄弟でネストアンカーなし、
  `<a>` が `<h2>` を内包するのは HTML5 で有効、と確認。
- `Seo.tsx` — `SeoProps` を **type 判別の判別可能ユニオン**に（`WebsiteSeo | ArticleSeo`、共通は
  `SeoBase`）。`article` は `title` / `image` 必須、`website` は任意。OG 拡充: 画像がある時に
  `og:image:width`(1200)/`height`(630)/`alt`(fullTitle)、常時 `og:locale="ja_JP"` を出力。
  ※「オプショナル撲滅」はユーザー判断で今回は見送り。
- `SearchBox.tsx` — 未使用フィールドを型から削除（`SearchRuntime.searchOptions`、
  `SearchResult.score`/`matches`）。**`/` ホットキーを廃止**（WCAG 2.2 SC 2.1.4 Character Key
  Shortcuts に反するため effect ごと削除、`inputRef`・プレースホルダの「（/）」も除去）。
  結果リンクに `onClick={() => setQuery("")}` を付け選択後に結果を畳む。
- `Layout.tsx` — 変更なし（スキップリンクはユーザー判断で見送り）。
- ヘッダー刷新（nav=Blog/Tags/About/RSS・Search 組み込み・ソーシャルアイコン）は一度検討
  （既存サイト tsuka-ryu.dev の構成・社内 URL を調査）したが、今回は実施しない方針に決定。

### 2026-06-14 — フェーズ6: ページ（6ファイル）& App ルート結線

設計図フェーズ6の 6 ページを `src/pages/` に作成。コメントは日本語、import は subpath
（`#*`）に統一。依存の末端（NotFoundPage）から作り、各段階で tsgo green を維持。

- `NotFoundPage.tsx` — 404。`noindex` で出力。PostPage / TagPage が記事・タグ未存在時の
  フォールバックにも使う。
- `HomePage.tsx` — サイト紹介 + `SearchBox` + 記事一覧（`PostCard`）。
  **設計図の差分**: 設計図はタイトル/タグラインをハードコードしていたが、本リポジトリは
  `constants.ts` に集約済みのため `SITE_TITLE` / `SITE_DESCRIPTION` を参照。
- `PostPage.tsx` — slug から記事を引き `<Markdown root={post.mdast}>` で本文描画。
  目次（`PostToc`）・タグ（`TagList`）・記事 OG（`type="article"` / `image=/og/<slug>.png`）。
  **設計図の差分**: `formatDate` を `#lib/time.js` から取る（時刻処理は time.ts に集約済み）。
- `AboutPage.tsx` — サイト説明 + Client Component の島デモ。
  **設計図の差分**: 設計図は `Counter` を島にしていたが、本リポジトリは `ShaderGimmick`
  （WebGL シェーダー）に差し替え済みのためそちらを使用。見出し下の文言もシェーダー前提に調整。
- `TagsPage.tsx` — `/tags`。全タグと記事数の一覧（`getAllTags`）。
- `TagPage.tsx` — `/tags/<slug>`。`getTagBySlug` で絞り込み、`PostCard` で一覧表示。
- `src/app/App.tsx` — フェーズ2でコメントアウトしていたルート結線を有効化。`Layout` を親に
  `/`・`/about`・`/tags`・タグ別・記事別・`/*`(404) を結線。`postRoutes` / `tagRoutes` は
  content の frontmatter から動的生成し、各ページを `defer()` で独立 RSC ペイロード化。
- `pnpm typecheck`（tsgo）exit 0。スタイル（`className`）はフェーズ8、サンプル記事は
  フェーズ9で投入予定（現状 `content/posts/` は空なので記事・タグルートは 0 件）。

### 2026-06-14 — フェーズ6 コードレビュー（1 ファイルずつ）& About を自己紹介に差し替え

6 ページを 1 ファイルずつレビューし、合意した範囲で修正。各修正後 tsgo exit 0。

- `NotFoundPage.tsx` — 変更なし。`noindex` 出力・`PostPage`/`TagPage` のフォールバック兼用を確認。
- `TagsPage.tsx` — `tag-cloud` の `<ul>` に `aria-label="タグ一覧"` を付与（フェーズ5 の
  `TagList`（`aria-label="タグ"`）と一貫させる）。
- `TagPage.tsx` — 変更なし。`getTagBySlug` ヒット時 `posts` は必ず 1 件以上のため空分岐は不要、
  と確認。
- `HomePage.tsx` — 変更なし。`SITE_TITLE`/`SITE_DESCRIPTION` 参照・空状態の扱いを確認
  （記事 0 件の空表示は任意・フェーズ9 で記事が入る前提のため見送り）。
- `PostPage.tsx` — 「設計図では formatDate を lib/format から…」の経緯コメントを削除
  （差分の経緯は本ログに記録済みでコード内は冗長）。`post-layout` のグリッドと `PostToc` が
  `null` を返す場合の整合はフェーズ8（スタイル）の TODO として認識。
- `AboutPage.tsx` — 経緯コメント削除に加え、**内容を既存ブログ tsuka-ryu's blog の About に
  合わせて差し替え**。見出し `About` → `About me`、本文をフレームワーク説明から自己紹介 2 段落
  （フロントエンドエンジニア / エコシステム・マネジメント・Rust・Haskell への関心）に変更。
  「インタラクティブな島」節は s-blog の About に無いため削除。`Seo` の title/description も更新。
  - シェーダー（`ShaderGimmick`）は s-blog 同様に本文より先へ配置。s-blog は全面背景
    （`absolute inset-0`）＋テーマ連動色だが、本リポジトリは全面背景化を**フェーズ8**（CSS の
    重ね合わせ）の TODO とし、色はテーマ機構未導入のため固定色のまま据え置き。
- ついで対応: フェーズ5 の `PostCard.tsx` に残っていた同種の「設計図では…」経緯コメントも削除。

残った論点はいずれもコード外の領域（記事 0 件の空表示・`post-layout` グリッド → フェーズ8、
About 本文の追記 → 任意）。

### 2026-06-14 — フェーズ7: build entry（`src/app/build.ts`）

設計図フェーズ7の build entry を作成。設計図は `src/build.ts` だが、本リポジトリは結線を
`src/app/` に集約する方針（`vite.config.ts` の `build: "./src/app/build.ts"`）なので
`src/app/build.ts` に配置。import は subpath（`#lib/*`）に統一。

- `src/app/build.ts` — `@funstack/static/server` の `BuildEntryFunction` を default export。
  `BuildEntryContext`（`{ build, outDir }`）を実型で確認。`Promise.all` で既定ビルド `build()`
  と並列に、フェーズ4 で作った生成器の出力を `outDir` 直下へ書き出す:
  - `feed.xml` … `buildRssFeed()`（`#lib/feed.js`）
  - `sitemap.xml` … `buildSitemap()`（同上）
  - `search-index.json` … `buildSearchIndexJson()`（`#lib/search.js`）
  - `search.js` … `buildSearchRuntimeJs()`（同上、クライアント用 BM25 ランタイム）
  - OG 画像 … `generateOgImages(outDir)`（`#lib/og.js`、`<outDir>/og/<slug>.png`）
- 依存（feed/search/og）の export 名・引数は実装と一致を確認済み。`build()` と追加生成を
  並列化してクリティカルパスから外す設計は設計図どおり。
- `pnpm typecheck`（tsgo）exit 0。実ビルド（`vite build`）での出力確認はサンプル記事
  投入後（フェーズ9）〜ビルド検証（フェーズ10）で行う。現状 `content/posts/` は空のため
  RSS/sitemap/検索/OG はいずれも 0 件分の生成になる。

### 2026-06-14 — フェーズ8: スタイル（`src/styles.css`）

設計図フェーズ8の `src/styles.css`（約540行）を作成。`ClientApp` が `#styles.css`
（= `src/styles.css`）を副作用 import 済みなので、ファイル設置だけで結線は完了。

- **実コンポーネントの className と突き合わせ**てから作成。設計図 CSS は本リポジトリで使う
  クラスを全て網羅していることを確認（`nav-link`/`active` は Header の動的 `className={...}`
  で使用、`tag-page .intro h1 .tag` 等のセレクタも実 DOM と一致）。
- **コメントを日本語化**（CLAUDE.md 規約）。設計図は英語コメントだが他ファイルと揃えて翻訳。
- **本リポジトリ固有の追記 2 点**（設計図 CSS には無い）:
  - `.footer-copyright` — フェーズ5 レビューで Footer に足したコピーライト行用。`.footer p`
    が `margin:0` を当てるため、Built with 行との間隔を `margin-top` で少しだけ確保。
  - `.about-intro` / `.about-page h1` — About を自己紹介に差し替えた際、h1 の前に
    `ShaderGimmick`（高さ240px の島）を置く構成にしたため、設計図の `.about-page h1
{ margin-top: 0 }`（h1 先頭前提）を `1.5rem` に変更しシェーダーとの間隔を確保。
    自己紹介本文（`.about-intro`）に最大幅と段落間隔を付与。
- 配色は light/dark の CSS 変数（`prefers-color-scheme`）で切り替え。shiki も
  `--shiki-light/dark` 変数でテーマ追従（クライアント JS なし）。記事レイアウトは 1080px 以上で
  本文＋sticky 目次の 2 カラムグリッド。
- `pnpm typecheck`（tsgo）exit 0（CSS は副作用 import で型検査対象外、`noUncheckedSideEffectImports`
  は未有効化のまま）。実表示の確認はサンプル記事投入後（フェーズ9〜10）。

次回は **フェーズ9: サンプル記事**（`content/posts/*.md`）から再開する。

### 2026-06-14 — フェーズ9: サンプル記事（設計図テンプレ3本）& lint 不具合の回避

`content/posts/` に設計図フェーズ9のテンプレ記事3本を作成し、実ビルドで end-to-end 検証した。

- 当初は既存ブログ tsuka-ryu's blog（`tsuka-ryu-s-blog`）の実記事11本を取り込む方針で、
  frontmatter の `date` を `YYYY-MM-DD` へ切り詰め・`author` 行除去・`.md` 化し、参照画像も
  コピーした。しかし strict lint（warning もビルド失敗）で **31 件の警告**が出て、その大半が
  誤検知・意図的表現だった:
  - `repeated-word` — 「satoriを使って」「Vimっぽい」「Haskellに入門」「PART 6 / PART 5」等、
    いずれも単独出現または別語。CJK 隣接の英単語をうまくトークナイズできない誤検知。
  - `repeated-punctuation` — 「感想ですが。。。」等、意図的な余韻表現。
  - 実記事の取り込みは**別途やる方針**になったため、本フェーズでは破棄して設計図テンプレに切替。
    取り込んだ `content/posts/*.md` と `public/blog/` は削除済み。
- **設計図テンプレ3本**を作成: `hello-funstack.md` / `markdown-showcase.md` / `rsc-and-defer.md`
  （いずれも設計図に忠実。frontmatter は title/date/description/tags）。
- **lint 不具合の発見と回避** — テンプレでもビルドが落ちた。原因は ox-content の
  `max-consecutive-blank-lines` ルールが**フェンス済みコードブロック直後の単独空行を
  「連続空行」と誤判定**する不具合（最小再現: `## A` → `code` → 空行 → `## B`）。
  コードを含む記事は正しい Markdown でもビルド不能になり、技術ブログでは致命的。
  - このルールは `u32` 専用（`false` 不可）かつデフォルト ON のため options から外しても
    無効化できない。そこで `src/content.ts` の `lintPost` に `NON_FATAL_RULES`
    （`max-consecutive-blank-lines`）を設け、**このルールの診断だけ非致命に降格**
    （warning 表示のみ・ビルドは止めない）。他ルールの warning は従来どおりビルド失敗のまま。
  - `repeatedWords` / `repeatedPunctuation` はテンプレでは発火しないため strict 維持。実記事を
    入れる際は誤検知で再燃する見込みだが、それは実記事取り込み（別途）の時に対応する。
- **実ビルド検証（`pnpm build`）exit 0**。生成物を確認:
  - HTML: `index` / `about` / `tags` / `404` / `posts/*`（3本）/ タグ別ページ。
  - 追加成果物（フェーズ7 build entry 経由）: `feed.xml` / `sitemap.xml` /
    `search-index.json` / `search.js` / `og/*.png`（3枚・日本語フォント込み）。
  - これによりフェーズ7（build entry）・8（スタイル CSS バンドル）・9（記事）が実物で初めて
    通しで動くことを確認。`pnpm typecheck`（tsgo）も exit 0。
- 既知の軽微点（テンプレなので未対応）: PostPage は frontmatter の title を `<h1>` で出すが、
  テンプレ本文も先頭に `# title` を持つため h1 が二重になる。実記事差し替え時に解消想定。

次回は **フェーズ10: ビルドと配信**（preview / デプロイ）から再開する。

### 2026-06-14 — フェーズ10: ビルドと配信（クリーンビルド検証 & preview 確認）

設計図フェーズ10の「ビルドと配信」「動作確認チェックリスト」を本リポジトリで一通り実施。
コード変更は無し（検証フェーズ）。出力先は設計図どおり `dist/public/`
（`@funstack/static` の `publicOutDir` 既定値）。

- **クリーンビルド** — `rm -rf dist && pnpm build` exit 0。`dist/public/` に HTML
  （`index` / `about` / `tags` / `404` / `posts/*` 3本 / `tags/*` 7タグ）、追加成果物
  （`feed.xml` / `sitemap.xml` / `search-index.json` / `search.js` / `og/*.png` 3枚）、
  RSC ペイロード（`funstack__/`）一式が生成されることを確認。
- **動作確認チェックリスト**（設計図準拠）:
  - HTML / 追加成果物 / OG 画像の存在 … OK。
  - shiki ハイライト … 設計図は `hello-funstack.html` で `class="shiki"` を grep するが、
    本リポジトリの `hello-funstack` はコードブロックを持たないため 0 件。コードを含む
    `markdown-showcase.html`（53 箇所）/ `rsc-and-defer.html`（55 箇所）で正常にハイライト
    されていることを確認（チェック対象ファイルの差異であって不具合ではない）。
  - TOC アンカー一致 … `markdown-showcase.html` の `href="#…"` と `<h2 id="…">` が日本語
    見出しスラッグで完全一致。
  - **ネイティブ依存リーク検査** … `grep -rlE "ox-content|takumi|codeToTokens"
dist/public/assets/*.js` で 0 ヒット（`OK`）。ox-content / takumi / shiki が
    クライアント JS に漏れていないことを確認。
- **本番 URL** — 設計図は「デプロイ前に `lib/site.ts` の `url` を本番 URL に」と注意するが、
  本リポジトリは `src/constants.ts` の `SITE_URL = "https://tsuka-ryu.dev"` に集約済み
  （フェーズ4）。`dist/public/` 全体に `example.com` の残存なし、`feed.xml` / `sitemap.xml`
  の絶対 URL が `https://tsuka-ryu.dev/...` で出力されることを確認。
- **配信確認** — `pnpm preview`（`vite preview`）は `dist/public/` を配信するが、ローカルでは
  `/` → `index.html` のディレクトリ index 解決を行わない（`/` は 404、`/index.html` は 200、
  `/feed.xml` 等の実ファイルは 200）。本番の静的ホスト（Netlify / Vercel / Cloudflare Pages /
  GitHub Pages 等）は `/` → index.html を解決するため実害なし。デプロイ可能性の最終確認として
  ディレクトリ index を解決する標準静的サーバ（`python3 -m http.server`）で
  `dist/public/` を配信し、`/`（200・`<title>tsuka-ryu fun blog</title>`）/ `posts/*.html` /
  `about.html` / `tags.html` / `feed.xml` / `og/*.png` がすべて 200 で正しい Content-Type で
  返ることを確認。
- 結論: `dist/public/` をそのまま任意の静的ホスティングへデプロイ可能。`pnpm typecheck`
  （tsgo）も exit 0。

次回は **フェーズ11: README 追加**（プロジェクト直下に概要・構成・開発/ビルド手順）から再開する。

### 2026-06-14 — フェーズ11: README 追加 & architecture.md の最新化

プロジェクト直下に `README.md` を新規作成し、併せて `docs/architecture.md` を現状（フェーズ
10 完了時点）に合わせて見直した。

- **`README.md`（新規）** — 概要 / 特徴 / 技術スタック表 / 必要環境 / セットアップ・コマンド /
  ディレクトリ構成 + 規約 / 記事の書き方（frontmatter 例）/ デプロイ、を日本語で記載。
  詳細は `docs/architecture.md`・`docs/search.md`・`docs/build-log.md`・`CLAUDE.md` へリンク。
- **`docs/architecture.md` の見直し** — フェーズ4 で更新が止まっており、その後の改修・追加が
  反映されていなかったので最新化:
  - **ディレクトリ構成** — 削除済みの `markdown/render.tsx` を除去。`types.ts` を
    「ゆるい型 + レジストリ型」→「判別可能ユニオン」、`components.tsx` を
    「既定レジストリ」→「switch ディスパッチ」に修正。`components/`（8 部品 + ShaderGimmick）・
    `pages/`（6 ページ）・`app/build.ts`・`styles.css`・`content/posts/*.md` を追記。
  - **「switch ディスパッチのレンダラー」節** — 旧「レジストリ方式のレンダラー」を全面書き換え
    （判別可能ユニオン化・switch・相関キャスト解消・`components` オーバーライド削除を反映）。
  - **content.ts のデータフロー** — 「ビルド時に壊れた記事を弾く」節を追加
    （frontmatter 検証 / parse エラー / URL スキーム検証 / Markdown lint と
    `max-consecutive-blank-lines` の非致命降格）。
  - **新規節を追加** — コンポーネントとページ（フェーズ5/6）・ビルド出力（フェーズ7）・
    スタイル（フェーズ8）・ビルドと配信（フェーズ10）。ルーティング節を「予定」表現から
    現在形に修正。
  - **「まだ無いもの」表を削除** — フェーズ5〜10 はすべて完了したため、末尾を進捗参照に置換。
- コード変更なし（ドキュメントのみ）。`pnpm typecheck`（tsgo）も影響なし。

次回は **フェーズ12: 現行サイトの記事を移行**（実記事取り込み + strict lint 誤検知対応）から
再開する。

### 2026-06-14 — フェーズ12: 現行サイトの記事を移行（実記事11本 + lint 誤検知の本文修正）

フェーズ9 で「別途」としていた、既存ブログ tsuka-ryu's blog（`tsuka-ryu-s-blog`）の実記事の
移行を実施。サンプルテンプレ3本を実記事11本に置き換えた。

- **移行元** — `tsuka-ryu-s-blog/content/blog/*.mdx`（12本中、テスト用 `jp-test.mdx` を除く
  11本）。変換スクリプトで以下を機械的に処理し `content/posts/<slug>.md` に出力:
  - `.mdx` → `.md`、ファイル名をそのままスラッグに（日付プレフィックス付き、s-blog の
    パーマリンクと一致）。
  - frontmatter の `author:` 行を除去、`date` を `YYYY-MM-DD` に切り詰め（元は時刻・TZ 付き）。
    title / description / tags は維持。
  - 本文中の `<Mdx ... />`（1箇所）はコードフェンス内のテキストなので変換不要と確認。
- **画像** — 実画像参照は `og-image-example.webp` 1枚のみ（絶対パス `/blog/...`、`SAFE_URL`
  allowlist 通過）。`public/blog/` にコピー。他の `/blog/...` はリンクかコード内。
- **strict lint の誤検知を本文修正で解消** — ox-content の lint で 31 件の warning が出た。
  内訳と対応:
  - `repeated-word` 16件 — **すべて誤検知**。ox-content のトークナイザが CJK を分割できず、
    間に日本語を挟んだ別々の英単語（例「vercelのsatoriと…過去にsatoriを」「PART 2…PART 6」）を
    「隣接した重複」と誤判定する。当初はルール無効化を提案したが、ユーザー判断で**記事本文を
    書き換えて**解消する方針に（自分のブログなので内容修正可）。語を代名詞・類語・別表記に
    置換（Go/Zed/Figma/Vim/git/satori/AST/WASM/GW 等）。`PART N` はコードコメントのラベル参照
    なので「N つ目」に、Haskell は書名『プログラミングHaskell 第2版』が変更不可のため見出しを
    「関数型言語に再入門」に変更。各置換は適用前に lint が消えることを検証済み。
  - `repeated-punctuation` 3件 — 日本語の「。。。」（意図的な余韻）。三点リーダ「…」に統一して解消。
  - `max-consecutive-blank-lines` 12件 — 既知の ox-content 不具合（コードフェンス直後の単独
    空行を誤判定）。`NON_FATAL_RULES` で非致命のまま（フェーズ9 で導入済み）。
  - 全置換は適用前に専用スクリプトで「置換後に repeated-word/punctuation がゼロになる」ことを
    確認してから content/posts/\*.md に書き込んだ。
- **lint 設定は変更なし** — `LINT_OPTIONS` の `repeatedWords` / `repeatedPunctuation` は strict
  維持（無効化せず、本文側で誤検知を潰した）。
- **実ビルド検証（`pnpm build`）exit 0** — repeated-word/punctuation の warning はゼロ
  （残るは非致命の max-consecutive-blank-lines のみ）。生成物を確認:
  - 記事 HTML 11本 / OG 画像 11枚 / タグページ（日本語スラッグ含む）。
  - 移行画像 `dist/public/blog/og-image-example.webp` が出力に含まれ、記事 HTML から参照される。
  - ネイティブ依存リーク検査 OK、`pnpm typecheck`（tsgo）exit 0。
  - フェーズ9 のテンプレ二重 h1 問題は解消（実記事は本文が `##` 始まりで、h1 は記事タイトルの
    1個のみ）。

### 2026-06-14 — メモ: max-consecutive-blank-lines 警告の調査（当面は据え置き）

フェーズ12 後のビルドで出る `max-consecutive-blank-lines` 警告（pratt-parser 7件 /
rss-feature 4件 / og-image 1件）を改めて調査した。

- **実態** — 各記事を実検査したところ、**実際に連続空行があるのは `rss-feature.md` の2箇所
  だけ**。pratt-parser（7件）と og-image（1件）は**連続空行が1つも無いのに警告が出ている**
  ＝ ox-content の誤判定。
- **原因（再掲）** — `max-consecutive-blank-lines` ルールが**フェンス済みコードブロック直後の
  単独空行を「連続空行」と誤カウント**するバグ。最小再現は `## A` → `code` → 空行 →
  `## B`（空行は 1 つだけ）。コードブロックの多い記事ほど誤警告が増える。
- **対応方針** — 根本対処は ox-content 側の修正だが、**今回は直さない**（ユーザー判断）。
  当面は現状維持: このルールは `NON_FATAL_RULES` で**非致命**のままなのでビルドは exit 0、
  警告はコンソールに表示されるだけ。`content.ts` 側で表示抑制する暫定対応も可能だが、今は
  見送る。実連続空行（rss-feature の2箇所）の手直しも、表示抑制とセットで行う想定のため保留。
- 将来 ox-content を直す際の最小再現ケースは上記。

### 2026-06-14 — 既存ブログの機能調査 & 3機能の取り込み（フェーズ13 前）

フェーズ13（デザイン見直し）の前に、移行元 tsuka-ryu's blog（Next.js 16 + Fumadocs）の
機能を一通り調査し、funstack ブログに無い機能を棚卸しした（テーマ切替・ヒーロー全面シェーダー・
アニメ TOC・ソーシャルアイコン・記事別 RSS・docs・アナリティクス・タグスラッグ英字化 等）。
このうちユーザー判断で **#5 ソーシャルアイコン / #9 記事別 RSS / #12 タグスラッグ英字化** の
3つを取り込んだ。

- **#12 タグスラッグの英字化** — `transliteration` を追加し、`content.ts` の `tagSlug` を
  `slugify(transliterate(tag))` に変更。日本語タグを romaji 化してから既存 `slugify`
  （toc.ts）でクリーンアップし、ASCII の URL セーフなスラッグにする（例「RSSフィード」→
  `rsshuido`、「Next.js」→ `nextjs`、「ブログ盆栽」→ `burogupen-zai`）。漢字は transliteration の
  仕様で中国語読み（pinyin）になるが、s-blog と同挙動・URL セーフで問題なし。見出しアンカー
  （extractToc）は日本語を残す方針なので従来の slugify のまま（タグだけ transliterate を噛ます）。
  - 出力 `dist/public/tags/*.html` とサイト内リンク・sitemap・feed のタグ URL がすべて英字
    スラッグになったことを確認（日本語スラッグの残存ゼロ）。既存サイトは未公開のためリダイレクトは不要。
- **#9 記事別 RSS → feed.xml 全文埋め込み**（ユーザー選択で s-blog の「装飾なし全文ページ」
  方式ではなく標準的な全文 RSS を採用）— `content.ts` の `Post` に `body`（frontmatter を
  除いた本文 Markdown）を追加。`lib/feed.ts` で `@ox-content/napi` の `parseAndRender` により
  本文を HTML 化し、各 item に `<content:encoded><![CDATA[...]]></content:encoded>` を追加。
  `<rss>` に `xmlns:content` を宣言。RSS は外部リーダーで読まれるため、`href`/`src` の
  サイト相対 URL（/...）を `SITE_URL` 付きの絶対 URL に変換（プロトコル相対 // は対象外）。
  CDATA 内の `]]>` は分割してエスケープ。shiki ハイライトは通らない素の HTML だが全文閲覧には十分。
  - feed.xml が整形式 XML（xmllint OK）で、全11記事に content:encoded が入り、画像 URL が
    `https://tsuka-ryu.dev/blog/...` に絶対化されることを確認。
- **#5 ソーシャルアイコン & ナビ拡張** — `constants.ts` に `SOCIAL_LINKS`（GitHub /
  X / Zenn の URL）を追加。`Header.tsx` にテキストナビ `Tags`（Home が記事一覧を兼ねるため
  Blog は追加せず Tags のみ拡張）と、GitHub / X / Zenn のインライン SVG アイコンリンク
  （`target="_blank"` / `rel="noopener noreferrer"` / `aria-label`）を追加。`styles.css` に
  `.nav-social` / `.social-link`（18px アイコン・hover）を追加。フェーズ5 レビューで一度見送った
  ソーシャルアイコンを、今回ユーザー判断で導入。
- **依存追加**: `transliteration@2.6.1`（dependencies）。
- `pnpm typecheck`（tsgo）exit 0 / `pnpm build` exit 0。

次回は **フェーズ13: サイトデザインの見直し**（テンプレ然とした見た目を tsuka-ryu.dev 寄りに
調整等）から再開する。

### 2026-06-14 — フェーズ13: サイトデザインの見直し（配色＋装飾の軽め調整）

方針の確認（ユーザー選択）:

- ホーム: レイアウトは現状維持のまま、**配色＋装飾を tsuka-ryu.dev 寄りに**調整して
  テンプレ感を薄める（軽め調整）。全面 Hero 化はしない。
- アクセント配色: 現行の紫から **tsuka-ryu.dev 系のオレンジ/琥珀**へ切替。

実作業（`src/styles.css` のみ。コンポーネントの構造変更なし）:

- **アクセント色をオレンジ系へ**。`--primary` / `--primary-hover` を更新。
  - ライト: `hsl(25 95% 40%)`（hover `hsl(25 95% 32%)`）。
  - ダーク: `hsl(33 100% 50%)`（hover `hsl(33 100% 60%)`）。
  - リンク・タグ枠・`blockquote` の縦線・検索フォーカス枠などはいずれも `--primary`
    参照なので、トークン差し替えだけでオレンジに統一される。
- **大見出しをグラデーション・クリップテキスト化**（tsuka-ryu.dev の特徴）。
  `.intro h1`（ホーム/タグの intro）と `.post-title` に
  `linear-gradient(to bottom, var(--text), var(--text-muted))` + `background-clip:text`
  を適用。色はテキスト系トークンから作るのでライト/ダーク両方に追従する。
  併せて再利用用に `.gradient-heading` クラスも定義。

**SearchBox をヘッダーへ移動**（ユーザー要望）:

- `HomePage` の intro 内にあった `<SearchBox />` を撤去し、`Header` のナビ先頭へ移設。
  Header は元々 Client Component なのでそのまま組み込めた。
- ヘッダー用の見た目を CSS に追加。`.header .search` は幅を `clamp(7rem,22vw,13rem)`
  に絞り、入力のパディング/フォントを小さめに。ドロップダウン（`.search-results`）は
  入力より広げて右端揃え（`right:0; width:min(22rem,80vw)`）で下に出す。

**背景・境界・テキストを neutral grey 化**（ユーザー指摘「背景色が変わってない」）:

- GitHub 風の青み grey をやめ、tsuka-ryu.dev（fumadocs neutral プリセット）に合わせた
  純 neutral grey へ。
  - ライト: `--bg #fff`（据え置き）/ `--bg-alt #f5f5f5` / `--border #e3e3e3` /
    `--text #171717` / `--text-muted #666` / `--code-bg #f5f5f5`。
  - ダーク: `--bg #121212`（tsuka-ryu.dev の shader colorBack と一致）/ `--bg-alt #1e1e1e` /
    `--border #2a2a2a` / `--text #ededed` / `--text-muted #a1a1a1` / `--code-bg #1c1c1c`。
  - ダーク表示で背景がはっきり変わる。ライトは元々白なので変化は境界・テキストの neutral 化が中心。

**ヘッダーの配置見直し**（ユーザー要望）:

- ナビから **Home を削除**（ブランド名がホームへのリンクを兼ねるため、タイトルと重複）。
- ヘッダーを **左グループ（ブランド + Tags/About）/ 右グループ（検索 + ソーシャル）** に再編。
  `header-inner` の `space-between` で左右に分け、`Tags`/`About` をブランド右隣に左寄せ、
  検索とソーシャルアイコンを右端へ。`.header-left` / `.header-right` を CSS に追加。

**ホーム上部の整理**（ユーザー指摘「トップの2つがダサい」）:

- タグラインを `SITE_DESCRIPTION`（「tsuka-ryuの個人ブログ」＝説明文くさい）から、tsuka-ryu.dev
  と同じキャッチコピー **「キーボードを叩く、何かが壊れる。」** に変更。表示専用の
  `SITE_CATCHPHRASE` を `constants.ts` に追加し、SEO/RSS 用の `SITE_DESCRIPTION` は温存（用途分離）。
- ぽつんと置いていた **「タグ一覧 →」リンクを削除**（Tags はヘッダーに移したので冗長）。
  未使用になった `.intro-links` CSS も除去。

検証:

- `pnpm typecheck`（tsgo）exit 0 / `pnpm build` exit 0。
- ミニファイ後の出力 CSS で `--primary:#c75605`（ライト）/ `#ff8c00`（ダーク）、
  背景 `--bg:#121212`（ダーク）/ `#fff`（ライト）、`background-clip:text` を確認。

> これでフェーズ 0〜13 がすべて ✅ 完了。設計図（build-from-scratch.md）+ 独自拡張
> （11 README / 12 記事移行 / 13 デザイン見直し）まで一通り完了した状態。

### 2026-06-14 — CLAUDE.md「作業フロー」を保守モードに改訂

全フェーズ（0〜13）完了に伴い、CLAUDE.md の「作業フロー」節を見直し。

- **背景**: build-from-scratch.md（設計図）はフェーズ13まで消化済みで、「これから参考に
  する手順書」ではなくなった。旧記述は「作業を進めるときは設計図を参考にする」「タスク
  完了ごとに追記」「フェーズ完了時に進捗サマリを更新」と、フェーズ駆動の構築期を前提に
  していたため実態と乖離。
- **変更**:
  - 設計図は「構築当時の参照用として残す」と位置づけ直し（フェーズ13まで完了済みと明記）。
  - build-log.md を **ADR 的な変更履歴**と再定義。単なる作業メモではなく「何を・なぜ
    そう決めたか（採用理由・却下した代替案・ハマりどころ）」を残す目的を明文化。
  - 進捗サマリは「全完了済みなので通常は更新不要、大きな作業単位を立てたときだけ追記」に
    緩和。
- **不変更**: 環境 / ディレクトリ構成 / 進め方の方針は実態（src 構成・tsgo 一本化・
  subpath imports 等）と一致していたため据え置き。

### 2026-06-14 — 世界観デザインの再検討（design/ モック）& 採用案 06 Marginalia 決定

フェーズ13 で配色＋装飾を tsuka-ryu.dev 寄りに「軽め調整」したが、neutral grey + 琥珀は
依然テンプレ感が強く本人の声が出ていなかった。サイト全体の世界観を「落ち着いてるけど
遊び心」方向で再デザインすることにし、まず**捨て案を含む単一 HTML モックを `design/` に
並べて比較**してから方針を確定する進め方を採った。コード本体（`src/`）はまだ未変更。

- **検討基盤の整備**:
  - `design/` に検討用の単一 HTML モックを集約。`design/index.html` を案を並べるギャラリーに。
  - `package.json` に `design` スクリプト（`vite design --config design/vite.config.ts --open`）。
    本体の `vite.config.ts`（React / ox-content）を巻き込まないよう、`design/vite.config.ts`
    に空設定を置いて静的配信専用にした（コミット `3c7d240` で雛形を追加済み）。
- **比較した案**（`design/`）: 01 Glitch Stack / 02 Minimal / 03 Terminal / 04 Riso Poster /
  05 Playground / 06 Marginalia。AI 既定の 3 パターン（クリーム+セリフ+テラコッタ、黒+
  アシッド一色、新聞ヘアライン）は避ける方針で各案を振った。
- **採用 = 06 Marginalia**。01（出発点）と 05 の中間。乾いたユーモア＋アフォリズム＋飾らな
  さを下敷きにした静かな遊び。仕様は `docs/design-direction.md` に集約（カラートークン・
  タイポ・シグネチャ・レイアウト・コピー）。要点と「なぜそう決めたか」:
  - **遊び心は叫ばない** — 01 のグリッチ衝撃演出は不採用。手描きアスタリスク ✳ をブランド
    マーク＆本の「\* \* \*」区切りに。ヒーロー名はホバー時だけ短くグリッチ。
  - **配色** — 温かい紙 `--paper #FAF6EC` / くすませた琥珀 `--accent #C2540C` / 万年筆
    インク色 `--ink2 #46557A`。琥珀はフェーズ13 のヒートを引き継ぎつつ落ち着かせた。
  - **タイポ** — 見出し Bricolage Grotesque / 本文 Zen Kaku Gothic New / 等幅 JetBrains
    Mono。本文 17px・line-height 1.7。
  - **一覧 = marginalia レイアウト** — 日付を左マージンに逃がし本文を 1 列に集約。日付は
    `2026.06.07`（中点 `·` は間延びで不採用、`max-content` 左揃え・nowrap）。
  - **コピー** — ヒーローは名前＋「キーボードを叩く、何かが壊れる。」のみ（長い説明は削除）。
    フッターに `——そういうものだ。`（ヴォネガット邦訳、2 倍ダッシュ）。`so it goes.` は符牒が
    伝わりにくく邦訳に。
  - **ハマりどころ** — 日本語で `max-width: NNch` は全角が 1ch≒2 文字幅で扱われ極端に折り
    返すため `rem` で持つ。背景は方眼（宿題感）→ドット、星の瞬き（点滅）はチラつきで不採用。
- 検証は各調整ごとに `pnpm design` のブラウザ表示で実施（モックのため tsgo/build は対象外）。

次回は **本実装**（`src/styles.css` 刷新 / `Root.tsx` にフォント / ✳ の共有部品化 /
`PostCard`・一覧の marginalia レイアウト化 / ヒーロー・フッターのコピー）から再開する。
詳細 TODO は `docs/design-direction.md` 末尾を参照。

### 2026-06-14 — 世界観デザインの本実装（marginalia レイアウト & ローカルフォント化）

`docs/design-direction.md` の採用案を `src/` に反映した。モック（`design/06-marginalia.html`）
をそのまま移植するのではなく、既存コンポーネント構成（subpath imports / Server・Client
の分離）に馴染ませる形で組み込んだ。

- **配色トークンを刷新**: `src/styles.css` の `:root` を 紙 `--paper #FAF6EC` / 墨
  `--ink` / 補助 `--soft` / 罫 `--line` / 琥珀 `--accent #C2540C` / 冷たい差し色
  `--ink2 #46557A` に置換。記事本文・検索・目次など既存スタイルが参照していた従来名
  （`--bg` / `--text` / `--border` / `--primary` 等）は**新トークンへの別名**として残し、
  配色変更が一箇所で全体に波及するようにした（全 CSS を書き換えずに済む）。背景は薄い
  ドットグリッド（`radial-gradient`）。
- **フォントはローカル同梱（`@fontsource`）に決定**。当初の設計メモは `Root.tsx` に
  Google Fonts の `<link>` を置く案だったが、**外部 CDN は接続待ちのあいだ既定フォントで
  描画され、読み込み後に差し替わってチラつく**（FOUT）ため不採用。
  `@fontsource-variable/bricolage-grotesque` / `@fontsource/zen-kaku-gothic-new`(400/500) /
  `@fontsource-variable/jetbrains-mono` を `src/app/ClientApp.tsx` で import。
  - 日本語フォントは `unicode-range` でサブセット分割された woff2（Zen Kaku は約 120
    サブセット）なので、フルセットを丸ごと読む事故にならず必要範囲だけ取得される。
  - **ハマりどころ**: バレット import（`@fontsource-variable/...`）は tsgo が型宣言を
    見つけられず `TS2882`。zen のように**明示の `/index.css` パス**で実ファイルを指すと
    解決する（拡張子付きの実在ファイルとして解決されるため）。フォント名は variable 版が
    `"Bricolage Grotesque Variable"` / `"JetBrains Mono Variable"`（末尾 Variable）。
- **✳ を共有部品化**: `src/components/Asterisk.tsx` に `Asterisk`（インライン SVG・歪ませた
  3 本線・`aria-hidden`）と `SceneBreak`（✳ を 3 つ並べた本のシーン区切り）。ヘッダーの
  ブランド脇・ヒーロー見出し・ホームの一覧上部で使い回す。
- **一覧を marginalia レイアウトに**: `PostCard` を「日付（左マージン・等幅・nowrap）＋
  本文 1 列」のグリッドに。日付は `formatDateDots`（`2026.06.07`、月日 0 埋め）を
  `src/lib/time.ts` に追加して使用（記事ページの見出しは従来の和暦表記のまま）。記事間は
  罫線をやめ `.post-card + .post-card::before` の ✳＋余白で区切る。タグは等幅の `#tag`
  （`#` を `--ink2`）に統一（一覧・タグページ・記事ページで共有）。
- **コピーと定数**: `SITE_NAME = "tsuka-ryu"` を追加し、ヘッダーのブランドとヒーロー H1 を
  これに（メタ用の長い `SITE_TITLE` と表示用の短い名前で役割分離）。ヒーロー H1 は
  `:hover` のときだけ走るグリッチ（`.glitch` + `data-text` の純 CSS、JS 不要）。フッターは
  `FOOTER_SIGNOFF = "——そういうものだ。"` を右に置き、キャッチコピーの「壊れる。」に
  呼応させた。`prefers-reduced-motion` でブランド回転・グリッチを無効化。
- **検証**: `pnpm typecheck`（tsgo）exit 0 / `pnpm build` exit 0。dist にローカル woff2 を
  同梱（Bricolage / JetBrains の variable と Zen Kaku のサブセット群）、生成 HTML に
  `hero` / `glitch` / `rule` / `post-card-date` / `footer-signoff`（「そういうものだ。」）を確認。

### 2026-06-14 — Web フォントを 1 ファミリーに集約（Zen Kaku Gothic New のみ）

本実装直後のプレビューで「フォントが増えすぎ、パフォーマンスに影響しそう」との指摘を受け、
読み込む Web フォントファミリーを 3 → 1 に削減した。

- **判断**: 日本語を表示する以上、日本語フォント（Zen Kaku Gothic New）は外せない。
  見出し用の Bricolage Grotesque と等幅の JetBrains Mono はいずれも**欧文専用で日本語
  グリフを持たない**ため、「1 つにする」なら日本語・欧文を両方カバーする Zen Kaku に
  寄せる以外にない。両 variable フォントを削除（`pnpm remove`）。
- **見出し**: 単一ファミリー内でウェイト差（本文 400 / 見出し 700）で階層を付ける。
  Zen Kaku は 400/700 を import（600 指定は CSS から 700 に統一）。
- **等幅の体裁**: 日付・タグ・ナビ等の「ターミナルに住んでいる」気配は、**OS 標準の
  等幅フォント**（`ui-monospace, SFMono-Regular, Menlo, …`）で残す。これは端末ローカル
  なので Web フォントを増やさない。日本語が混ざるタグだけ Zen Kaku にフォールバック。
- **トレードオフ**: 見出しのグロテスクの不揃いな表情と、等幅の専用書体感は失われる。
  ただしページ重量の主因は元々日本語サブセット（Zen Kaku）であり、欧文 2 ファミリーの
  削減で**読み込むファミリー数・接続を減らせる**ことを優先した。
- **検証**: `pnpm typecheck` / `pnpm build` ともに exit 0。dist の woff2 は Zen Kaku の
  サブセット（400/700）のみで、Bricolage / JetBrains は出力されないことを確認。

### 2026-06-15 — Vercel デプロイ設定（vercel.json）

静的サイトを Vercel に公開するため、ビルド設定を `vercel.json` に固定した。

- **判断**: ダッシュボード／CLI のどちらから入れても同じ結果になるよう、設定をリポジトリ側に
  置く。デプロイ対象は静的成果物だけなので framework プリセットは使わない（`framework: null`）。
- **出力先**: `vite build` の成果物は `dist/` 配下に `public` / `ssr` / `rsc` の 3 つができるが、
  実際に配信する HTML・アセット・`feed.xml` / `sitemap.xml` は `dist/public` に入る。
  `ssr` / `rsc` は静的生成のための中間ビルドなので、`outputDirectory` は `dist/public` を指定。
- **ネイティブモジュール**: `@ox-content/napi` と `takumi-js` はビルド時のみ使用し、いずれも
  `linux-x64-gnu` バイナリを optionalDependencies に持つため Vercel の Linux ビルドでも解決される。
  ランタイムには載らない。
- **要確認（コードに残らない外部設定）**: `package.json` の `engines.node` が `>=24.16.0`。
  Vercel 側で Node 24 を選べない場合はビルドが弾かれるため、プロジェクト設定で Node 版を上げるか
  `engines.node` を緩める必要がある。pnpm は `packageManager` とロックファイルから自動検出。

#### 初回デプロイで詰まった点と最終的な解決

- **Node 版の不一致**: Vercel の Node 24 が `v24.15.0` で、`engines.node: ">=24.16.0"` を
  満たせず警告。範囲指定はメジャー自動アップグレード警告も出るため、`engines.node` を
  `"24.x"` に変更（24.15.0 を満たし、ローカルの 24.16.0 も満たす）。
- **pnpm が使われず npm にフォールバック**: 初回ビルドで `pnpm-lock.yaml`（lockfileVersion
  9.0）のパースに失敗し npm install が走った（`EBADENGINE` 警告がその証拠）。`vercel.json` に
  `installCommand: "pnpm install --frozen-lockfile"` を明示して pnpm を強制。
- **`--frozen-lockfile` が exit 1（本命の原因）**: pnpm は使われるようになったが、Vercel 組み込みの
  pnpm がロックファイルを書いた 11.6.0 と別バージョンで、lockfileVersion 9.0 の解釈差で弾かれた。
  ローカルでは `pnpm install --frozen-lockfile`（11.6.0）が成功し、ロックファイル自体は正常だった。
  **解決策**: Vercel の環境変数に `ENABLE_EXPERIMENTAL_COREPACK=1` を設定し、`packageManager`
  に書いた pnpm@11.6.0 を corepack 経由でそのまま使わせる。これで一致しデプロイ成功。
  → この環境変数はコードに残らない Vercel 側の必須設定なので、再構築時は忘れないこと。

### 2026-06-15 — 目次（PostToc）を広い画面では常時展開

記事の目次は `<details>` で折りたたみ式にしており、既定（閉）はタグ下に置くモバイル向けの
体裁。広い画面では sticky の右カラムに移すが、ここでも閉じたままだと邪魔なので常に開いて見せる。

- **制約**: 静的（サーバー）レンダリングのため、ビューポート幅で `open` 属性を出し分けられない。
  既存方針どおりクライアント JS も足したくない。→ 開閉の出し分けは CSS のメディアクエリで行う。
- **手段**: `@media (min-width: 1080px)` で閉状態の隠蔽を上書きし、トグルの見た目も消す。
  - `.post-toc::details-content { content-visibility: visible }` — 新しいブラウザの `<details>` は
    閉状態を `::details-content` の `content-visibility: hidden` で隠すため、これを戻す。
  - `.post-toc .post-toc-list { display: block }` — 旧方式（閉状態で直下要素を `display: none`）の
    ブラウザ向け。クラス 2 つで UA スタイルより詳細度を高くして勝たせる。両方式を併記して新旧を両取り。
  - `.post-toc-title` の `cursor`/`pointer-events` 無効化と `::before`（▸）非表示で、常時開きに
    なったトグルの操作・装飾を消す。
- **トレードオフ**: モバイルは従来どおり折りたたみ（既定閉）のまま。PC のみ常時展開という非対称だが、
  sticky カラムでは展開済みが自然なので許容。`<details>` のままなので JS なし構成は維持。
- **派生で発覚したヘッダーとのズレ**: 目次を常時展開したことで右カラムが目立ち、`.post-layout` が
  `--max-width + 16rem` を中央寄せしていたため本文カラムの左端がヘッダー（`--max-width` 中央寄せ）より
  8rem 左にずれていたのが見えるようになった（ヘッダー自体は無変更で、ポストページ固有の既存ズレ）。
  - **最初の案（不採用）**: `.post-layout` を左端アンカーにして本文をヘッダーへ寄せた。しかし ~1080px の
    画面では本文(740px)＋目次を収めると目次が ~120px まで潰れる。本文を中央へ戻すと右余白が足りず、
    元設計が本文を左に寄せて目次幅(~208px)を稼いでいた理由がここにある。本文を動かすと必ず目次が割を食う。
  - **採用案**: 本文側は元の中央寄せ(996px)のままにして目次幅を確保し、**ヘッダーだけ**を記事ページで
    同じ 996px に広げて左右端を揃える。ヘッダーは全ページ共通なので、`.layout:has(.post-layout) .header-inner`
    で記事ページのときだけ `max-width` を広げる（ホーム/一覧は 740px のまま＝それぞれの本文と揃う）。
    `:has()` はクライアント JS なしでページ種別に応じた分岐ができ、マークアップ変更も不要。

### 2026-06-15 — Lint / Format / Git hooks（oxlint・oxfmt・lefthook）を導入

これまで静的解析・整形・push 前チェックが無かったため、コード品質の土台として一式入れる。
別リポジトリ（現行ブログ）で運用実績のある oxc 系（oxlint / oxfmt）と lefthook を踏襲する。

- **採用理由（oxc に寄せる）**: ESLint + Prettier ではなく oxlint / oxfmt を選択。Rust 製で高速、
  設定が少なく、型チェックは既に `tsgo`（TypeScript ネイティブ版）に寄せている方針と整合する。
  型を見るルールは `oxlint-tsgolint` 経由の `oxlint --type-aware` で有効化。
- **scripts**: `lint`(=`oxlint --type-aware`) / `lint:fix`(`--fix --fix-suggestions`) /
  `format`(`oxfmt`) / `format:check`(`oxfmt --check`)。`prepare` で `lefthook install` を回し、
  クローン後の `pnpm install` だけで hooks が同期されるようにする。
- **oxfmt 設定（`.oxfmtrc.json`）**: import 並べ替えを有効化し、`internalPattern` を本リポジトリの
  subpath imports に合わせて `["#*", "#*/**"]` に変更（手順書由来の `@/**` ではない）。
  `ignorePatterns` は `design/**`（手書きのデザイン探索 HTML。整形してもノイズで、保守対象でない）と
  `public/**` のみ除外。**Markdown は除外しない**——oxfmt は md も整形でき、テーブルを CJK 文字幅を
  考慮して桁揃えしてくれる（全角を 2 幅で勘定）ため、記事・docs にも掛ける。実ファイルは導入時点で
  すべて整形差分ゼロ＝既存の手書きを壊さないことを確認済み。
- **lefthook（`lefthook.yml`）**: コミット単位を軽く保ちたいので pre-commit ではなく **pre-push** に集約。
  `format:check` → `lint` → `typecheck` → `build` を直列実行し、「整形済み・lint OK・型 OK・ビルド可能」
  を push の条件にする。各コマンドは file glob を持たせず、どのファイルを触っても全体を検証させる。
- **ハマりどころ（pnpm 11 のビルドスクリプト承認）**: lefthook はインストール時に Git hooks を張る
  ビルドスクリプトを持つが、pnpm 11 は既定でこれを止める。`package.json` の `pnpm.onlyBuiltDependencies`
  は **pnpm 11 ではもう読まれず**（install 時に警告が出る）、設定先が `pnpm-workspace.yaml` に移っている。
  さらにキー名も変わっており、リスト形式の `onlyBuiltDependencies` ではなく **マップ形式の
  `allowBuilds: { lefthook: true }`** が正解だった（誤ると pnpm が承認待ちのスタブ行を毎回書き戻してくる）。
  単一パッケージのリポジトリでも `pnpm-workspace.yaml` を設定ファイルとして置く。

### 2026-06-15 — favicon を追加（ブランドのアスタリスクを流用した SVG）

タブ表示用のアイコンが未設定だった。新規にロゴを起こさず、ヘッダーのブランド名脇で使っている
手描き風アスタリスク（`Asterisk.tsx`）の 3 ストロークをそのまま流用して見た目の一貫性を保つ。

- **手段**: `public/favicon.svg` に紙色の角丸タイル＋琥珀のアスタリスクを置く。色は CSS 変数の
  実値（`--paper` / `--accent`）をベタ書きし、SVG 内の `@media (prefers-color-scheme: dark)` で
  ダーク時の紙・琥珀に差し替える。`Root.tsx` の共通 `<head>` に `rel="icon"` と、ブラウザ UI 用の
  `theme-color`（light/dark 2 枚）を追加。
- **SVG 単独にした理由（却下した代替）**: `.ico` や複数サイズ PNG は用意しない。Safari も 16.4 以降は
  SVG favicon に対応し、主要ブラウザは SVG 1 枚で足りる。アイコン生成のためにラスタライザや
  ビルド工程を増やすほうがこの構成の軽さに合わない。iOS ホーム画面用の apple-touch-icon（PNG 180px）
  だけは SVG では代替できないが、個人ブログでは優先度が低いため必要になってから足す。

### 2026-06-15 — Vercel 本番で `/about` 等が 404（`cleanUrls` で解決）

初回デプロイ後、ホーム（`/`）は表示できるのに `/about`・`/posts/*`・`/tags/*` がすべて
404 になった。

- **原因**: ビルドは各ページを拡張子付きの**ファイル**として出力する（`entries.tsx` の `toEntry`
  が `/about` → `about.html`、`/posts/x` → `posts/x.html` に変換）。一方アプリ内リンクと URL は
  拡張子なし（`/about` 等）。Vercel の静的配信は既定で `/about` を `about.html` にマッピングしない
  ため 404 になる。`/` だけは `index.html` が標準で返るので表示できていた＝ホームだけ動いて見えた。
- **修正**: `vercel.json` に `"cleanUrls": true` を追加。これで `about.html` が `/about` で配信され、
  逆に `/about.html` は `/about` へリダイレクトされて URL が拡張子なしに統一される。全ページが
  同じルールで解決するので、リンク側（`/about`・`/posts/...`・`/tags/...`）を一切変えずに済む。
- **却下した代替**: `rewrites` で個別に `/about` → `/about.html` を書く案。ページが増えるたびに
  追記が要り、出力が `path.html` 規約で一律な以上 `cleanUrls` の一括変換のほうが破綻しない。
  出力側を `about/index.html` 形式に変える案もあるが、`entries.tsx` の出力規約を変える必要があり
  影響範囲が広い。ホスティング設定 1 行で閉じるほうが小さい。
- **404 ページ**: 存在しないパスは出力済みの `404.html` を Vercel が自動で 404 レスポンスに使うため、
  追加設定なしで機能する。

### 2026-06-15 — React Doctor を試用して撤去（指摘の大半が静的構成では誤検知）

React 固有のアンチパターンを検出する `react-doctor`（Oxlint ベースの CLI）をローカル導入して
評価したが、同日中に撤去した。スキャン結果が当リポジトリの構成に噛み合わず、維持コストに見合わないと判断。

- **撤去理由（指摘の質）**: 初回スコアは 47/100（30 件）だったが、実コードを確認すると減点の大半が
  この構成では誤検知だった。最大の発生源は mdast→React の静的レンダラー（`src/markdown/components.tsx`）への
  `no-render-in-render`（15 件）と `no-array-index-as-key`（4 件）で、いずれも「再マウントで state が飛ぶ／
  並べ替えで key が壊れる」を前提とするが、ここはビルド時に一度 HTML へ描くだけで保持すべき state も
  並べ替えも無い。他も、意図的に外部出力させている検索ランタイムの動的 import（`SearchBox.tsx`、`@vite-ignore`）、
  CSS 宣言を分割する `String.indexOf`（`highlight.ts`、配列走査ではない）、OG 画像生成が要求する
  インラインスタイル（`OgCard.tsx`）、vendor したブランドロゴ SVG（`Header.tsx`）など、文脈を読むと妥当なものを
  指摘していた。`dist/` の公開 HTML を「デバッグ成果物」と誤判定もしていた。
- **拾った実改善 1（pnpm サプライチェーン強化・残す）**: react-doctor がきっかけで `pnpm-workspace.yaml` に
  `minimumReleaseAge: "10080"`（7 日）・`trustPolicy: no-downgrade`・`trustLockfile: true` を明示で入れた。
  値・方針は別リポジトリ（`tsuka-ryu-s-blog`）とそろえる。react-doctor とは独立に有効なので残す。
  - **注意（pnpm 11.6.0 の既知の落とし穴）**: `minimumReleaseAge` 等のポリシーが有効な状態で、入れたての
    新しいパッケージを含む再解決（`pnpm add`／`remove`）が走ると、pnpm 11.6.0 の不具合で
    `ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED` を出して失敗することがある（実際 react-doctor 撤去時に
    踏んだ）。lockfile が最新で解決が走らない通常の `install` は通る。`trustLockfile: true` は確定済み
    lockfile の再検証を省くためで、この落とし穴の緩和にもなる。
- **拾った実改善 2（a11y・残す）**: Markdown タスクリストの `disabled`・`readOnly` な checkbox に
  `aria-label`（完了/未完了）を付与（`src/markdown/components.tsx`）。これも独立に有効なので残す。
- **撤去内容**: `react-doctor` devDependency、`doctor` スクリプト、`.claude/` `.agents/` のエージェント
  スキル、インストーラが追加した pre-commit フック（lefthook）と GitHub Actions ワークフローをすべて削除。
- **再評価の指針**: 対話的 UI（クライアント state を持つコンポーネント）が増えたら再検討の余地はある。
  その際は誤検知を `doctor.config` でファイル別に抑制する前提で、CI ではなくローカル triage 用途に絞る。

### 2026-06-15 — Vercel プロジェクトの Git 接続を本リポへ張り替え（pnpm corepack でハマる）

別サイトをデプロイしていた既存の Vercel プロジェクトの Git 接続を、本リポジトリへ張り替えた。
新規プロジェクトを作らず接続だけ差し替えることで、ドメイン（`tsuka-ryu.dev`）・環境変数・
デプロイ履歴をそのまま引き継げる。GitHub 側の旧リポジトリは Vercel が参照をやめるだけで削除されない。

- **手順**: Project Settings → Git で旧リポを Disconnect → 本リポを Connect。張り替え後は自動で
  初回デプロイが走らないことがあるため、空コミット（or ダッシュボードの Redeploy）で初回を蹴る。
- **ハマりどころ（pnpm のバージョン解決でビルド失敗）**: `package.json` に
  `packageManager: "pnpm@11.6.0"` を指定し lockfileVersion も 9.0 で揃えているのに、`vercel.json` の
  `installCommand`（`pnpm install --frozen-lockfile`）が不一致でコケた。原因は Vercel が既定で corepack を
  使わず独自に pnpm バージョンを推測するため。`mise.toml` の pnpm 固定は Vercel からは見えない。
- **修正**: Vercel の Environment Variables に `ENABLE_EXPERIMENTAL_COREPACK=1` を追加（Production /
  Preview 両方）。これで corepack 経由で `package.json` の `packageManager` を尊重し、pnpm 11.6.0 で
  `--frozen-lockfile` が lockfile と一致して通る。設定後に Redeploy で成功を確認。
- **却下した代替**: Vercel ダッシュボード側で Install Command を `pnpm@<ver> install` のように pin する案。
  バージョンが二重管理（package.json と Vercel 設定）になり乖離するため、`packageManager` を単一の
  真実とし corepack に解決させるほうが破綻しない。
- **補足**: 本リポのビルドは環境変数を一切参照しない（`process.env` / `import.meta.env` の使用なし）。
  絶対 URL は `src/constants.ts` の `SITE_URL`（`https://tsuka-ryu.dev`）固定。デプロイ後の確認は
  トップ表示・`/sitemap.xml`・RSS（`/feed`）・OG 画像のプレビュー。
