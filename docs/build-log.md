# 作業ログ — FUNSTACK 静的ブログ

参考手順書: `/Users/tsukaryu/Documents/funstack-static-test/docs/build-from-scratch.md`

このファイルは「実際にこのリポジトリでやったこと」を記録する。
タスクを終えるたびに追記していく（参考手順書はあくまで設計図、こちらは実際の作業履歴）。

## 進捗サマリ

| フェーズ | 内容 | 状態 |
| --- | --- | --- |
| 環境 | mise で Node / pnpm を固定 | ✅ 完了 |
| 0 | 前提（Node 20+ / pnpm） | ✅ 完了 |
| 1 | 初期化・依存・設定ファイル | ✅ 完了 |
| 2 | アプリの骨組み | ✅ 完了 |
| 3 | コンテンツ & Markdown レンダリング | ✅ 完了 |
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
