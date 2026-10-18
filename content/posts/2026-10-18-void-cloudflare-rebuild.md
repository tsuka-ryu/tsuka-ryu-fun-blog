---
title: ブログを Void と Cloudflare で作り直す設計メモ (ADR)
description: 静的生成のブログを Void と Cloudflare Workers の上に載せ替える設計を、ADR の形で書きます。D1 を管理画面専用にして公開側は R2 のスナップショットを読む理由、公開パイプラインの失敗モード、自作 Markdown パーサーの方式、ハイライトと描画の分離、認証、VRT までを、現行コードと動かした検証にもとづいて決めた順に記録します。
date: 2026-10-18
tags: ["ブログ盆栽", "Void", "Cloudflare", "ADR"]
---

> この記事は Claude が書いた記事です。

このブログを Void と Cloudflare Workers の上に作り直します。この記事は、そのための設計判断を ADR (Architecture Decision Record) の形で残したものです。1つの判断ごとに、背景、選んだ案と捨てた案、理由、その判断が連れてくる結果を書きます。実装はこれからで、動かして確かめたのは「検証ログ」にまとめた範囲です。コードは、検証で動かしたものと、設計の説明用のスケッチを区別して書きます。

## 目次の代わりに: 決定の一覧

| ADR | 判断                                                                 | 状態                       |
| --- | -------------------------------------------------------------------- | -------------------------- |
| 1   | ビルド時の静的生成をやめ、Worker が配信してキャッシュする            | 採用                       |
| 2   | D1 は管理画面専用。公開側は R2 のスナップショットだけを読む          | 採用                       |
| 3   | `posts` (公開中) と `post_revisions` (下書き・履歴) の 2 テーブル    | 採用                       |
| 4   | 公開は 1 つの冪等な関数。書く順番は R2 → D1 → キャッシュ無効化       | 採用                       |
| 5   | Markdown パーサーを TypeScript で自作する                            | 採用                       |
| 6   | シンタックスハイライトを描画から切り離す                             | 採用                       |
| 7   | プレビューに位置つきの診断を出し、公開時に検証する                   | 採用                       |
| 8   | 認証は Void 組み込みの Better Auth。サインアップを閉じる             | 採用 (GitHub 連携は未検証) |
| 9   | OG 画像は公開時に WASM で生成して R2 に置く                          | 採用                       |
| 10  | 画像のアップロードは R2 + 内容ハッシュ。WebP 変換の場所は未定        | 提案                       |
| 11  | 見た目の同一性は Vitest ブラウザモードのスクリーンショットで担保する | 採用                       |
| 12  | Void のバージョンは固定せず、最新に追従する                          | 採用                       |

## 現状の構成

判断の前提として、いまの構成を書いておきます。FUNSTACK Static で作った、完全に静的なサイトです。

```text
content/posts/*.md
   │  モジュール評価時 (ビルド) に import.meta.glob で全件を ?raw 読み込み
   ▼
prepareSource (frontmatter 分離) → lintMarkdown → parse (ox-content, Rust/NAPI)
   ▼
JSON.parse → validateUrls → extractToc (見出しに id を付与して目次を返す)
   ▼
Post[] (mdast + toc + body)  ← 以降の getAllPosts / getTagBySlug はこの配列から派生
   ▼
React Server Component で描画 (code ブロックは async + shiki)
   ▼
build.ts: Promise.all([ build(), feed.xml, sitemap.xml, search-index.json, search.js, OG 画像 ])
```

記事の解析は `src/content.ts` のモジュール評価時に、全記事ぶん一度に行われます。ルート (一覧、記事、タグ) も、feed や sitemap も、検索インデックスも、すべてこの `Post[]` から派生します。記事がファイルであることを前提にした作りなので、DB に移すと、この入口を丸ごと差し替えることになります。

システム全体の構成図にすると、次のとおりです。書くのも公開するのも Git が起点で、実行時に動くサーバーはありません。

![現在の構成図。content/posts の Markdown を GitHub に push すると Vercel でビルドされ、静的ファイルが CDN から読者に配信される](/blog/architecture-current.svg)

## 移行後の構成

作り直したあとの全体像です。ADR 2 で決めたとおり、読者が触れる経路 (緑) と、自分だけが触れる経路 (橙) を分けています。読者のリクエストは D1 に届きません。

![移行後の構成図。読者は ISR キャッシュと R2 だけに触れ、管理者は Better Auth を通ってエディタから publish を呼び、D1、R2、ISR に書く](/blog/architecture-after.svg)

公開の処理 (`publish`) だけが、D1、R2、ISR の 3 か所に書きます。読者が見るのは R2 なので、R2 を先に書きます (ADR 4)。

主な違いを並べると、次のとおりです。

