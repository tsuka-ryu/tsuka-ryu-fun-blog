# アーキテクチャ解説

FUNSTACK Static で作る静的技術ブログの設計解説。
「なぜこの構成なのか」を残すドキュメント（実装の手順は `build-log.md`、設計図は
`/Users/tsukaryu/Documents/funstack-static-test/docs/build-from-scratch.md`）。

## 全体像

このブログは **ビルド時に全ページを HTML として吐き出す静的サイト**。
ランタイムにサーバーは要らず、生成物（HTML / RSC ペイロード / 検索インデックス /
RSS / sitemap / OG 画像）を静的ホスティングに置くだけで動く。

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

| 処理                                   | 実行場所               | 理由                                                       |
| -------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| Markdown → mdast 変換（ox-content）    | ビルド時・サーバーのみ | ネイティブ(NAPI)バイナリ。ブラウザに載らない／載せたくない |
| シンタックスハイライト（shiki）        | ビルド時・サーバーのみ | 重い。色は HTML に焼き込めば十分でランタイム不要           |
| 目次抽出・タグ集計                     | ビルド時・サーバーのみ | 入力（記事）が静的なので一度計算すれば足りる               |
| OG 画像生成（Takumi/Rust）             | ビルド時・サーバーのみ | ネイティブ依存。記事ごとに 1 枚 PNG を焼くだけ             |
| 検索インデックス構築（ox-content）     | ビルド時・サーバーのみ | ネイティブ依存。出力した純 JS ランタイムだけをブラウザへ   |
| RSS / sitemap 生成                     | ビルド時・サーバーのみ | 記事一覧から組み立てる静的 XML                             |
| 画面遷移・インタラクティブ部品（"島"） | クライアント           | ユーザー操作に反応する所だけ                               |

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
content/posts/*.md   記事のソース（frontmatter + Markdown、フェーズ9）
src/
├─ app/            フレームワーク結線（フェーズ2 / 7）
│  ├─ Root.tsx       全ページ共通の HTML シェル（Server Component）
│  ├─ App.tsx        ルート定義。記事/タグから動的にルート生成
│  ├─ ClientApp.tsx  @funstack/router の <Router> をラップ（Client Component）
│  ├─ entries.tsx    ルートツリー → 生成すべき HTML エントリ一覧に変換
│  └─ build.ts       build entry。RSS / sitemap / 検索 / OG を追加出力（フェーズ7）
├─ markdown/       mdast → React レンダラー（フェーズ3）
│  ├─ types.ts       mdast ノードの判別可能ユニオン（type で判別）
│  ├─ components.tsx mdast 各 type → Server Component（switch ディスパッチ）
│  ├─ highlight.ts   shiki ハイライト（ビルド時のみ）
│  └─ index.tsx      <Markdown> 入口
├─ lib/            ユーティリティ（フェーズ3〜）
│  ├─ toc.ts         見出しスラッグ付与 & 目次抽出（フェーズ3）
│  ├─ time.ts        時刻処理の集約。JST 固定で formatDate / RFC822 等（フェーズ4）
│  ├─ feed.ts        RSS 2.0 + sitemap 生成（ビルド時、フェーズ4）
│  ├─ search.ts      検索インデックス & クライアントランタイム生成（→ docs/search.md）
│  └─ og.ts          OG 画像生成（Takumi、ビルド時、フェーズ4）
├─ og/             OG カード（フェーズ4）
│  ├─ OgCard.tsx     Takumi が解釈する OG カードの要素ツリー
│  └─ fonts/         同梱フォント（Noto Sans JP Bold）
├─ components/     UI 部品（フェーズ5）
│  ├─ Layout.tsx     Header / Footer で <Outlet> を挟む共通枠
│  ├─ Header.tsx     ナビ（現在地をアクティブ表示、Client Component）
│  ├─ Footer.tsx     静的フッター（コピーライト + クレジット）
│  ├─ PostCard.tsx   記事サマリーカード（一覧で使用）
│  ├─ TagList.tsx    タグ → /tags/<slug> リンク
│  ├─ PostToc.tsx    目次（アンカーのみ・クライアント JS 不要）
│  ├─ SearchBox.tsx  全文検索ボックス（Client Component）
│  ├─ Seo.tsx        <head> メタデータ出力（React 19 の巻き上げ）
│  └─ ShaderGimmick.tsx  島デモ（WebGL シェーダー）
├─ pages/          ページ（フェーズ6）
│  ├─ HomePage.tsx   記事一覧 + 検索
│  ├─ PostPage.tsx   記事本文 + 目次 + タグ
│  ├─ AboutPage.tsx  自己紹介 + 島デモ
│  ├─ TagsPage.tsx   タグ一覧
│  ├─ TagPage.tsx    タグ別記事一覧
│  └─ NotFoundPage.tsx  404
├─ styles.css      全体スタイル（shiki デュアルテーマ変数含む、フェーズ8）
├─ content.ts      記事読み込み & ox-content 変換 + ビルド時検証（サーバー）
├─ constants.ts    サイト共通定数（SITE_TITLE / SITE_DESCRIPTION / SITE_URL / SITE_TIME_ZONE）
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

### ビルド時に壊れた記事を弾く

`content.ts` は「正しくない記事はビルドを通さない」方針で、上の変換の各段に検証を挟む。
ランタイムが無い静的サイトなので、不正はすべてビルド失敗で気付ける。

- **frontmatter 検証**（`assertFrontmatter`）— `title` が非空文字列、`date` が
  `YYYY-MM-DD` であることを検証。満たさなければ `throw`。
- **parse エラー** — `parsed.errors` があれば `throw`（握り潰さない）。
- **URL スキーム検証**（`SAFE_URL` allowlist + `validateUrls`）— link/image の `url` を
  走査し、`javascript:` / `data:` 等の危険スキームを含む記事はビルド失敗。
- **Markdown lint**（`lintPost`、`@ox-content/napi` の `lintMarkdown`）— 重複見出し・
  連続空行・繰り返し語/記号などを検査し、`error`/`warning` があれば `throw`。
  例外として `max-consecutive-blank-lines` は ox-content 側の誤判定（コードフェンス直後の
  単独空行を連続空行扱いする）があるため `NON_FATAL_RULES` で非致命に降格している。

### switch ディスパッチのレンダラー

mdast ノードの描画は **`type` で分岐する switch ディスパッチ**で行う
（`src/markdown/components.tsx` の `MarkdownNode`）。

- `MdastNode`（`types.ts`）は **判別可能ユニオン**。`type` を判別子に、各 variant が
  自分に必要なフィールドだけを持つ（旧設計の「全フィールド optional な 1 形 + レジストリ」
  から改修。レジストリの相関キャスト問題を構造的に解消し、optional 由来の防御コードも撤去）。
- `MarkdownNode` が `node.type` で `switch` し、各 case で `node` が自動 narrowing される。
  `heading` / `paragraph` / `link` / `table` などを **Server Component** として描画。
  union 外の type は `default`（型上 `never`）で `Unknown` にフォールバック（ビルド保険）。
- `<Markdown root>`（`index.tsx`）が入口。`root` の mdast を受け取って描画するだけで、
  かつての `components` オーバーライド機能は不要と判断して削除済み。

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

## lib とビルド時生成（フェーズ4）

記事データ（`content.ts`）と定数（`constants.ts`）を入力に、配信用の副産物
（RSS / sitemap / 検索インデックス / 検索ランタイム / OG 画像）を**ビルド時に生成**する
ユーティリティ群。いずれもサーバー環境でのみ呼ばれ、後フェーズの build entry
（`src/app/build.ts`）から出力ディレクトリへ書き出される。

### 時刻は JST に固定（`time.ts`）

時刻処理は `src/lib/time.ts` に集約し、**サーバー（ビルド）もクライアント
（ハイドレーション）も `SITE_TIME_ZONE`（Asia/Tokyo）固定**で扱う。

- **なぜ固定するか** — SSG はサーバーで描いた HTML をクライアントが再水和する。
  `Temporal.Now` をシステム TZ で呼ぶと両者がズレてハイドレーション不一致になる。
  固定 TZ 定数を必ず渡すことで、どの環境でも同じ結果になる。
- **`Date` を使わない** — 日付は軽量ポリフィル `temporal-polyfill-lite`（ESM-only /
  型同梱、ponyfill 形で global を汚さない）の Temporal で扱う。
- `formatDate`（暦日表示。`PlainDate` で TZ 非依存）／ `nowInTokyo`／ `dateInTokyo`／
  `toRfc822`（RSS 用。オフセットは実値で JST なら +0900）を提供。
- 日付の妥当性は `content.ts` の frontmatter 検証で担保済みのため、不正値は
  `PlainDate.from` の `RangeError` でビルドを落とす（握り潰さない）。

### RSS / sitemap（`feed.ts`）

`getAllPosts` / `getAllTags` と `SITE_*` 定数から `feed.xml`（RSS 2.0）と
`sitemap.xml` を組み立てる。`SITE_URL` 基準で絶対 URL を解決し、XML エスケープを通す。
sitemap の `/about`・`/tags` はフェーズ6のページ前提のハードコード（TODO で明示）。

### 検索（`search.ts`）

`@ox-content/napi` でビルド時に検索インデックス（JSON）と**純 JS のクライアント
ランタイム**を生成する。ネイティブモジュールはブラウザに届かず、クライアントが使うのは
出力された JS（`/search.js`）と JSON（`/search-index.json`）だけ。記事は
`title` / `body` / `headings` / `code` のフィールドに分けて索引する（見出し語は
`body` に重複させない）。**仕組みの詳細は `docs/search.md`** を参照。

### OG 画像（`og.ts` / `og/OgCard.tsx`）

`takumi-js`（Takumi/Rust、ヘッドレスブラウザ不要）で記事ごとに 1200×630 の OG 画像を
焼き、`<outDir>/og/<slug>.png` に書き出す。`OgCard` は DOM/RSC ではなく **Takumi が
解釈する要素ツリー**（satori 風）で、多子ボックスは `display: flex`。CJK 表示のため
**Noto Sans JP Bold を同梱**（内蔵 family 名 "Noto Sans JP" を確認済み）。render は
CPU バウンドなので並列数を制限し、絵文字は twemoji を CDN 取得して共有キャッシュする。

## コンポーネントとページ（フェーズ5 / 6）

UI は `src/components/`（部品）と `src/pages/`（ページ）に分かれる。ほとんどは
**Server Component** で、ユーザー操作が要る所だけ `"use client"` の島にする。

- **ページ** — `HomePage`（記事一覧 + 検索）/ `PostPage`（本文 + 目次 + タグ）/
  `AboutPage`（自己紹介 + 島）/ `TagsPage`（タグ一覧）/ `TagPage`（タグ別一覧）/
  `NotFoundPage`（404、`noindex`）。`PostPage` / `TagPage` は対象が無ければ
  `NotFoundPage` にフォールバックする。
- **共通枠** — `Layout` が `Header` / `Footer` で `<Outlet>` を挟む。本文は `defer()` で
  分割されるため `<Suspense>` で囲む。
- **クライアントの島は 3 つだけ** — `Header`（`useLocation` で現在地をアクティブ表示）/
  `SearchBox`（`/search.js` を動的 import）/ `ShaderGimmick`（WebGL）。残りは
  すべてサーバーで描画され、クライアント JS を増やさない。
- **メタデータ** — `Seo` が `<title>` / `<meta>` / `<link>` を出すだけで、React 19 が
  それらを `<head>` に巻き上げる。記事は OG 画像（`/og/<slug>.png`）を `type="article"` で
  参照する。`SeoProps` は website / article の判別可能ユニオン。

## ビルド出力（フェーズ7）

`src/app/build.ts` が build entry。`@funstack/static/server` の `BuildEntryContext`
（`{ build, outDir }`）を受け取り、既定ビルド `build()` と並列に（`Promise.all`）
フェーズ4 の生成器を `outDir` 直下へ書き出す: `feed.xml` / `sitemap.xml` /
`search-index.json` / `search.js` / `og/<slug>.png`。追加生成を `build()` と並列化して
クリティカルパスから外している。

## ルーティングと静的出力（フェーズ2 / 6）

- `App.tsx` が `routes`（`RouteDefinition[]`）を定義。記事/タグは
  `getAllPosts()` / `getAllTags()` から `route()` を **動的生成** し、各ページを
  `defer()` で独立 RSC ペイロードにする（Markdown 変換コードをクライアントに載せないため）。
- `entries.tsx` が `routes` を再帰走査してフルパス一覧を集め、各パスを
  「SSR パス + 出力 HTML ファイル名」に変換（`/`→`index.html`、
  `/posts/x`→`posts/x.html`、`/*`→`404.html`）。これがビルドの入力になる。
- 各エントリは `root`（`Root.tsx` の HTML シェル）+ `app`（`App`）の組で出力される。
- ブラウザ側では `ClientApp` の `<Router>` がハイドレーション後の SPA 遷移を担当。
  `fallback="static"` で、まだ JS が無い状態でも静的 HTML が見える。

## スタイル（フェーズ8）

`src/styles.css`（`ClientApp` が副作用 import）。配色は light/dark の CSS 変数で
`prefers-color-scheme` に追従し、shiki も `--shiki-light` / `--shiki-dark` 変数で
テーマ追従する（クライアント JS なし）。記事レイアウトは広い画面で本文 + sticky 目次の
2 カラムグリッド。

## ビルドと配信（フェーズ10）

`pnpm build` で `dist/public/` に静的ファイル一式（HTML / RSC ペイロード /
feed.xml / sitemap.xml / 検索インデックス・ランタイム / OG 画像）が出る。これを任意の
静的ホスティングへ置くだけで動く。本番オリジンは `constants.ts` の `SITE_URL` 単一情報源
（canonical / OG / RSS / sitemap の絶対 URL に使われる）。

> 配信メモ: `vite preview` は `dist/public/` を配信するが、ローカルでは `/` →
> `index.html` のディレクトリ index 解決をしない。本番の静的ホストは解決するので実害なし。

進捗・各フェーズの詳細な作業履歴は `build-log.md` を参照。
