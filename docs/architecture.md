# アーキテクチャ解説

FUNSTACK Static で作る静的技術ブログの設計解説。
「なぜこの構成なのか」を残すドキュメント（実装の手順は `build-log.md`、設計図は
`/Users/tsukaryu/Documents/funstack-static-test/docs/build-from-scratch.md`）。

## 全体像

このブログは **ビルド時に全ページを HTML として吐き出す静的サイト**。
ランタイムにサーバーは要らず、生成物（HTML / RSC ペイロード / 検索インデックス /
RSS / sitemap）を静的ホスティングに置くだけで動く。

```
content/posts/*.md                 ← 記事のソース（frontmatter + Markdown）
        │
        │ ① ビルド時・サーバー環境だけで実行
        ▼
  ox-content (Rust/NAPI)            prepareSource → parse
        │
        ▼
     mdast (JSON)  ──②── extractToc で見出しに id 付与 & 目次抽出
        │
        │ ③ React で描画（Server Component）
        ▼
  Markdown レンダラー (src/markdown/)  + shiki でコードをハイライト
        │
        ▼
   静的 HTML + RSC ペイロード         ← 各ルートごとに 1 ファイル
        │
        │ ④ ブラウザ
        ▼
  ハイドレーション + Router で SPA 遷移（"島"だけ JS）
```

## 設計の軸: サーバー / クライアント境界

このプロジェクトで最も重要な判断は **「重い処理とネイティブ依存はビルド時の
サーバー環境だけで動かし、クライアント JS には一切載せない」** こと。

| 処理 | 実行場所 | 理由 |
| --- | --- | --- |
| Markdown → mdast 変換（ox-content） | ビルド時・サーバーのみ | ネイティブ(NAPI)バイナリ。ブラウザに載らない／載せたくない |
| シンタックスハイライト（shiki） | ビルド時・サーバーのみ | 重い。色は HTML に焼き込めば十分でランタイム不要 |
| 目次抽出・タグ集計 | ビルド時・サーバーのみ | 入力（記事）が静的なので一度計算すれば足りる |
| 画面遷移・インタラクティブ部品（"島"） | クライアント | ユーザー操作に反応する所だけ |

この境界を支える具体策:

- **ネイティブモジュールの除外** — `@ox-content/napi` / `takumi-js` /
  `@takumi-rs/core` を `vite.config.ts` の `ssr.external` と
  `optimizeDeps.exclude` に列挙し、バンドラが `.node` を取り込まないようにする。
- **import するファイルで境界が決まる** — `src/content.ts` や
  `src/markdown/highlight.ts` は **Server Component からしか import されない**ので、
  そこに書いた重い依存（ox-content / shiki）はクライアントバンドルに到達しない。
- **`"use client"` を付けた島だけがクライアントに渡る** — 例:
  `src/components/ShaderGimmick.tsx`（WebGL シェーダー）。ブラウザ専用 API を使うので
  マウント後に遅延描画する client-only ガードを入れている。

## ディレクトリ構成

手順書はフラット構成（`src` 直下に全部）だが、本リポジトリは **結線を `src/app/` に
集約** して `src` 直下の見通しを良くしている（詳細は `CLAUDE.md`）。

```
src/
├─ app/            フレームワーク結線（フェーズ2）
│  ├─ Root.tsx       全ページ共通の HTML シェル（Server Component）
│  ├─ App.tsx        ルート定義。記事/タグから動的にルート生成
│  ├─ ClientApp.tsx  @funstack/router の <Router> をラップ（Client Component）
│  └─ entries.tsx    ルートツリー → 生成すべき HTML エントリ一覧に変換
├─ markdown/       mdast → React レンダラー（フェーズ3）
│  ├─ types.ts       mdast ノードのゆるい型 + レジストリ型
│  ├─ render.tsx     ノードを type でディスパッチ
│  ├─ components.tsx mdast 各 type → Server Component の既定レジストリ
│  ├─ highlight.ts   shiki ハイライト（ビルド時のみ）
│  └─ index.tsx      <Markdown> 入口
├─ lib/            ユーティリティ（フェーズ3〜）
│  └─ toc.ts         見出しスラッグ付与 & 目次抽出
├─ components/     UI 部品
│  └─ ShaderGimmick.tsx  島デモ
├─ content.ts      記事読み込み & ox-content 変換（サーバー）
├─ constants.ts    サイト共通定数（SITE_TITLE 等）
└─ vite-env.d.ts
```

### 規約

- **import は subpath imports** — 相対パスではなく package.json の
  `"imports": { "#*": "./src/*" }` を使う。例 `#markdown/types.js` /
  `#lib/toc.js` / `#app/App.js`。拡張子は `.js` 規約（`moduleResolution: bundler`）。