| 観点             | 現在 (FUNSTACK Static)                   | 移行後 (Void + Cloudflare)                        |
| ---------------- | ---------------------------------------- | ------------------------------------------------- |
| 記事の置き場     | Git 上の `content/posts/*.md`            | D1 が正。公開版は R2 のスナップショット           |
| 書く方法         | エディタで Markdown を編集して push      | 管理画面で書く (自動保存、プレビュー)             |
| 反映の経路       | push → ビルド → デプロイ                 | 「公開」を押す → R2 に書く → キャッシュを無効化   |
| 読者への配信     | ビルド済みの静的ファイル (Vercel の CDN) | Worker が R2 を読んで SSR。ISR でキャッシュ       |
| 実行時のサーバー | なし                                     | Cloudflare Workers                                |
| Markdown の解析  | ox-content (ネイティブ)。ビルド時のみ    | 自作パーサー (純 TypeScript)。サーバーとブラウザ  |
| OG 画像          | ビルド時に takumi-js で生成              | 公開時に `@takumi-rs/wasm` で生成して R2 に置く   |
| 認証             | なし (管理画面がない)                    | Void 組み込みの Better Auth。サインアップは閉じる |

## ADR 1: 静的生成から、Worker での配信とキャッシュへ

**状態**: 採用

**背景**: 記事を管理画面から書いて DB に置くなら、公開のたびに全ページをビルドし直すのは筋が悪くなります。ビルドには、全記事のパースと lint、OG 画像の生成が含まれます。投稿の反映が「ビルド + デプロイ」の時間に縛られます。

**選択肢**:

| 案  | 内容                                                                                      | 評価                                            |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| A   | Void ネイティブ + Pages mode。Worker で SSR し、ISR でキャッシュ                          | 採用                                            |
| B   | メタフレームワーク (React Router / TanStack Start) を Void のフレームワークモードで載せる | 認証が使えない (下記)                           |
| C   | 静的生成を維持し、管理画面だけ別の Worker にする                                          | 公開のたびに再ビルドが要り、DB を持つ意味が薄い |

**決定**: A。

**理由**:

- 認証 (`void/auth`) は、ネイティブの Void アプリでしか使えません。B ではフレームワーク側に Better Auth を自分で組み込むことになります
- Pages mode では、`pages/foo.tsx` の隣に `pages/foo.server.ts` を置くと、`loader` (GET でデータを返す) と `action` (変更) を同居させられます。ルートがファイルで決まるので、いまの `entries.tsx` が持っているルート走査 (`collectPaths`) が不要になります
- ISR があるので、静的サイトの利点 (読者に返すのはキャッシュ済みの HTML) をほぼ保てます

**結果**:

- `src/app/entries.tsx` (ルートを走査して出力パスに変換する関数) と `src/app/build.ts` (カスタムのビルド処理) は不要になり、消えます
- feed、sitemap、検索インデックス、OG 画像は、ビルド時の成果物ではなくなります。公開のたびに作るものに変わります (ADR 2、4、9)
- 記事を `import.meta.glob` で読む仕組み (`src/content.ts`) も不要です。記事の取得は loader が行います

## ADR 2: D1 は管理画面専用。公開側は R2 のスナップショットを読む

**状態**: 採用

**背景**: D1 の課金は、クエリが読み取った行数と書き込んだ行数でかかります。全件を舐めるクエリや、想定外のアクセスの増加があると、請求が読めなくなります。公開側のリクエストの数は、こちらで制御できません。

**選択肢**:

| 案  | 公開側の読み取り先            | 評価                                                                                           |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| A   | D1 を直接読み、ISR で緩和する | キャッシュのミスと再検証のたびに D1 の読み取りが走る。コストの上限がキャッシュの挙動に依存する |
| B   | D1 を直接読み、ISR なし       | 読者のアクセス数がそのまま読み取り行数になる                                                   |
| C   | KV にスナップショットを置く   | 結果整合で、書いてから読めるまで最大で約 60 秒の遅れがある。公開の直後に古い版が返りうる       |
| D   | R2 にスナップショットを置く   | 採用                                                                                           |

**決定**: D。公開のたびに、公開側が必要とするデータを R2 に書き出し、公開ページの loader は R2 のオブジェクトだけを読みます。D1 は `/admin` と `/api/admin/*` からしか触りません。

**理由**:

- 読者のアクセスが D1 に届かない構成なので、D1 の請求は管理画面を使う自分のアクセス量で決まります。上限を構造で保証できます
- R2 は書いた直後から読める強い整合性を持ち、転送量 (egress) が無料です。読み取りは安い操作として課金されます
- 公開側は「この slug のオブジェクトを 1 つ取る」だけで済み、クエリの設計 (索引の有無、全件走査) の問題が公開側には存在しません

**R2 に置くもの**:

```text
published/posts/<slug>.json    frontmatter + 解析済み AST + 目次 + ハイライト済みトークン
published/posts/<slug>.md      frontmatter 付きの原文 (配信とバックアップを兼ねる)
published/index.json           記事一覧 (列を絞ったもの) とタグ集計
published/search-index.json    クライアント検索用のインデックス
published/feed.xml
published/sitemap.xml
published/og/<slug>.png
```

**結果**:

