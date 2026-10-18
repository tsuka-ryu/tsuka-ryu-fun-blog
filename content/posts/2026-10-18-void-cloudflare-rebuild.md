---
title: ブログを Void と Cloudflare で作り直します
description: 静的生成のブログを、Void と Cloudflare Workers の上の動的な構成に載せ替えます。D1 は管理画面だけ、公開側は R2 のスナップショットを読む設計と、公開パイプライン、自作 Markdown パーサー、プレビューのエラー表示までを、動かした検証コードつきで書きます。
date: 2026-10-18
tags: ["ブログ盆栽", "Void", "Cloudflare"]
---

> この記事は Claude が書いた記事です。

この記事では、いまのブログを Void と Cloudflare Workers の上に作り直す設計を、動かして確かめたコードといっしょに書きます。中心になるのは、D1 と R2 の役割分担、公開パイプライン、自作する Markdown パーサー、プレビューでのエラー表示の4つです。

## いまの構成と、変えるところ

いまのブログは FUNSTACK Static で作っています。ビルドのときに全ページを HTML にして、Vercel に置くだけの静的なサイトです。

```text
content/posts/*.md
   │  ビルド時・Node 上で実行
   ▼
ox-content (Rust/NAPI)  → mdast → React (Server Component) + shiki
   ▼
静的 HTML + RSC ペイロード / feed.xml / sitemap.xml / 検索インデックス / OG 画像
   ▼
Vercel (静的ホスティング)
```

記事を書くには `.md` を編集して Git に push します。この構成は、ランタイムにサーバーがいらず、速くて壊れません。変えるのは、書く側の体験です。

- ブラウザの管理画面から、自分だけがログインして記事を書く
- 書いている途中で、本番と同じ見た目のプレビューをその場で見る
- 記事は DB に持つ。ただし Markdown でも配信する

記事が DB にある以上、投稿のたびに全ページを再ビルドするのは筋が悪くなります。そこで、ビルド時に作る静的サイトから、Worker が配信してキャッシュするサイトに変えます。

## 全体の設計

```text
            ┌──────────── 管理画面 (/admin, 認証あり) ────────────┐
            │  エディタ + プレビュー (同じパーサー / レンダラー)    │
            └───────────────┬─────────────────────────────────┘
                            │ 自動保存 / 公開
                            ▼
  ┌──────────────────────────────────────┐
  │ Worker (Void)                        │
  │   routes/api/admin/*  (requireAuth)  │
  │   公開関数 publish()                  │
  └───────┬──────────────────┬───────────┘
          │ 編集用の正        │ 公開スナップショット
          ▼                  ▼
        D1                  R2  ──►  公開ページの loader (D1 は読まない)
   posts / post_revisions    published/posts/<slug>.json
   tags / assets             published/posts/<slug>.md
                             published/index.json, search-index.json,
                             feed.xml, sitemap.xml, og/<slug>.png
```

この設計の一番のポイントは、**D1 を管理画面からしか使わない**ことです。D1 は読み取った行数と書き込んだ行数で課金されます。全件を舐めるクエリや、急なアクセス増で、請求が読めなくなる事故が起きえます。読者のアクセスが D1 に届かなければ、その心配は構造的になくなります。

そのために、公開するたびに「公開側が必要とするもの」を R2 に書き出します。公開ページの loader は R2 のオブジェクトだけを読みます。R2 は転送量が無料で、読み取りも安い操作です。

## Void で何が書けるか