- **コメントは日本語**。各ファイルの主要な関数/エクスポートの直上に役割コメントを置く。
- **TypeScript はネイティブ版 tsgo に一本化**（`pnpm typecheck` = `tsgo --noEmit`）。
- **依存の末端から作る**。未作成モジュール依存はスタブを作らず**コメントアウト**で
  逃がし、各コミットを tsgo green に保つ。

## Markdown レンダリングの仕組み（フェーズ3）

### データの流れ

1. `content.ts` が `import.meta.glob("../content/posts/*.md", { query: "?raw",
   eager: true })` で全記事を **生文字列** として読み込む。これはビルド時の
   サーバー環境で走るので ox-content（ネイティブ）が安全に使える。
2. `prepareSource(raw, { frontmatter: true })` で YAML frontmatter を分離。
3. `parse(body, { gfm, tables, taskLists, ... })` で本文を **mdast（JSON）** に変換。
4. `extractToc(mdast)` が見出しノードに一意な `id` を**破壊的に付与**しつつ、
   h2〜h3 の目次（`TocEntry[]`）を返す。id を mdast に書き込むので、後で描画される
   見出しと目次リンクのアンカーが自動的に一致する。
5. 記事は新しい順（`frontmatter.date` 降順）に整列。タグは `tagMap` に集計。

取得用 API: `getAllPosts` / `getPostBySlug` / `getAllTags` / `getTagBySlug` /
`tagSlug`。これらをページ（フェーズ6）やルート定義（`App.tsx`）が使う。

### レジストリ方式のレンダラー

mdast ノードの描画は **「type 文字列 → コンポーネント」のレジストリ**で行う
（`src/markdown/types.ts` の `MarkdownComponents`）。

- `MarkdownNode` がノードの `type` でレジストリを引き、対応コンポーネントに委譲。
  未知の type は `unknown` フォールバックへ。
- `defaultComponents`（`components.tsx`）が `heading` / `paragraph` / `link` /
  `table` などの既定レンダラーを提供。すべて **Server Component**。
- `<Markdown root components>`（`index.tsx`）に `components` を渡せば
  既定の上にマージして個別差し替えできる（拡張ポイント）。

### コードハイライトがクライアント JS ゼロな理由

`CodeBlock` は **async Server Component**。`highlight.ts` の `highlight()` を
`await` し、shiki が返したトークンを自前で `<span>` 群として描画する
（`dangerouslySetInnerHTML` 不使用）。

- shiki が動くのは **ビルド時（RSC ペイロード描画時）だけ**。色は静的 HTML に
  焼き込まれ、ハイライターはブラウザに送られない。
- 色はベタ書きせず **github-light / github-dark のデュアルテーマを CSS 変数**で
  出力（`codeToTokens(..., { defaultColor: false })`）。これで
  `prefers-color-scheme` のダーク/ライトに CSS だけで追従できる
  （`styles.css` の `--shiki-light` / `--shiki-dark`、フェーズ8）。
- 未対応・未指定の言語は `"text"` にフォールバックし、未知のコードフェンスで
  ビルドが壊れないようにしている。

## ルーティングと静的出力（フェーズ2）

- `App.tsx` が `routes`（`RouteDefinition[]`）を定義。記事/タグは
  `getAllPosts()` / `getAllTags()` から `route()` を **動的生成** し、各ページを
  `defer()` で独立 RSC ペイロードにする予定（ページ実装はフェーズ6で有効化）。
- `entries.tsx` が `routes` を再帰走査してフルパス一覧を集め、各パスを
  「SSR パス + 出力 HTML ファイル名」に変換（`/`→`index.html`、
  `/posts/x`→`posts/x.html`、`/*`→`404.html`）。これがビルドの入力になる。
- 各エントリは `root`（`Root.tsx` の HTML シェル）+ `app`（`App`）の組で出力される。
- ブラウザ側では `ClientApp` の `<Router>` がハイドレーション後の SPA 遷移を担当。
  `fallback="static"` で、まだ JS が無い状態でも静的 HTML が見える。

## まだ無いもの（今後のフェーズ）

| フェーズ | 内容 |
| --- | --- |
| 4 | `lib/`（site / format / feed=RSS+sitemap / search / og）|
| 5 | コンポーネント（Layout / Header / Footer / PostCard / TagList / PostToc / SearchBox / Seo）|
| 6 | ページ（Home / Post / About / Tags / Tag / NotFound）。`App.tsx` のルートを順次有効化 |
| 7 | `src/app/build.ts`（RSS / sitemap / 検索インデックスの書き出し）|
| 8 | `styles.css`（shiki のデュアルテーマ CSS 変数を含む）|
| 9 | サンプル記事（`content/posts/*.md`）|
| 10 | ビルド & 配信 |

進捗の最新は `build-log.md` の進捗サマリを参照。