- 公開関数が書くオブジェクトが増え、書き込みの順番と失敗時の扱いを設計する必要が出ます (ADR 4)
- Void は D1 を作るときに読み取りレプリカ (read replication) を有効にします。同じリクエストの中では書き込みの結果が読めますが、リクエストをまたぐと、レプリカの遅れで古い値が見えることがあります。管理画面では、保存した直後にもう一度 D1 から読み直さず、書き込み系の API が返した値で画面を更新します。どうしても主系から読みたい読み取りは、`env.DB.withSession('first-primary')` を使います
- 管理画面の記事一覧は D1 を読むので、クエリの規律が要ります。`posts(slug)` は unique、一覧は列を絞って `LIMIT` を付けてページングし、`SELECT *` の全件取得はしません

## ADR 3: `posts` と `post_revisions` の 2 テーブル

**状態**: 採用

**背景**: 次の 3 つを同時に満たす必要があります。

1. 公開済みの記事を編集しているあいだも、公開中の版は変わらない
2. 自動保存の書きかけは、壊れていても保存できる
3. 履歴から差分を見て巻き戻せる

**選択肢**:

| 案  | 内容                                                | 評価                                                                       |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| A   | `posts` に公開用と下書き用の列を両方持つ            | 項目を足すたびに 2 か所を直す。履歴は別テーブルが要る                      |
| B   | `posts` は下書きだけ。公開中の版は R2 にだけ持つ    | 管理画面で「何が公開中か」「公開中との差分」を出すのに R2 を引く必要がある |
| C   | `posts` (公開中) と `post_revisions` (下書き・履歴) | 採用                                                                       |

**決定**: C。

```ts
export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  date: text("date").notNull(), // YYYY-MM-DD
  publishedRevisionId: integer("published_revision_id"), // NULL なら未公開
  publishedAt: text("published_at"),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const postRevisions = sqliteTable(
  "post_revisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    postId: integer("post_id").notNull(),
    kind: text("kind", { enum: ["draft", "snapshot", "published"] }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    tags: text("tags").notNull(), // JSON 配列
    createdAt: text("created_at").default(sql`(datetime('now'))`),
  },
  (t) => [index("rev_by_post").on(t.postId, t.kind, t.createdAt)],
);
```

**不変条件** (コードとテストで守るもの):

- `posts` に載るのは公開中の版だけで、`posts.published_revision_id` は必ず `kind = 'published'` のリビジョンを指す
- `kind = 'draft'` は記事ごとに高々 1 行。自動保存は INSERT ではなくこの行の UPDATE
- `snapshot` は前回の版から一定時間 (例: 5 分) が過ぎたときだけ INSERT し、記事ごとに直近 N 件を超えたら古い順に消す。`published` は件数の上限による削除の対象にしない
- 履歴の一覧は `body` を含めず列を絞って取り、本文は選んだ 1 版だけ読む

**結果**:

- 管理画面の記事一覧は `posts` だけを引けば済み、本文の列に触れません。D1 は行ごとの課金なので、本文が大きい `post_revisions` を一覧で読まない設計が、速度とコストの両方に効きます
- タグは `tags(id, name, slug unique)` と、公開中の版に対する `post_tags(post_id, tag_id)` に正規化します。`post_revisions.tags` は JSON の配列で持ち、公開時に `post_tags` へ反映します。タグの slug は、いまの `tagSlug` と同じ `slugify(transliterate(tag))` で作り、`/tags/<slug>` の URL を変えません

## ADR 4: 公開は冪等な 1 つの関数。書く順番は R2 → D1 → 無効化

**状態**: 採用

**背景**: 公開は複数のストレージにまたがる処理です。D1、R2 の複数のオブジェクト、ISR のキャッシュに書きます。これらは 1 つのトランザクションにできないので、途中で失敗したときの状態を設計する必要があります。

**決定**: 公開を `publish(postId)` に集約し、次の順番で書きます。

```ts
async function publish(postId: number) {
  const draft = await loadDraft(postId);

  // 1. 検証。ここで失敗したら、何も書かない
  const parsed = parse(draft.body);
  const diagnostics = [
    ...validateFrontmatter(draft),
    ...lint(parsed),
    ...checkUrls(parsed),
  ];
  if (diagnostics.some((d) => d.severity === "error"))
    throw new PublishError(diagnostics);
  const rendered = await highlightAll(parsed); // ADR 6: コードのトークン化は公開時に済ませる

  // 2. R2: slug をキーにした上書き。何度書いても同じ結果になる
  await storage.put(
    `published/posts/${draft.slug}.json`,
    serialize({ meta, ast: rendered, toc }),
  );
  await storage.put(`published/posts/${draft.slug}.md`, toMarkdownFile(draft));
  await storage.put(`published/og/${draft.slug}.png`, await renderOg(draft)); // 失敗しても公開は止めない (ADR 9)
  await rebuildIndexes(); // index.json / search-index.json / feed.xml / sitemap.xml

  // 3. D1: 公開版を記録して posts を更新する。db.batch で 1 往復、文は連続して実行される
  await db.batch([
    db.insert(postRevisions).values({ ...draft, kind: "published" }),
    db.update(posts).set({/* 公開中の列 */}).where(eq(posts.id, postId)),
  ]);

  // 4. キャッシュを無効化する
  await revalidate({ paths: affectedPaths(draft) }); // その記事、トップ、タグページ、タグ一覧、feed、sitemap
}
```