Void は Vite をベースにしたフルスタックの SDK で、Cloudflare Workers の上で動きます。GitHub の [voidzero-dev/void](https://github.com/voidzero-dev/void) で公開されていて、ドキュメントも同じリポジトリに入っています。きっかけは、azukiazusa さんの [Void で Vite のアプリを Cloudflare にデプロイする記事](https://azukiazusa.dev/blog/void-vite-cloudflare-deploy) でした。

### Pages mode: loader と action

`pages/` にコンポーネントを置くとルートになります。隣に `*.server.ts` を置くと、サーバーだけで動く `loader`（GET でデータを返す）と `action`（変更）を書けます。loader の戻り値が、そのままコンポーネントの props になります。

```ts
// pages/index.server.ts
import { defineHandler } from "void";

export type Props = Readonly<{ now: string }>;
export const revalidate = 3600; // ISR の TTL (秒)
export const loader = defineHandler<Props>(() => ({ now: new Date().toISOString() }));
```

```tsx
// pages/index.tsx
import type { Props } from "./index.server.ts";

export default function Home({ now }: Props) {
  return <h1>spike {now}</h1>;
}
```

初回のリクエストはサーバーでレンダリングした HTML が返り、以降のページ遷移は loader だけを呼んで画面を差し替えます。

### バインディングは使い方から推論される

D1 や R2 は、`wrangler.toml` に書きません。コードから `void/db` や `void/storage` を import すると、Void がそれを検出して、デプロイのときに必要なリソースを用意します。

```ts
// routes/api/d1.ts
import { posts } from "@schema";
import { defineHandler } from "void";
import { db, eq } from "void/db";

export const GET = defineHandler(async () => {
  await db.insert(posts).values({ slug: `s-${Date.now()}`, title: "hello" });
  const rows = await db.select().from(posts).limit(3);
  const one = await db.select().from(posts).where(eq(posts.id, 1));
  return { count: rows.length, first: one[0] ?? null };
});
```

スキーマは `db/schema.ts` に Drizzle で書きます。`void db generate` でマイグレーションの SQL を作り、`void deploy` のときに適用されます。D1 の `db.batch([...])` で複数の文を 1 往復にまとめることもできます。

```ts
// routes/api/r2.ts
import { defineHandler } from "void";
import { storage } from "void/storage";

export const GET = defineHandler(async () => {
  await storage.put("published/test.json", JSON.stringify({ ok: true }), {
    httpMetadata: { contentType: "application/json" },
  });
  const obj = await storage.get("published/test.json");
  return { body: obj ? await obj.json() : null };
});
```

### ISR とオンデマンド無効化

`revalidate` に秒数を書くと、レンダリング結果が Worker のキャッシュに入ります。キャッシュが古くなっても、次のリクエストには古いページを返しつつ、裏で新しいページを作り直します。レスポンスヘッダーの `x-isr-cache` で、`MISS` / `HIT` / `STALE` のどれかが分かります。`Cookie` や `Authorization` の付いたリクエストはキャッシュを素通りするので、ログイン中の管理画面とは干渉しません。

公開したタイミングで、関連するページだけを即座に無効化できます。

```ts
import { defineHandler } from "void";
import { revalidate } from "void/isr";

export const POST = defineHandler(async () => {
  await revalidate({ paths: ["/", "/posts/hello"] });
  return { ok: true };
});
```

この作り直しでは、TTL を長く（1 日〜無期限）取り、公開・更新・削除のたびに、その記事、トップ、記事が属するタグページ、タグ一覧、feed、sitemap を無効化します。

## データモデル

編集中の下書きと公開中の版を混ぜないために、テーブルを 2 つに分けます。

```ts
// db/schema.ts
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

- `posts` には**公開中の版だけ**が入ります。管理画面の記事一覧は `posts` だけを引くので軽くなります
- `post_revisions` の `kind = 'draft'` は記事ごとに 1 行で、自動保存はその行を上書きします
- `snapshot` は前回から一定時間が経ったときに残す履歴、`published` は公開時の版で、件数の上限による削除の対象にしません

履歴の一覧は、本文の `body` を含めず列を絞って取ります。本文を読むのは、差分を見たい 1 版だけです。D1 の行数は、課金のためだけでなく、速度のためにも絞ります。

## 公開パイプライン

公開は、1 つの関数に集約します。

```ts
async function publish(postId: number) {
  const draft = await loadDraft(postId);

  // 1. 検証。エラーがあれば、ここで止めて何も書かない
  const parsed = parse(draft.body); // 自作パーサー (サーバーとブラウザで共通)
  const diagnostics = [...validateFrontmatter(draft), ...lint(parsed), ...checkUrls(parsed)];
  if (diagnostics.some((d) => d.severity === "error")) throw new PublishError(diagnostics);

  // 2. D1: 公開版を記録して posts を更新 (1 往復)
  const rev = await db.batch([
    db
      .insert(postRevisions)
      .values({ ...draft, kind: "published" })
      .returning(),
    db
      .update(posts)
      .set({
        /* 公開中の列 */
      })
      .where(eq(posts.id, postId)),
  ]);

  // 3. R2: 公開側が読むものを書き出す
  await storage.put(
    `published/posts/${draft.slug}.json`,
    JSON.stringify({ meta, ast: parsed, toc }),
  );
  await storage.put(`published/posts/${draft.slug}.md`, toMarkdownFile(draft));
  await rebuildIndexes(); // index.json / search-index.json / feed.xml / sitemap.xml
  await renderOgImage(draft); // WASM で PNG を作って R2 へ

  // 4. キャッシュを無効化
  await revalidate({ paths: affectedPaths(draft) });
}
```

どこかで失敗しても、再実行すれば同じ結果に収束する（冪等）ようにします。R2 への書き出しは上書きで、`posts` の更新は最後の方に置くので、途中で止まっても「公開済み」の状態が先に立つことはありません。

`/posts/<slug>.md` は、R2 の `.md` をそのまま `text/markdown` で返します。バックアップと配信が同じファイルです。`draft` の記事は R2 の公開側に書き出さないので、どちらの形でも配信されません。

## Markdown パーサーを自作する

いまは Rust 製の ox-content（NAPI）で Markdown を mdast に変換しています。ネイティブのバイナリは Workers の上で動きません。remark のような JavaScript のパーサーに乗り換える手もありますが、パーサーを自分で持てば、サーバー（保存時の検証・公開）とブラウザ（プレビュー）で同じコードを動かせます。プレビューと本番の見た目がずれる余地がなくなります。

### 出力は現行の mdast と互換にする

出力する AST は、いまのレンダラー（`src/markdown/`）が受け取る `MdastNode` と同じ形にします。レンダラーと目次抽出は、ほぼ無改修で使い回せます。

### 対応範囲は実際に使っている分だけ

既存の 25 本の記事を数えると、使っている構文は次のとおりでした。

| 構文                                                          | 使用状況                                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| フェンスコード                                                | 12 記事・約 400 行。言語は rust / text / bash / json / ts / go / js / jsx / html。`tsx title="..."` の形が 1 件 |
| インラインコード・リンク・箇条書き                            | ほぼ全記事                                                                                                      |
| 表                                                            | 6 記事                                                                                                          |
| 引用                                                          | 7 記事                                                                                                          |
| 番号付きリスト、太字、斜体、h4 以上の見出し、ネストしたリスト | 数記事ずつ                                                                                                      |
| 画像                                                          | 1 件                                                                                                            |

取り消し線、タスクリスト、脚注、生の HTML、数式、参照リンクは、1 件も使っていません。対応しません。未対応の構文が書かれたら、黙って無視せずに lint のエラーとして知らせます。

### ブロックとインラインの 2 段で解析する

CommonMark と同じ考え方で、2 段に分けます。

1. **ブロックの走査**: 行を上から見て、見出し・フェンスコード・リスト・引用・表・段落に切り分けます。リストと引用は、インデントと `>` の深さをスタックで持ちます。フェンスコードの中は、閉じるフェンスが来るまで何も解釈しません
2. **インラインの解析**: 段落や見出しの文字列から、コードスパン、リンク、強調を取り出します。強調は、`*` と `_` の並び（delimiter run）をスタックに積み、閉じる側が来たときに対応する開く側と組にします

行の位置を持ち回ることが大事です。すべてのノードに `position`（開始と終了の行・桁）を持たせます。これが、プレビューのエラー表示で「何行目の何桁」を指すための土台になります。

### 検証は、現行の出力との比較でする

ox-content の出力を正解として、既存 25 本の AST をスナップショットで比べます。構文ごとの単体テストも書きます。差分がゼロになるまで直す、というのが完成の基準です。

## プレビューにエラーを出す

書きかけの記事は、壊れていても保存できるようにします。保存を拒否すると、書きかけの内容を失うのが怖くなるからです。その代わり、**プレビューに検証の結果を出します**。

パーサーと lint が返す診断は、位置つきの値にします。

```ts
type Diagnostic = {
  severity: "error" | "warning";
  ruleId: string; // 'heading-increment', 'unsafe-url', 'unsupported-syntax', ...
  message: string;
  from: number; // ドキュメント先頭からのオフセット
  to: number;
  line: number;
  column: number;
};
```

エディタには CodeMirror 6 を使い、`@codemirror/lint` の `linter()` に同じ診断を渡します。波線がエディタの該当箇所に出ます。プレビューのタブでは、上部に診断の一覧を行番号つきで並べ、クリックするとエディタの該当行に飛びます。エラーがあっても、描画できる範囲はプレビューに出し、壊れた箇所にはインラインでエラーの印を付けます。

保存と公開の可否は別です。保存は常に通し、公開のときにだけ、`error` が 1 つでもあれば止めます。公開の API 側でも必ず同じ検証をやり直します。ブラウザから届いた「検証済み」は信用しません。

検証する内容は、いまの `src/content.ts` が持っているものを移します。

- frontmatter の必須項目（`title`、`date` が `YYYY-MM-DD`、`draft` が真偽値）
- link と image の URL の許可スキーム。`javascript:` や `data:` は弾く
- 重複した見出し、見出しレベルの飛び、連続した句読点、重複した語

## Workers の上で動かす部品

ネイティブ依存を外すと、残りの部品が Workers の上で動くかが問題になります。Spike として、リポジトリの外に最小の Void アプリ（`pages/` + `routes/` + D1）を作り、ローカルの workerd で確かめました。

### shiki は JS の正規表現エンジンで動く

shiki のデフォルトは、Oniguruma の WASM です。`shiki/engine/javascript` の JS 実装に替えると、WASM なしで動きます。

```ts
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const hl = await createHighlighterCore({
  themes: [import("shiki/themes/github-dark.mjs")],
  langs: [import("shiki/langs/typescript.mjs"), import("shiki/langs/rust.mjs")],
  engine: createJavaScriptRegexEngine(),
});
const html = hl.codeToHtml("const a: number = 1;", { lang: "typescript", theme: "github-dark" });
```

テーマと言語を `import()` で必要な分だけ渡すので、バンドルに入る量を絞れます。ハイライターの初期化は初回で約 249ms でした。記事のコードは保存時にハイライト済みの HTML かトークンにして持てば、読者のリクエストでは初期化が走りません。

### OG 画像は WASM 版 Takumi で作る

いまの OG 画像は `takumi-js`（ネイティブ）で作っています。同じ作者の `@takumi-rs/wasm` は、WebAssembly 版です。Workers 向けの `@takumi-rs/wasm/auto` は、default export が `WebAssembly.Module` なので、`init` に渡して初期化します。

```ts
import init, { Renderer } from "@takumi-rs/wasm";
import wasmModule from "@takumi-rs/wasm/auto";

let renderer: Renderer | undefined;

export async function renderOg(): Promise<Uint8Array> {
  if (!renderer) {
    await init({ module_or_path: wasmModule });
    renderer = new Renderer();
  }
  return renderer.render(
    { type: "container", children: [{ type: "text", text: "Hello OG" }] },
    { width: 1200, height: 630 },
  );
}
```

`init()` を引数なしで呼ぶと `default is not a function` で落ちます。ここで少しハマりました。初回の生成は約 95ms で、1200×630 の PNG が返りました。`.wasm` は約 4MB あります。生成は公開のときに 1 回だけ行い、PNG を R2 に置いて配信します。

## 認証は自分だけ

Void には Better Auth が設定済みで入っています。`void/auth` の `requireAuth(c)` を呼ぶだけで、保護ルートになります。

```ts
import { defineHandler } from "void";
import { requireAuth } from "void/auth";

export const GET = defineHandler((c) => {
  const user = requireAuth(c);
  return { email: user.email };
});
```

未ログインで呼ぶと `401 Unauthorized` が返り、メールでサインアップしたセッション付きで呼ぶと `200` と `{"email":"…"}` が返ることを確かめました。

注意点が 1 つあります。デフォルトでは、メール+パスワードのサインアップが誰にでも開いています。管理画面を自分だけにするには、`auth.ts` で閉じます。

```ts
// auth.ts
import { defineAuth } from "void/auth";

export default defineAuth(({ defaults }) => ({
  ...defaults,
  emailAndPassword: { enabled: true, disableSignUp: true },
}));
```

こうすると、知らない人のサインアップは `EMAIL_PASSWORD_SIGN_UP_DISABLED`（HTTP 400）で拒否され、作成済みのユーザーのサインインは通ります。本番では GitHub ログインを使い、自分のアカウント以外のサインアップを Better Auth のフックで拒否します。

## 見た目が変わっていないことを確かめる

作り直しで気づきにくいのが、見た目の崩れです。移行の前に、いまのサイトのスクリーンショットを撮っておきます。Vitest のブラウザモードで、テストの中に対象のページを読み込み、`toMatchScreenshot` でベースラインと比べます。

- 対象は、トップ、代表的な記事、タグ一覧、タグの詳細、About、404、既存の 25 本すべて。デスクトップとモバイルの 2 つの幅で撮る
- シェーダーなどのアニメーションは止め、Web フォントの読み込みを待ってから撮る
- スクリーンショットは OS やフォントの描画で差が出るので、ベースラインの生成と比較は、同じ Linux の Chromium に揃える

25 本すべてを描画して比べるので、自作パーサーが既存の記事を正しく解釈できているかの確認も兼ねます。移行が終わったあとも、依存の更新で見た目が壊れたときに気づけるように、CI で回し続けます。

## 進め方

本番は、切り替えの日まで今のままにしておきます。統合ブランチを 1 本切って、そこを土台にして、フェーズごとの PR を `gh stack` で積みます。`gh stack` は GitHub が出している、PR を積み重ねるための公式の拡張です。

| フェーズ | やること                                       |
| -------- | ---------------------------------------------- |
| 0        | 動くかを確かめる実験（済: ローカルの workerd） |
| 1        | いまのサイトのスクリーンショットを撮る         |
| 2        | Markdown のパーサーを作る                      |
| 3        | Void を入れて、FUNSTACK を外す                 |
| 4        | 公開関数と、公開側のページ                     |
| 5        | ログインと管理画面                             |
| 6        | OG 画像と、既存記事の取り込み                  |
| 7        | 見た目と URL を、移行前と突き合わせる          |
| 8        | ドメインを Cloudflare に切り替える             |
| 9        | ドキュメントを直す                             |

計画の全文は `docs/void-cloudflare-rebuild.md`、Spike の再現手順は `docs/void-spike-verification.md` にあります。

作り直しが終わると、この記事も、管理画面から書いたものに置き換わっているはずです。