**失敗モードの表**:

| どこで失敗するか                            | 読者から見える状態                                                                | 管理画面から見える状態         | 回復                     |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ | ------------------------ |
| 1 の検証                                    | 変化なし                                                                          | 診断の一覧が出て、公開が止まる | 記事を直して再実行       |
| 2 の途中 (一部の R2 オブジェクトだけ新しい) | 記事ごとのオブジェクトは新旧どちらか。一覧は古いまま (ISR のキャッシュも古いまま) | 未公開                         | 再実行すれば上書きで揃う |
| 3 の D1                                     | 新しい内容が R2 にあるが、キャッシュが古いので見えない                            | 未公開のまま                   | 再実行                   |
| 4 の無効化                                  | 新しい内容が R2 にあるが、TTL が切れるまで古いページ                              | 公開済み                       | 無効化だけを再実行       |

**理由**:

- 読者が見るのは R2 です。R2 を先に書けば、「管理画面では公開済みなのに、読者には届いていない」という嘘の状態を作りません。逆順だと、D1 だけが先に公開済みになり、R2 の書き込みが失敗したときに管理画面が事実と食い違います
- R2 への書き込みは slug をキーにした上書きなので、再実行しても同じ結果になります (冪等)。そのため、リトライを無条件に許せます
- D1 の `db.batch` は 1 往復で複数の文を連続して実行します。revisions への追加と `posts` の更新を同じ batch に入れて、2 つの不整合を避けます

**取り下げ** (公開→非公開) は逆の順番で、R2 のオブジェクトを消してから D1 を更新し、無効化します。読者の見え方を先に変える、という同じ原則です。

**結果**: 公開は、入力が同じなら何度呼んでも安全で、失敗したらそのまま再実行できます。管理画面は、`posts.published_revision_id` と最新の `draft` の差で、「公開中と下書きに差がある」状態を示せます。

## ADR 5: Markdown パーサーを TypeScript で自作する

**状態**: 採用

**背景**: いまの `@ox-content/napi` は Rust 製のネイティブモジュールで、`.node` のバイナリです。Workers の上では動きません。また、管理画面のプレビューはブラウザで動かす必要があるので、サーバーとブラウザの両方で動くパーサーが要ります。

**選択肢**:

| 案                                                               | 評価                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| remark / unified                                                 | 実績はあるが依存が重い。プラグインの組み合わせで挙動が決まり、AST が現行の形から離れる |
| markdown-it 系 (Void の `@void/md` が使っている `markdown-exit`) | 出力が HTML トークン列で、現行の mdast を前提にしたレンダラーと形が合わない            |
| ox-content の WASM 版                                            | 存在するか未確認。あっても、現行の lint の挙動を持ち込めるか分からない                 |
| 自作                                                             | 採用                                                                                   |

**決定**: TypeScript で自作する。依存はゼロで、サーバーとブラウザの両方で同じコードを動かします。

**理由**:

1. **現行の AST の形をそのまま出せる**。`src/markdown/types.ts` の `MdastNode` (判別可能ユニオン) をそのまま出力の型にすれば、レンダラー (`components.tsx`) と目次抽出 (`extractToc`) は無改修で使い回せます
2. **範囲を絞れる**。既存の 25 本を数えると、使っている構文はごく一部でした。

   | 構文                                                                                   | 使用状況                                                                                                    |
   | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
   | フェンスコード                                                                         | 12 記事・約 400 行。言語は rust / text / bash / json / ts / go / js / jsx / html。`tsx title="..."` が 1 件 |
   | インラインコード・リンク・箇条書き                                                     | ほぼ全記事                                                                                                  |
   | 表                                                                                     | 6 記事                                                                                                      |
   | 引用                                                                                   | 7 記事                                                                                                      |
   | 番号付きリスト、太字、斜体、h4 以上、ネストしたリスト                                  | 数記事ずつ                                                                                                  |
   | 画像                                                                                   | 1 件                                                                                                        |
   | 取り消し線、タスクリスト、脚注、生の HTML、数式、参照リンク、Setext 見出し、ハード改行 | 0 件                                                                                                        |

   現行の `parse` は `taskLists` と `strikethrough` を有効にしていますが、実際の記事では使っていません。`<T>` のようなジェネリクスが 30 か所ほどありますが、すべてコードの中です

3. **位置情報を最初から持てる**。すべてのノードに `position` を持たせると、診断 (ADR 7) が行・桁を指せます

**対応する構文**: ATX 見出し (`#`)、段落、強調 (`*` / `_`)、インラインコード、フェンスコード (言語 + `title="..."`)、リンク、画像、順序ありなし・ネストのリスト、引用、GFM の表 (配置つき)、水平線、`<url>` の自動リンク、バックスラッシュのエスケープ。

**対応しない構文は、黙って落とさない**。取り消し線、タスクリスト、脚注、生の HTML (コードの外の `<` + 英字)、`$...$` の数式は、診断のエラー (`unsupported-syntax`) にします。無視して通すと、書いた内容と表示が食い違うのに気づけません。

**方式**: CommonMark と同じ 2 段の構成にします。

```ts
type Pos = { line: number; column: number; offset: number };
type Position = { start: Pos; end: Pos };
type WithPos<T> = T & { position: Position };

function parse(src: string): {
  ast: WithPos<MdastNode>;
  diagnostics: Diagnostic[];
} {
  const lines = splitLines(src); // 行ごとの offset を保持
  const blocks = parseBlocks(lines); // 1 段目: ブロック構造
  const ast = resolveInlines(blocks); // 2 段目: 段落・見出し・表セルの中身をインライン解析
  return { ast, diagnostics: collect(ast, src) };
}
```

**1 段目: ブロック**。行を上から見て、開いているコンテナのスタック (引用 `>`、リスト項目) に対して各行が継続するかを判定します。

- フェンスコード: 開きのフェンス (` ``` ` の個数と info 文字列) を記憶し、同じ文字で同じ個数以上の閉じフェンスが来るまで、中身を一切解釈せずに溜めます。閉じられないまま入力が終わったら、文末までをコードとして扱い、警告を出します (書きかけでもプレビューを壊さないため)
- リスト: マーカー (`-` `*` `+` `1.`) の桁位置から項目の本文の開始桁を決め、それ以上にインデントされた続きの行を、その項目の子として再帰的にブロック解析します。これでネストしたリストと、項目内の段落・コードが同じ仕組みで扱えます
- 表: ヘッダー行の直後に区切り行 (`| --- | :-: |`) があり、列数が一致したときだけ表にします。セルの分割は、エスケープされていない `|` で、インラインコードの内側は分割しません
- 段落: 他のどのブロックにも当てはまらない連続した行を、段落として溜めます。見出し・フェンス・引用・リスト・水平線の開始行で閉じます

**2 段目: インライン**。段落などの文字列を、次の順に解釈します。

1. バックスラッシュのエスケープと、インラインコード (同じ長さのバッククォートの並びで開閉。中身は解釈しない)
2. リンクと画像: `[` と `![` をスタックに積み、`]` が来たら `(url "title")` が続くかを見て確定します
3. 強調: `*` と `_` の連続 (delimiter run) をスタックに積み、閉じる側が来たときに、直前の開く側と組にします。単語の内側の `_` は強調にしない、といった規則を簡略化して入れます
4. `<url>` の自動リンク。それ以外の `<` + 英字は、コードの外なら生の HTML として診断にします

**検証**:

- **ゴールデンテスト**: 現行の ox-content の出力を正解として、既存 25 本の AST を比べます。位置情報を除いて正規化して比較し、差があれば、新旧のどちらが正しいかを人間が判断して、理由を記録します
- 構文ごとの単体テスト (入力の Markdown と期待する AST の組)
- 任意の入力で例外を投げないことの確認。ランダムな入力と、既存記事を 1 文字ずつ削った入力を流します。書きかけの記事が来るエディタでは、パーサーは全域関数でなければなりません

**結果**: 保守する対象が増えます。CommonMark の細かい仕様 (リンクの参照定義、入れ子の強調の曖昧なケースなど) の全部には従いません。代わりに、サーバーとブラウザで同じコードが動くので、プレビューと本番の見た目がずれる原因がなくなります。

## ADR 6: シンタックスハイライトを描画から切り離す

**状態**: 採用

**背景**: 現行の `CodeBlock` は async の Server Component で、描画の中で shiki を呼びます。

```tsx
async function CodeBlock({ node }: NodeProps<"code">) {
  const lang = /* node.lang を検証 */;
  const { lines, rootStyle } = await highlight(node.value, lang);
  return <pre className="shiki" style={rootStyle} data-lang={lang}>{/* トークンの span */}</pre>;
}
```

`highlight` は shiki の `codeToTokens` と、全言語を含む `bundledLanguages` を使います。ライトとダークの色は、トークンごとの CSS 変数で出力しています。これは「ビルド時にサーバーでだけ動く」前提の作りです。ブラウザのプレビューでは使えません。async の Server Component はクライアントで描画できず、全言語のバンドルをクライアントに載せるのも現実的ではありません。

**決定**: ハイライトを 2 つの関数に分けます。

- `tokenize(code, lang): Promise<ThemedToken[][]>`: shiki を呼ぶ純粋な非同期関数。ライト・ダークの CSS 変数つきのトークン列を返す
- `CodeBlock` は、**トークン列を props として受け取って描画するだけ**の、同期のコンポーネントにする

**使い分け**:

| 場面       | トークン化する場所                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| 公開       | `publish()` の中で、記事の全コードブロックをトークン化し、AST に埋めて R2 に保存する。読者のリクエストでは shiki は動かない |
| プレビュー | ブラウザで、`shiki/core` + JS の正規表現エンジン + 必要な言語だけを動的 import して、トークン化する                         |

**理由**:

- 読者のリクエストで shiki を初期化しなくて済みます。Spike では、`createHighlighterCore` + `createJavaScriptRegexEngine()` の初回の初期化が約 249ms でした (ローカルの workerd)。これを読者のリクエストに載せる理由はありません
- 同じ `tokenize` をサーバーとブラウザで共有するので、プレビューと本番で色がずれません
- 言語を `import()` で必要な分だけ渡せるので、バンドルが絞れます

```ts
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const hl = await createHighlighterCore({
  themes: [
    import("shiki/themes/github-light.mjs"),
    import("shiki/themes/github-dark.mjs"),
  ],
  langs: [import("shiki/langs/typescript.mjs"), import("shiki/langs/rust.mjs")],
  engine: createJavaScriptRegexEngine(), // Oniguruma の WASM を使わない
});
```

**結果**: 現行の `src/markdown/highlight.ts` は、`bundledLanguages` に依存した書き方を変える必要があります。言語名から動的 import へのマップを持ち、未対応の言語は、プレーンテキストとして描画します (現行も `isBundledLanguage` で同様に落としています)。AST に埋めるトークンの量が増えるので、R2 の記事 JSON は大きくなります。記事 1 本ぶんなので、問題になる量ではありません。

## ADR 7: プレビューに位置つきの診断を出し、公開時に検証する

**状態**: 採用

**背景**: 現行は、frontmatter の欠落、`date` の形式、危険な URL、lint の warning を、ビルドの失敗として止めています。管理画面では、書きかけの内容を失いたくないので、保存を止めることはできません。

**決定**:

- **保存は常に通す**。書きかけが壊れていても、自動保存は成功します
- **プレビューに診断を出す**。内容が変わるたびに (debounce して) 再検証し、診断の一覧を行番号つきでプレビューの上部に並べ、クリックでエディタの該当行にジャンプします
- **公開時に、`error` が 1 つでもあれば止める**。公開 API 側でも必ず同じ検証をやり直し、クライアントの検証結果は信用しません

診断の型は、パーサーと lint が共通で返します。

```ts
type Diagnostic = {
  severity: "error" | "warning";
  ruleId: string; // 'heading-increment' | 'duplicate-heading' | 'unsafe-url' | 'unsupported-syntax' | 'repeated-word' ...
  message: string;
  from: number; // ドキュメント先頭からの offset (CodeMirror の範囲指定にそのまま使える)
  to: number;
  line: number;
  column: number;
};
```

**エディタとの接続**: エディタは CodeMirror 6 で、`@codemirror/lint` の `linter()` に同じ診断を `from` / `to` つきで渡すと、エディタ上に波線が出ます。診断の `from` / `to` はドキュメントの offset なので、変換なしで渡せます。

**検証の内容** (現行の `src/content.ts` から移すもの):

| 検査                                                                                                                                       | 重大度                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| frontmatter の必須項目 (`title`)、`date` が `YYYY-MM-DD`、`draft` が真偽値                                                                 | error                                |
| link / image の URL が許可スキーム (`http(s):` `mailto:` `tel:` と相対・絶対パス・フラグメント) に収まる (`javascript:` や `data:` は弾く) | error                                |
| 未対応の構文                                                                                                                               | error                                |
| 重複した見出し、見出しレベルの飛び                                                                                                         | error                                |
| 重複した語 (`repeated-word`)                                                                                                               | error                                |
| 連続した句読点 (`repeated-punctuation`)、連続した空行 (`max-consecutive-blank-lines`)                                                      | warning (現行も非致命に降格している) |

**結果**: 検証ロジックを、パーサーと同じ純 TypeScript の関数として書き、エディタ (ブラウザ) と公開 API (サーバー) で同じものを使います。エラーがあっても描画できる範囲のプレビューは出し、壊れた箇所には、インラインで印を付けます。

## ADR 8: 認証は Void 組み込みの Better Auth。サインアップを閉じる

**状態**: 採用 (ログインの GitHub 連携は未検証)

**背景**: ログインできるのは自分 1 人だけです。

**選択肢**:

| 案                                         | 評価                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Void 組み込みの Better Auth + GitHub OAuth | 採用。自分の GitHub アカウント以外を拒否する                                |
| Cloudflare Access で `/admin` を丸ごと保護 | コードは最小だが、ローカル開発では認証が効かず、Zero Trust の設定が別に要る |
| メール + パスワード                        | パスワード管理が要り、1 人限定にする追加実装が要る                          |

**Spike で確認したこと** (ローカルの workerd):

```ts
// routes/api/private.ts
import { defineHandler } from "void";
import { requireAuth } from "void/auth";

export const GET = defineHandler((c) => {
  const user = requireAuth(c);
  return { email: user.email };
});
```

- 未ログインで呼ぶと `401 Unauthorized`
- メールでサインアップして得たセッション付きで呼ぶと、`200` と `{"email":"me@example.com"}`
- **サインアップは、デフォルトで誰にでも開いています**。何も設定しない状態で、任意のメールアドレスのユーザーを作れました

`auth.ts` で閉じます。

```ts
import { defineAuth } from "void/auth";

export default defineAuth(({ defaults }) => ({
  ...defaults,
  emailAndPassword: { enabled: true, disableSignUp: true },
}));
```

閉じたあとは、知らない人のサインアップが `EMAIL_PASSWORD_SIGN_UP_DISABLED` (HTTP 400) で拒否され、作成済みのユーザーのサインインは通りました。

**Void の認証まわりの挙動** (ドキュメントにあるもの):

- サインイン中のリクエストへのレスポンスには、`Cache-Control: no-store` が付きます。管理画面のレスポンスが共有キャッシュに残りません。ISR のキャッシュも、`Cookie` や `Authorization` が付いたリクエストは素通りします
- `POST` / `PUT` / `PATCH` / `DELETE` と WebSocket は、別のオリジンからだとセッションが使われません (`trustedOrigins` に入れない限り)。CSRF への対策になります
- 認証のエンドポイントには、IP ごとのレート制限が既定で付きます (例: サインインは 10 秒に 3 回)。Worker のインスタンスごとに数えるので、共有したいなら `rateLimit: { storage: 'database' }` を指定します

**結果**: 本番では、GitHub のログインだけを残し、自分のアカウント以外のサインアップを Better Auth のフック (`databaseHooks`) で拒否します。この部分は、GitHub の OAuth App を作ってから確認します。

## ADR 9: OG 画像は公開時に WASM で生成して R2 に置く

**状態**: 採用

**背景**: 現行は `takumi-js` (ネイティブ) でビルド時に OG 画像を作っています。ネイティブは Workers で動きません。

**選択肢**:

| 案                                   | 評価                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| 全記事共通の 1 枚                    | 記事ごとのタイトルが出ない                           |
| アクセス時に動的に生成               | CPU 時間の上限に当たりやすく、キャッシュの設計も要る |
| 公開時に WASM 版で生成して R2 に置く | 採用                                                 |

**決定**: `@takumi-rs/wasm` で、公開時に 1 回だけ生成し、PNG を R2 に置いて配信します。配信は長期キャッシュ付きです。

**Spike で確認したこと** (ローカルの workerd): 1200×630 の PNG が返り、初回の生成は約 95ms でした (フォントを指定しない最小のノードで、サイズは約 1.3KB)。

```ts
import init, { Renderer } from "@takumi-rs/wasm";
import wasmModule from "@takumi-rs/wasm/auto";

let renderer: Renderer | undefined;

export async function renderOg(): Promise<Uint8Array> {
  if (!renderer) {
    // workerd 用の /auto は default export が WebAssembly.Module。init に渡して初期化する
    await init({ module_or_path: wasmModule });
    renderer = new Renderer();
  }
  return renderer.render(
    { type: "container", children: [{ type: "text", text: "Hello OG" }] },
    { width: 1200, height: 630 },
  );
}
```

ハマった点: `init()` を引数なしで呼ぶと、`default is not a function` で落ちます。workerd 用のエントリが、`init` ではなく `WebAssembly.Module` を default export しているためです。

**結果**:

- `.wasm` が約 4MB あり、Worker のスクリプトサイズに効きます。圧縮後のサイズは未計測です
- 日本語を出すには、フォント (Noto Sans JP) を Worker に同梱するか、R2 から読んで渡す必要があります。生成は公開時の 1 回だけなので、フォントの読み込みは公開の処理の中で閉じます
- OG の生成に失敗しても、公開は止めません。共通のフォールバック画像を返し、警告を残します

## ADR 10: 画像は R2 + 内容ハッシュ。WebP 変換の場所は未定

**状態**: 提案

**決定**:

- エディタへのペースト / ドラッグ&ドロップで R2 にアップロードし、`![alt](/images/<ハッシュ>.webp)` を自動で挿入します
- 保存のキーはサーバーが決める、内容のハッシュです。同じ画像を 2 回上げても重複しません
- 配信は Worker 経由で、`Cache-Control: public, max-age=31536000, immutable` と `X-Content-Type-Options: nosniff` を付けます。Void のドキュメントも、ユーザーがアップロードしたファイルに HTML やスクリプトが含まれうるとして、`nosniff` と `Content-Disposition: attachment` を勧めています (画像として `<img>` で表示するぶんには attachment でも表示されます)

**未定**: WebP への変換と横幅の制限 (例: 1600px) をどこで行うか。

| 案                                          | メリット                  | デメリット                                                                                          |
| ------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| ブラウザで Canvas の `toBlob('image/webp')` | サーバーの CPU を使わない | ブラウザの実装に依存する。変換後のバイト列を信用できない (サーバーで型と大きさを検証する必要がある) |
| WASM のライブラリ (サーバー)                | 出力が環境に依存しない    | CPU 時間とバンドルサイズが増える                                                                    |
| Cloudflare Images のバインディング          | 変換が速い                | Void のドキュメントに記載がなく、別のサービスの課金が増える                                         |

Spike の次の項目として、ブラウザでの変換と、サーバー側の検証の組み合わせを試します。

## ADR 11: 見た目の同一性は、スクリーンショットで担保する

**状態**: 採用

**背景**: 作り直しで気づきにくいのは、見た目の崩れです。自作パーサーが既存の記事を正しく解釈できているかも、描画結果で確かめたい。

**決定**: Vitest のブラウザモード (Playwright の Chromium) と `toMatchScreenshot` で、移行前の現行サイトのスクリーンショットをベースラインとして撮り、移行後のサイトに同じテストを向けて比べます。

- **対象**: トップ、代表的な記事 (コード、表、画像、引用、リスト、目次を含むもの)、タグ一覧、タグ詳細、About、404、既存の 25 本すべて。デスクトップとモバイルの 2 つの幅で撮ります
- **安定化**: シェーダー (`ShaderGimmick`) などのアニメーションは止める。Web フォントの読み込みを待ってから撮る。比較の閾値は最小限にする
- **環境の固定**: スクリーンショットは OS やフォントの描画で差が出るので、ベースラインの生成と比較は、同じ Linux の Chromium に揃えます
- **移行前に撮る**: FUNSTACK を外す前に現行のサイトで撮り、ベースラインを `main` にコミットしておきます。移行前の状態が `main` に残るので、後からの比較に使えます

**結果**: 移行が終わったあとも、CI で回し続けます。Void の更新で見た目が壊れたときに気づけます (ADR 12 の前提)。

## ADR 12: Void のバージョンは固定せず、最新に追従する

**状態**: 採用

**背景**: Void は 2026 年 10 月に OSS 化された新しいプロジェクトで、v1.1.11 です。破壊的な変更が入る可能性があります。

**決定**: バージョンを固定せず、最新に追従します。バージョン固定と薄いラッパーによる逃げ道は用意しません。

**理由**: ラッパーを挟むと、Void を使う利点 (自動のプロビジョニング、組み込みの認証、ISR) が薄まります。個人のブログで、更新のたびに手で確認するコストより、最新に付いていくコストのほうが小さいと判断しました。

**結果**: 更新で壊れたときに気づけるよう、ADR 11 の VRT と、型チェックと lint を CI で回し続けます。

## 検証ログ (Spike)

リポジトリの外に、最小の Void アプリ (`pages/` + `routes/` + D1) を作り、ローカルの workerd で確かめました。環境は Node 24.22.0、`void` 1.1.11、Vite 8、`shiki` 4.5.0、`@takumi-rs/wasm` 2.16.3 です。

| 項目                                                                              | 結果                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------ |
| Pages mode の SSR と loader、API ルート                                           | 動いた                                     |
| D1 (Drizzle) への書き込みと読み取り                                               | 動いた                                     |
| R2 への書き込みと読み取り                                                         | 動いた                                     |
| Better Auth: メールでのサインアップ、セッション付きの保護ルート、未ログインの 401 | 動いた                                     |
| サインアップを `disableSignUp` で閉じる                                           | 動いた (`EMAIL_PASSWORD_SIGN_UP_DISABLED`) |
| `revalidate({ paths })` の呼び出し                                                | 例外なく呼べた                             |
| shiki (JS エンジン)                                                               | 動いた (初回約 249ms)                      |
| `@takumi-rs/wasm` で OG 画像                                                      | 動いた (初回約 95ms)                       |
| Cloudflare への `void deploy`、本番の ISR のキャッシュ、本番の CPU 時間とメモリ   | これから確認する                           |
| 画像の WebP 変換、GitHub OAuth                                                    | これから確認する                           |

ハマった点は次のとおりです。

- Node は 24.21.0 以上が必要です (このリポジトリは 24.16.0 に固定しているので、Void を入れるときに上げます)
- Vite は 8 系が必要です。7 系だと、`@void/react` が引き込む `@vitejs/plugin-react` が `vite/internal` を解決できず、`ERR_PACKAGE_PATH_NOT_EXPORTED` で起動しません
- D1 や R2 の使用を新しく書いたあとは、開発サーバーの再起動が必要です。`New D1 (void/db) binding detected. Restart to apply.` と出ます。再起動前は `Missing Cloudflare binding 'DB'` で 500 になります
- pnpm のビルドスクリプトは `esbuild` / `sharp` / `workerd` を許可し、`better-sqlite3` は無効にします

再現の手順は、リポジトリの `docs/void-spike-verification.md` に、ファイルの全文つきで書いてあります。

## 進め方

本番は、切り替えの日まで今のままにしておきます。統合ブランチを 1 本切って、そこを土台にして、フェーズごとの PR を `gh stack` で積みます。`gh stack` は GitHub が出している、PR を積み重ねるための公式の拡張です。

| フェーズ | やること                                        |
| -------- | ----------------------------------------------- |
| 0        | 動くかを確かめる実験 (ローカルは済)             |
| 1        | いまのサイトのスクリーンショットを撮る (ADR 11) |
| 2        | Markdown のパーサーを作る (ADR 5、6、7)         |
| 3        | Void を入れて、FUNSTACK を外す (ADR 1)          |
| 4        | 公開関数と、公開側のページ (ADR 2、3、4)        |
| 5        | ログインと管理画面 (ADR 7、8、10)               |
| 6        | OG 画像と、既存記事の取り込み (ADR 9)           |
| 7        | 見た目と URL を、移行前と突き合わせる           |
| 8        | ドメインを Cloudflare に切り替える              |
| 9        | ドキュメントを直す                              |

計画の全文は `docs/void-cloudflare-rebuild.md` にあります。作り直しが終わると、この記事も、管理画面から書いたものに置き換わっているはずです。
