# Void Spike で調べたことの Q&A

`docs/void-spike-verification.md` の手順を手で進める中で出た疑問と、その答えのメモ。
「確認した」ものはソースやドキュメントで裏を取ったもの、「未確認」は推測を含むもの。
ソースの参照先は、Void のリポジトリ（`voidzero-dev/void`）の `docs/` と、Spike で入れた `node_modules/` のもの。

## 環境・準備

### `void prepare` は何をするか

型定義と設定ファイルを `.void/` に生成する。`tsconfig.json` の `extends` 先である `.void/tsconfig.json` や、
`db.d.ts`、`routes.d.ts` などが作られる。ローカルで完結し、Cloudflare には接続しない。生成物なので Git には入れない。
（確認: `.void/` の中身を見た。個々の型の用途は未確認）

### `void db push` は何をするか

`db/schema.ts` のテーブル定義を、ローカルの D1 に直接反映する。マイグレーションのファイルは作らない。
本番デプロイ前の `void db generate` は、マイグレーションの SQL ファイルを作る別のコマンド。
（確認: 手順書の記述のみ。内部動作は未確認）

### D1 はローカルにあるのか

本物の D1 は Cloudflare 上のサービスで、ローカルにはない。ローカルでは `miniflare` が、D1 と同じ API を持つ
SQLite のファイルを手元に作って模擬する。実体は `.void/v3/d1/` の下。本番に deploy すると別の D1 が作られ、
ローカルのデータは引き継がれない。（確認: `.void/v3/` の中身を見た）

### ローカルの Cloudflare 環境は Void 本体の機能か、Vite プラグインか

`void` パッケージが `@cloudflare/vite-plugin`、`miniflare`、`workerd`、`drizzle-orm`、`better-auth` などを依存に持つ。
`vite.config.ts` の `voidPlugin()` がこれらをまとめて組み込むと思われる。（確認: 依存の一覧のみ。`voidPlugin()` の
内部で何を呼んでいるかは未確認）

### `.void-wrangler.jsonc` はコミットするか

しない。`void init` が作る雛形の `.gitignore` にも入っている（`node_modules/void/dist/init-*.mjs` の
`SCAFFOLD_GITIGNORE_LINES`）。あわせて `.void`、`.wrangler`、`.env` 系も無視する。

### `minimumReleaseAge`（公開から一定期間の版を入れない設定）は入れるか

pnpm の `pnpm-workspace.yaml` に `minimumReleaseAge: 4320`（分）と書くと、公開から 3 日未満の版を選ばなくなる。
サプライチェーン攻撃対策になるが、今回は入れないことにした。入れる場合の注意:

- すでにロックファイルにある版は対象外。
- 新規に解決するとき、最新版が期間内なら古い版が選ばれる。範囲を満たす版がなければエラーになる。
- `void` と `@void/react` は 1.1.11 固定なので、この版が期間内だと弾かれる。
- pnpm v11（ブログ本体は 11.6.0）の既定値や挙動は未確認。

### dev サーバーの中で、どこで何が動くか

`pnpm exec vite` で立つ 1 つの dev サーバーの中で、コードは 3 か所で動く。

| 場所                                         | 動くもの                                                                      | 役目                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Node（自分の Mac）                           | `vite.config.ts`、`void.config.ts`、`auth.ts`（起動時に 1 回）                | 設定を読む。`auth.ts` から認証用のテーブルを作る                   |
| `workerd`（Mac 上の Workers 互換ランタイム） | `routes/`、`pages/*.server.ts`、`durable-objects/`、`auth.ts`（リクエスト時） | リクエストを処理する本体。本番の Cloudflare と同じ種類のランタイム |
| ブラウザ                                     | `pages/index.tsx`（hydration）                                                | `curl` で確かめただけなので、動かしていない                        |

`workerd` の中で使う D1・R2・KV・Durable Object は、`miniflare` が `.void/v3/`（`d1`・`r2`・`kv`・`do`・`cache`）の
ファイルで模擬する。Cloudflare には何も作らない。

### `void/kv` の実装

Cloudflare の KV の上に薄いラッパーを被せただけの小さなファイル（`packages/void/src/runtime/kv.ts`、ビルド後は
`dist/runtime/kv.mjs`、約 100 行）。

- `kv` は、実行時に `requireRuntimeBinding("KV")` で `KV` バインディング（`KVNamespace`）を取り出す。`Missing Cloudflare
binding 'KV'` は、この関数が出すエラー。
- 書くときは `JSON.stringify`、読むときは `JSON.parse`（失敗したら生の文字列）。`ttl` は `expirationTtl`、`expiration` と
  `metadata` はそのまま渡す。`delete`・`list`・`getWithMetadata` も Cloudflare のメソッドを呼ぶだけ。
- `kv.map("sessions")` は、キーの先頭に `sessions:` を付け、一覧で返すときに外す。
- 加算（`increment`）や「読んで消す」（`getAndDelete`）はない。Cloudflare の KV 自体にその操作がないため。

## ルーティングと SSR

### ハンドラーの中身は Hono か

Hono ベース。Void のドキュメント（`docs/guide/server-routing.md`）に「Void uses Hono for routing and middleware」と
ある。`defineHandler` のハンドラーは Hono の `Context` を受け取り、`c.req.json()` や `c.header()` が使える。
戻り値は自動で変換される（オブジェクトは JSON、`string` は HTML、`null` は 204、`Response` はそのまま）。

### ルーティングの規則

`pages/` と `routes/` のどちらも、ファイルの位置が URL になる（`docs/guide/pages-routing/overview.md`）。

- 動的セグメントは `[param]`、残り全部にマッチするのは `[...param]`、URL に出さないグループは `(group)/`。
- `_` で始まるファイルやディレクトリは無視される。
- ページ側では `useParams<{ slug: string }>()` で値を受け取る。
- ブログの `/posts/:slug` は `pages/posts/[slug].tsx` と `pages/posts/[slug].server.ts` で作れるはず（未試行）。

### SSR はどういう仕組みか

React の標準 API を使っているだけ。

1. リクエストが来ると、`pages/*.server.ts` の `loader` を実行する。
2. その値を props にして、ページを `react-dom/server` の `renderToReadableStream` で HTML にする。
3. HTML に `<script id="__VOID_PAGE_DATA__" type="application/json">` で loader のデータを埋め込む。
4. ブラウザで `react-dom/client` の `hydrateRoot` が、同じデータを props にして HTML に React をつなぐ。

（確認: `@void/react/dist/runtime/pages-server.mjs` と `pages-client.mjs`）

Node 用の `renderToString` ではなく Web 標準の Stream を使うのは、Cloudflare Workers で動かすためと思われる。

### SSR の出力に `<!-- -->` が入るのはなぜか

React の SSR は、隣り合うテキストノード（`spike ` と `{now}`）を区別するために、間に `<!-- -->` を挟む。
手順書の確認コマンドは `grep -o '<h1.*</h1>'` にしないと、時刻が途中で切れる。

### `Accept: text/html` は必須か

未確認。ドキュメントには、`Accept` で HTML と JSON を切り替えるという記述が見当たらなかった。
ヘッダーなしの `curl -s localhost:5199/` で確かめる。

### 他に使えそうな機能

- `ssr = false` を `.server.ts` に書くと、そのページだけクライアント描画になる。
- `output: "static"` と `prerender` で、ビルド時に HTML を作れる（`docs/guide/ssg.md`、未読）。
- `Link`（`@void/react`）でページ間を SPA 移動できる。`useRouter()` の `router.visit()` でプログラムからも移動できる。

## 認証

### `void/auth` と `requireAuth` は何か

`void/auth` は [Better Auth](https://www.better-auth.com/) を Void が設定してくれる入口。Better Auth の設定、DB 接続、
`/api/auth/*` のルート、クライアントを用意する（`docs/guide/auth.md`）。`requireAuth(c)` はリクエストの Cookie から
セッションを引き、ログイン済みならユーザーを返し、未ログインなら `401` を投げる。保護されるのは、それを呼んだ
ルートだけ。`getSession()` / `getUser()` は未ログインのとき `null` を返す（loader で未ログインを許すとき用）。

### Better Auth は middleware か

middleware ではなく認証ライブラリ。実体は `/api/auth/*` を処理するハンドラーで、「ログイン済みか」の確認は
Cookie からセッションを引く関数にすぎない。middleware で全ルートに通すか、ハンドラーの先頭で呼ぶかは使う側の選択。
Void は後者の形（`requireAuth`）を基本にしている。

### セッションの中身と置き場所

Cookie に入るのは意味のない乱数のトークン。サーバー側の `session` テーブルが、トークンと `userId`、`expiresAt`、
`ipAddress`、`userAgent` を結びつける。既定ではアプリと同じ DB（D1）に置かれる（`docs/guide/auth.md`、
`.void/better-auth-schema.ts`）。`user` / `account`（パスワードのハッシュや外部ログイン）/ `verification` も同じ DB に入る。

「Cookie にセッション ID を入れて DB と照合する」方式は、Rails や Django などが昔から使っている標準的な構成。
JWT（トークンにユーザー情報を入れる）や Redis / KV にセッションを置く方式もある。

### SSO はどう関係するか

ログインの方法（メール+パスワード、GitHub、Google など）と、ログイン後のセッションは別の話。どの方法でも、成功したら
`session` に行を作って Cookie を返す。Void は `auth.providers` で外部ログインを足せる（例: `["email", "github"]`、
`AUTH_GITHUB_CLIENT_ID` / `AUTH_GITHUB_CLIENT_SECRET`）。企業向けの SAML / OIDC は `auth.md` に記述が見つからなかった。

### セッションを KV に置けるか

Void のドキュメントには記述がない。Better Auth には `secondaryStorage` というオプションがあり（`better-auth@1.7.10`
で確認）、`defineAuth` で足せる。ただし `SecondaryStorage` の型は `get`・`set`・`delete` に加えて、アトミックな
`getAndDelete` と `increment` を求める。KV にはこれらがないので近似で代用することになる（手順は
`docs/void-spike-verification.md` の A5b）。ローカルでは動いた。サインインでセッションが KV に入り、D1 の `session` は
0 件のまま、`/api/private` も通った。

つまずきが 2 つあった。

- `auth.ts` はプロジェクト直下にあり、バインディングの自動検出の走査対象外（`routes`・`middleware`・`pages`・`src` など
  だけが対象）。`void.config.ts` に `inference: { bindings: { kv: true } }` が要る。
- KV の設定が足りない状態でサインアップすると、ユーザーだけ D1 に作られてセッション作成で失敗する。やり直しは
  サインアップではなくサインインで行う。

このブログは管理者が自分 1 人で、公開ページは認証を通らず ISR で返るため、D1 のままで足りる。KV を足すと、結果整合
（ログアウト直後に古い値が残りうる）、構成の増加、全セッション破棄の面倒さが増える。学習として試す位置づけ。

### `auth.ts` の「アトミックでない近似」とは何か

アトミックとは、途中で他の処理が割り込めないひとかたまりの操作のこと。`increment`（加算して新しい値を返す）は、
本来 1 命令で行う。KV にはないので「読む → 1 足す → 書く」の 3 段階に分けて書いた。その間に別のリクエストが読むと、
2 回加算したのに結果が 1 回分になる（取りこぼし）。`getAndDelete`（読んで消す）も 2 段階なので、その間に別のリクエストが
同じ値を読める。

影響は小さい。`increment` はレート制限のカウンター用で、そこだけ `rateLimit: { storage: "memory" }` にして KV に置かない。
`getAndDelete` の用途は未確認（一度きりのトークン用と思われる）。管理者が自分 1 人で同時リクエストがほぼ重ならない。
厳密にやるなら、操作が直列化される Cloudflare の Durable Objects（Void の `docs/guide/durable-state.md`、未読）や D1 を使う。

### サインアップを閉じる確認で、どのコードが動いているか

`/api/auth/*` は、Void が Better Auth のハンドラーをつないだルートで、自分で書いた `routes/` のファイルではない。
どちらのリクエストも `workerd`（本番の Workers と同じ種類のランタイム）の中で動く。

サインアップが拒否されるとき（`sign-up/email`）:

1. `auth.ts` の `disableSignUp: true` が読まれる。
2. Better Auth の `sign-up.mjs` が `emailAndPassword.disableSignUp` を見て、`EMAIL_PASSWORD_SIGN_UP_DISABLED`（400）を返して終わる。
3. D1 にも Durable Object にも触らない。ユーザーは作られない。

サインインが通るとき（`sign-in/email`、`sign-in.mjs` の `signInEmail`）:

1. `findUserByEmail` が、メールアドレスで D1 の `user` と `account` を引く。
2. `account` のパスワードのハッシュと、送ったパスワードを照合する（照合のコードは未読）。
3. `createSession` がセッションを作る。`auth.ts` の `secondaryStorage.set` が呼ばれ、Durable Object（`SessionStore`）に書く。
   D1 の `session` テーブルには書かない。
4. `setSessionCookie` が `Set-Cookie` を付ける。レスポンスに `token` と `user` が入る。

自分で書いたコードで動いたのは `auth.ts`（設定と `secondaryStorage` の 5 つのメソッド）と
`durable-objects/session-store.ts`（セッションの保存先）。ユーザー検索、パスワード照合、Cookie の組み立ては
Better Auth のコード（`node_modules/better-auth/dist/api/routes/`）。

### 実験: KV と Durable Object で並行に加算するとどうなるか

同じカウンターを 50 回、10 並列で加算した（ローカルの dev サーバー）。

| 方式                                              | 結果                     |
| ------------------------------------------------- | ------------------------ |
| KV（読む → 1 足す → 書く）                        | 9（41 回分が取りこぼし） |
| Durable Object（`context.state.count += amount`） | 50                       |

KV は、同時に同じ値を読んだリクエストがそれぞれ 1 を足して書くので、ほとんどの加算が上書きで消える。Durable Object は
同じ名前への呼び出しが 1 つずつ順に実行される（`docs/guide/durable-state.md`）ので、全部数えられる。

実装は Spike の `durable-objects/counter.ts`（`defineDurableState`）と `routes/api/counter.ts`
（`mode=kv` / `mode=do` で切り替え）。KV 版は加算を意図的に原子的でなく書いてある。再現は次のとおり。

```sh
seq 50 | xargs -P 10 -I{} curl -s -X POST 'localhost:5199/api/counter?mode=kv&name=t1' > /dev/null
curl -s 'localhost:5199/api/counter?mode=kv&name=t1'
```

`name` を変えると 0 から数え直せる。未確認: 本番での挙動、Durable Object を `secondaryStorage` の 5 つのメソッドに
つなぐ実装。

### Durable Object とは何か

名前で指定する、状態を持った小さなサーバー。`Counter.get("t1")` の `"t1"` が名前で、同じ名前なら世界で常に同じ
1 つのインスタンスに届く。インスタンスは自分の状態（`{ count: 0 }`）を持ち、メソッドの呼び出しは 1 つずつ順に実行される。
メソッドが成功したあとに状態が保存され、失敗したら `context.state` は元の値に戻る（`docs/guide/durable-state.md`）。

|          | 普通の Worker                        | Durable Object            |
| -------- | ------------------------------------ | ------------------------- |
| 状態     | 持たない（リクエストごとに作り直し） | 名前ごとに持つ            |
| 同時実行 | 世界中で何個も並行して動く           | 同じ名前は世界で 1 つだけ |
| 保存先   | KV や D1 など外部                    | 自分専用の SQLite         |

KV は「置き場所」、Durable Object は「置き場所とその持ち主（コード）のセット」。KV は値を取り出して手元で足して書き戻す
（その間に他人が割り込める）のに対して、Durable Object は「足してくれ」と頼むだけで、足す処理が状態のそばで行われる。

用途は、ショッピングカート、チャットルーム、レート制限、WebSocket の接続を束ねる処理、アラームによる定期処理など。
Void の WebSocket ルートも内部では Durable Object を使う。

制約（ドキュメントより）: 独自のクラスは 1 プロジェクトで 32 個まで。名前を変えると別のインスタンスになる。
デプロイしたあとは `void.lock.json` のマイグレーションを削除・並べ替えしない。Spike で使い始めると、Void が
`void.lock.json` に `COUNTER` のバインディングと `CounterDurableObject`（`new_sqlite_classes`）を自動で書いた。

一般知識（未確認）: 実体は最初にアクセスした場所の近くで 1 つだけ動き、遠くから呼ぶと遅くなる。同じ名前に処理が
集中すると順番待ちが長くなる。

### セッションを Durable Object に置く実装

Spike の `auth.ts` を、KV 版から Durable Object 版に書き換えた（`durable-objects/session-store.ts`）。ローカルで動いた。
サインインでセッションが作られ、`/api/private` が通り、D1 の `session` は 0 件のまま、`.void/v3/do/` にキーごとの SQLite が
できた。`void.lock.json` には `SESSION_STORE` のバインディングとマイグレーションが自動で追加された。

- キー 1 つにつき Durable Object 1 つ（名前がキー）。同じキーへの呼び出しは直列なので、`getAndDelete` と `increment` が
  原子的になる。キーごとに別のオブジェクトなので、全リクエストが 1 か所に集中しない。
- 状態は `{ value, expiresAt }`。TTL は期限を持たせて、読むときに期限切れなら空として扱う。`setAlarm` で期限に状態を空にする。
- `increment` は TTL を最初の加算のときだけ付け、あとの加算では延ばさない（Better Auth の仕様）。
- 原子的になったので、KV 版で `memory` に逃がしていたレート制限の設定は外した。

KV 版は Git の履歴（`13b9a44`）に残っている。

つまずきが 2 つあった。どちらも、`auth.ts` が起動時に Vite を通さず素の Node の `import()` で読み込まれること（Void の
`loadVoidAuthConfig`）が原因。

- import に拡張子 `.ts` がないと `ERR_MODULE_NOT_FOUND` で dev サーバーが起動しない。
- Durable Object のモジュールを先頭で import すると、その先の `void/durable` が `cloudflare:workers` を import していて、
  Node が読めず `ERR_UNSUPPORTED_ESM_URL_SCHEME` になる。メソッドの中で動的に import して回避した。KV 版が先頭の import で
  動いたのは、`void/kv` が Cloudflare 専用のモジュールを読まないため。

### 3 つの置き場所のメリットとデメリット

|            | D1（既定）                                                             | KV                                                                                         | Durable Objects                                                                                                       |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| メリット   | 追加設定が不要。原子的な操作が使える。全セッション破棄が `DELETE` 一発 | 世界中の拠点で速く読める。TTL で期限切れが自動で消える                                     | 呼び出しが直列化され、加算や「読んで消す」が自然に原子的。書いた値がすぐ見える                                        |
| デメリット | リクエストごとに DB を引く。規模が大きいと負荷になりうる               | 原子的な操作がなく近似で代用。書いた直後に古い値が見えることがある。全セッション破棄が面倒 | 5 つのメソッドを自前で実装。TTL の自動削除がなく自前で掃除。同じ名前に処理が集中する。`void.lock.json` の管理が増える |

このブログは管理者が自分 1 人なので、D1 が一番よい。KV と Durable Objects は学習としての位置づけ。

### Redis や AWS ではセッションをどう管理するか（一般知識。特定のサービスは未確認）

Redis は命令を 1 つずつ順に実行するので、1 命令の途中に他の処理が割り込めない。対応する命令がある。

| やりたいこと           | Redis                          | Workers KV                      |
| ---------------------- | ------------------------------ | ------------------------------- |
| 加算して新しい値を返す | `INCR key`                     | なし                            |
| 読んで消す             | `GETDEL key`（Redis 6.2 以降） | なし                            |
| 値と TTL を同時に書く  | `SET key value EX 3600`        | `put` の `expirationTtl` で近い |

Better Auth の `SecondaryStorage` が `increment` と `getAndDelete` を必須にしているのは、Redis のように原子的な命令を
持つストアを想定した設計だからと思われる。Redis に対しては、各メソッドが命令にほぼ 1 対 1 で対応する。

Redis をセッションに使う理由は、メモリ上で速いこと、TTL で期限切れが自動で消えること、アプリのサーバーが複数台でも
同じセッションを見られること。KV は世界中の拠点にキャッシュされ、書いた直後に別の拠点で古い値が見える（結果整合）。

AWS での選択肢:

| サービス                      | 特徴                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| ElastiCache（Redis / Valkey） | Redis 互換のマネージド。従来型の Web アプリの定番。Lambda から使うには同じ VPC に置く      |
| MemoryDB                      | Redis 互換で、データの永続性が高い                                                         |
| DynamoDB                      | HTTP の API で使うキーバリュー型 DB。TTL 機能と原子的な加算（`UpdateItem` の `ADD`）がある |
| Cognito                       | 認証とトークンの発行を丸ごと任せる。サーバー側にセッションを持たない選択肢                 |

Cloudflare との対応は、Workers KV が DynamoDB に近く、Redis に近い原子的な操作は Durable Objects が近い位置づけ。
AWS では DB にセッションを置くことは少なく、ElastiCache や DynamoDB に逃がすのが一般的。

## シンタックスハイライト（shiki）

### `/api/shiki` は何をしているか

TypeScript のコードを、色付きの HTML に変換している（`routes/api/shiki.ts`）。

1. テーマ（`github-dark`）と言語（TypeScript、Rust）を読み込み、`createHighlighterCore` でハイライターを作る。正規表現
   エンジンは `createJavaScriptRegexEngine()`（JS 実装）にして、WASM を避ける。
2. `const a: number = 1;` を `codeToHtml` に渡す。
3. 変換にかかった時間（`ms`）と、できた HTML の先頭 80 文字を返す。

返る HTML は、各トークンを `<span style="color:…">` で包んだもので、CSS を別に当てなくても色が付く。確認の目的は、
ブログのコードブロックの色付けを、Workers の上でできるか。標準の Oniguruma（WASM）は Workers で扱いが面倒なので、
JS エンジンで動くかを見ている。

ローカルの結果は 94ms（手順書の目安は初回 200〜300ms）。この実装は呼ぶたびにハイライターを作り直しているので、
2 回目以降も同程度かかる可能性があるが、確かめていない。本番の CPU 時間は、無料プランの 10ms に収まるかをパート B で見る。

## OG 画像

### 最小の `/api/og` は何をしているか

`routes/api/og.ts` は、WASM 版 Takumi が Workers のランタイムで動くかだけを見る最小のルート。

- 最初の呼び出しで、`init({ module_or_path: wasmModule })` で WASM を初期化し、`Renderer` を作って使い回す。`wasmModule` は
  `@takumi-rs/wasm/auto` の default export（workerd 用は `WebAssembly.Module`）。`init()` を引数なしで呼ぶと
  `default is not a function` で落ちる。
- `{ type: "container", children: [{ type: "text", text: "Hello OG" }] }` を 1200×630 で描く。
- 結果は 1,200×630 の PNG（約 1.3KB）で、左上に黒い文字で「Hello OG」、残りは白一色。`x-render-ms` は 41。
- フォントを渡していないので、日本語は描けない（文字化けや欠けが出ると思われる）。

### 今のブログの OG 画像を WASM 版 Takumi で再現できるか

ほぼ再現できた（ローカル）。ブログの `src/og/OgCard.tsx` をそのままコピーし、`@takumi-rs/helpers/jsx` の `fromJsx` で
JSX を要素ツリーに変換して、`@takumi-rs/wasm` の `Renderer` で描いた。Spike の `routes/api/og-post.ts` が、
`?title=…&meta=…` を受けて描く。同じ記事のタイトルとメタ行を渡して、現在のブログの
`dist/public/og/<slug>.png` と並べて見比べた。

- 同じだった: 1200×630、上端の琥珀の帯、サイト名とアスタリスク、タイトルの字形・サイズ・改行位置、メタ行の文言と色。
- 違った: PNG の形式。ブログは RGB（29KB）、WASM 版は 256 色のパレット形式（20KB）。見た目では区別がつかなかったが、
  ピクセル単位の差は計れていない（比較ツールが無かった）。
- 時間（ローカル、日本語フォント入り）: WASM 初期化 2ms（初回 5ms）、JSX 変換 3ms、描画 21ms（初回 59ms）。

必要なもの: `@takumi-rs/helpers`（`fromJsx` 用。`@takumi-rs/wasm` の依存だが、直接 import するので `package.json` に足す）、
日本語フォント。フォントは Cloudflare のバンドルが `.bin` を `ArrayBuffer` として読むので、`NotoSansJP-Bold.ttf` を
`NotoSansJP-Bold.bin` にコピーして import した（型は `declare module "*.bin"`）。フォントは 5.3MB あるので Git には入れない
（`.gitignore`）。

未確認:

- 絵文字。ブログは `emoji: "twemoji"` で CDN から SVG を取得して描いている。WASM 版で同じことをするには
  `@takumi-rs/helpers/emoji` を使うと思われるが、試していない。
- 本番の CPU 時間。Worker のサイズは、WASM（約 4MB）に日本語フォント（5.3MB）を足しても収まる。上限は無料・有料とも
  非圧縮で 64 MiB で、圧縮後の上限はない（Workers の Limits のページ）。ローカルのビルドでは、WASM が圧縮後約 1.7MB、
  フォントが約 3.1MB だった。サイズの面でフォントを R2 に逃がす必要は、今のところない。

### 型チェックの注意

`@takumi-rs/wasm/auto` の default export は、型定義が node 用の bundler に解決されて `TS1192`（default export がない）に
なる。実行には影響しない（workerd では `WebAssembly.Module` が default export で動く）。

### OG 画像はなぜ PNG か（WebP ではないのか）

Takumi は `png`・`jpeg`・`webp`・`ico`・`raw` に出力できる。ただし WASM 版の WebP は常に可逆圧縮（`quality` は無視）で、
可逆圧縮でない WebP はネイティブ版だけ。以下は一般知識（各サービスの最新の対応は未確認）。

- `og:image` を読むのは、X、Facebook、LINE、Slack、Discord などのリンクプレビュー。PNG と JPEG は、どこでも読めると
  考えてよい。WebP は対応がまちまちだった時期があり、読めないサービスがあるとリンクに画像が出ない。
- OG 画像はクローラーが取りに来るもので、読者の表示速度にほとんど関わらない。容量を減らす利点は小さい。
- JPEG は文字の縁がにじむので、文字が主役のカードには PNG が向く。

今のブログも PNG なので、PNG のままにする。記事内の画像を WebP にして配信する話は別（手順書のパート C）。

## Cloudflare の料金と制限

2026-10-18 に公式ドキュメントで確認した値（変わりうるので、使う前にもう一度確認する）。

### Worker のサイズと CPU 時間

|                         | 無料                                | 有料（Workers Paid）                      |
| ----------------------- | ----------------------------------- | ----------------------------------------- |
| Worker のサイズ         | 非圧縮で 64 MiB                     | 非圧縮で 64 MiB                           |
| 1 リクエストの CPU 時間 | 10ms                                | 既定 30 秒（`limits.cpu_ms` で最大 5 分） |
| メモリ                  | 128 MB（JS のヒープと WASM を含む） | 128 MB                                    |
| 基本料金                | なし                                | アカウントごとに月 $5（最低料金）         |

圧縮後のサイズ上限はない（Wrangler が出す gzip の値は参考）。以前「無料 3MB、有料 10MB」と書いたのは古い情報で誤り。
プランを分けるのは、サイズではなく CPU 時間。ローカルでは shiki が 94ms、OG が 21〜59ms なので、無料の 10ms では
`Error 1102` になる可能性が高い。Workers のページには、使った金額の上限を設ける機能は載っていない。`limits.cpu_ms` で
1 リクエストの CPU 時間に上限を付けると、暴走を防げる（「denial-of-wallet 攻撃」対策と書かれている）。

### 各サービスの料金

| サービス        | 無料                                                        | 有料に含まれる量                                               | 超えた分                                                                         |
| --------------- | ----------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Workers         | 100,000 リクエスト/日                                       | 1,000 万リクエスト/月、3,000 万 CPU ms/月                      | 100 万リクエストあたり $0.30、100 万 CPU ms あたり $0.02                         |
| D1              | 読み取り 500 万行/日、書き込み 10 万行/日、保存 5GB         | 読み取り 250 億行/月、書き込み 5,000 万行/月、保存 5GB         | 読み取り 100 万行 $0.001、書き込み 100 万行 $1.00、保存 $0.75/GB                 |
| R2              | 保存 10GB、書き込み系 100 万回/月、読み取り系 1,000 万回/月 | 同じ（無料枠）                                                 | 書き込み系 100 万回 $4.50、読み取り系 100 万回 $0.36、保存 $0.015/GB。送信は無料 |
| KV              | 読み取り 10 万/日、書き込み・削除・一覧 1,000/日、保存 1GB  | 読み取り 1,000 万/月、書き込み・削除・一覧 100 万/月、保存 1GB | 読み取り 100 万 $0.50、書き込み 100 万 $5.00、保存 $0.50/GB                      |
| Durable Objects | リクエスト 10 万/日、13,000 GB-s/日、SQLite は D1 と同じ    | リクエスト 100 万/月、400,000 GB-s/月、SQLite は D1 と同じ     | リクエスト 100 万 $0.15、100 万 GB-s $12.50、保存 $0.20/GB                       |

- 無料プランは、枠を超えると課金されず、その操作がエラーで失敗する（日次の枠は 00:00 UTC にリセット）。
- 無料プランでも Durable Objects は使える。ただし SQLite 版だけ（`defineDurableState` は SQLite 版）。
- Spike の使い方は、どの枠の何桁も下。有料にしても、基本料金の月 $5 以外に課金が出るとは考えにくい。
- 出典: Workers の Pricing と Limits、D1、R2、KV、Durable Objects の各 Pricing のページ（developers.cloudflare.com）。

## ローカルで確認した結果（パート A）

| #    | 確認項目                                       | 結果                                                                                  |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1    | `/api/hello`                                   | `{"message":"Hello from Void"}`                                                       |
| 2    | `/`（Pages mode の SSR）                       | `<h1>spike <!-- -->2026-10-18T08:12:58.973Z</h1>`（loader の時刻が HTML に入る）      |
| 3    | `/api/d1`                                      | 行を足して読み戻せた。呼ぶたびに `count` が増え、最大 3 で頭打ち                      |
| 4    | `/api/r2`                                      | `{"body":{"ok":true}}`                                                                |
| 5    | `/api/private`（未ログイン）                   | `Unauthorized 401`                                                                    |
| 6    | `/api/shiki`                                   | 94ms                                                                                  |
| 7    | `/api/og`                                      | `image/png`、`x-render-ms: 41`、1,200×630、約 1.3KB                                   |
| 8    | `/api/isr`（POST）                             | `{"ok":true} 200`（ローカルではキャッシュが効かず、呼べるだけの確認）                 |
| A5   | サインアップ → セッション付きで `/api/private` | 200。セッションなしは 401                                                             |
| A5   | サインアップを閉じる（`disableSignUp`）        | 知らない人は `EMAIL_PASSWORD_SIGN_UP_DISABLED`（400）、既存ユーザーのサインインは 200 |
| A5b  | セッションを Durable Object に置く             | サインインで `/api/private` が 200、D1 の `session` は 0 件、サインアウトで 401       |
| 加算 | 50 回を 10 並列                                | KV は 9、Durable Object は 50                                                         |
| OG   | 現行の `OgCard` を日本語フォント入りで描く     | 現行の OG 画像とほぼ同じ。描画 21ms（初回 59ms）                                      |

## 本番（Cloudflare）で確認したこと

2026-10-18 に、無料プランのまま `void deploy --platform cloudflare` で本番に上げて確認した。

### デプロイまでに必要だったこと

- `void connect --platform cloudflare` でブラウザからサインインし、アカウントを選ぶ。`.void-wrangler.jsonc` ができる。
- `void db generate` でマイグレーションの SQL を作る（デプロイの前に必須）。
- R2 は、アカウントで最初に有効化する操作が要る。していないと、`Please enable R2 through the Cloudflare Dashboard.`
  （`[code: 10042]`、403）でプロビジョニングが止まる。ダッシュボードの Storage & databases → R2 → Overview で
  購読の画面を完了する。金額は Total Due Now が $0.00、毎月も $0.00 + 超過分のみ（無料枠: 保存 10GB、Class A 100 万回、
  Class B 1,000 万回）。購読はサブスクリプションとして残り、自動更新される。不要になれば Billing Subscriptions から
  解約する。
- デプロイで作られたもの: Worker（`void-spike`）、D1（`void-spike-db`）、R2 のバケット（`void-spike-storage`）、
  KV の namespace が 2 つ（`KV` と ISR のキャッシュ用の `ISR_CACHE`）、Durable Object のクラス 2 つ。ID は `void.lock.json` に記録される。
- 無料プランのままデプロイできた。WASM（圧縮後 1.74MB）、日本語フォント（5.3MB）、`index.js`（圧縮後 325KB）を含めて、
  Worker のサイズ上限（非圧縮で 64 MiB）に収まった。
- ビルド中に `Missing required secrets: BETTER_AUTH_SECRET` の警告が出る。Void のドキュメントでは、デプロイ時に
  なければ作って再利用する。実際にサインアップとセッションが通ったので、作られている。

### `void db generate` が「complete」と出しながら失敗する（Void 1.1.11 のバグ）

`secondaryStorage` を使うと、Better Auth の `session` と `verification` のテーブルが作られなくなる。残る索引は
`account.userId` だけになる。ところが、別テーブルの `id` を参照する列は、`.void/better-auth-schema.ts` を作る処理
（`collectCoreImports`）が `index` の import の追加を飛ばす。その結果、生成されたファイルが `index(...)` を使うのに
import がなく、`ReferenceError: index is not defined` で SQL が作られない。それなのに最後に
`Migration generation complete.` と出る。`db/migrations/` には `meta/_journal.json` だけができて、`.sql` がない。
`.sql` ができているかで見分ける。

回避策は、`auth.ts` に `verification: { storeInDatabase: true }` を足して、`verification` テーブルを D1 に残すこと。
`verification` の索引は参照列ではないので、`index` が import される。そのあと `rm -rf db/migrations` と
`void prepare`、`void db generate` でやり直す。`session` のテーブルは D1 に作られないまま（セッションは Durable Object）。

### 本番のユーザーの作り方

本番の D1 は空で、`disableSignUp: true` のままだとユーザーを作れない。次の順で作った。

1. `auth.ts` を `disableSignUp: false` にしてデプロイする。
2. 本番の URL にサインアップする。`origin` ヘッダーは本番の URL に合わせる。パスワードは `openssl rand -base64 24` で作った
   強いものを使う（公開 URL で誰でも叩ける状態のため）。
3. `disableSignUp: true` に戻して再デプロイする。知らない人のサインアップは `EMAIL_PASSWORD_SIGN_UP_DISABLED`（400）で
   拒否され、作ったセッションは再デプロイのあとも有効（`/api/private` が 200）だった。セッションは Durable Object にあるので、
   Worker を入れ替えても消えない。

実際のブログでは、この手順は避けたい。GitHub ログインで自分の ID だけを許可する形にすると、サインアップを開閉しなくて済む。

### 2 回目のデプロイが `100405` で止まる

`All versions in a multi-version deployment must declare identical exports. Deploy the version that changes exports at 100%
first, then split traffic.` で止まる。本番のトラフィックは変わらない。原因は、Void の既定のデプロイが `staged`
（新しい Worker を 0% のトラフィックで置いて確認してから切り替える）で、Cloudflare が、既存の Durable Object を持つ
Worker を 0% で置けないことがあるため（`docs/reference/config.md` の `deploy.cloudflare.mode`）。なぜ 2 回目に限って
`exports` が違うと判定されたかは確認していない。1 回目で Durable Object のクラスが追加されたためと推測している。

`void deploy --platform cloudflare --atomic` で、その 1 回だけ `atomic` にする。新しい Worker に先にトラフィックを流し、
そのあとで Void が動作を確認する。Durable Object のクラスの変更は巻き戻せない。常に `atomic` にするなら、
`void.config.ts` に `deploy: { cloudflare: { mode: 'atomic' } }` を書く。

### ISR のキャッシュ（本番で確認済み）

| 手順                      | `x-isr-cache` | 本文の時刻         |
| ------------------------- | ------------- | ------------------ |
| 1 回目                    | MISS          | 09:31:39           |
| 2 回目                    | HIT           | 09:31:39（同じ）   |
| `POST /api/isr`（無効化） | `{"ok":true}` |                    |
| 3 回目                    | MISS          | 09:32:22（新しい） |

`revalidate({ paths: ["/", …] })` の `/` が正しいキーだった。

### `x-isr-cache` は Void の独自ヘッダー

標準の HTTP ヘッダーではなく、Void が付ける。値は `MISS` / `HIT` / `STALE`（`packages/isr/src/runtime.ts` と `core.ts`）。
Cloudflare 自体の CDN のキャッシュは `cf-cache-status` で、別物。レスポンスの `cache-control: public, max-age=0,
must-revalidate` は、ブラウザに「毎回確認しに来い」という指示で、1 時間のキャッシュ（`revalidate = 3600`）は Worker の内側で行う。

### `revalidate` はどうやってキャッシュを消すか

ISR のキャッシュは 2 か所にある。KV の `ISR_CACHE`（ページの HTML とメタ情報）と、エッジのキャッシュ（`caches.default`）。
`revalidate({ paths })` は、指定したパスについて、KV の項目を `kv.delete` で消し、エッジのキャッシュから HTML 版と
JSON 版（ページ遷移用のデータ）を `cache.delete` で消す。`all: true` なら KV のキーを一覧して全部消す。
消えたあとの最初のリクエストは `MISS` になり、Worker が描き直して、KV とエッジに書き戻す。
読んだのは、Void のプラットフォームを使わない直接の Cloudflare デプロイの分岐（`packages/void/src/runtime/isr.ts`）。

### Cloudflare のアカウント ID は秘密か

公式ドキュメントは、秘密かどうかには触れていない。Cloudflare のスタッフが Workers SDK のディスカッションで、公開の
`wrangler.toml` にアカウント ID、KV の namespace ID、バケット名を入れてよいと答えている。API トークンがなければ、
アカウント ID だけでは何も操作できない。守るべきものは、API トークン、`BETTER_AUTH_SECRET`、OAuth のシークレット、
`.env`。ただし、公開のリポジトリには載せないほうが無難。

### 使った金額の上限は設けられない

Cloudflare にハードキャップ（上限で打ち切る機能）はない。Budget alerts は、アカウント全体の従量課金の合計が、
設定した金額を超えるとメールで知らせるだけで、「informational only. They do not pause or cap usage.」と
公式にある。Billing → Billable Usage から作る（Workers & Pages の画面にも「Add Budget Alert」のボタンがある）。
Pay-as-you-go のアカウント向け。1 リクエストの CPU 時間の上限は `limits.cpu_ms`（有料プラン）で付けられる。

### 本番の CPU 時間はどうなったか

無料プランのまま、`/api/shiki`、`/api/og`、`/api/og-post` を数十回叩いた。すべて 200 で、`Error 1102` は出なかった。
Metrics（過去 30 分、全リクエストの合計）は、P50 57.84ms、P90 105ms、P99・P999 117ms。ピークは P50 が約 225ms、
P999 が約 340ms。

- 無料プランの上限は 1 リクエスト 10ms。公式ドキュメントには「各 isolate に、たまに上限を超えるぶんの余裕がある」
  「継続して上限に当たると、実行は打ち切られる（`Error 1102`、`exceededCpu`）」とある。許容量は書かれていない。
  数十回の呼び出しは余裕の範囲で通ったと考えられる。継続して使うと落ちる可能性が高い。
- レスポンスの `ms` は、本番では 0 になる。デプロイした Workers では `Date.now()` と `performance.now()` が I/O のあとにしか
  進まない（Spectre 対策）。CPU 時間はダッシュボードの Metrics で見る。ローカルの `wrangler` では I/O がなくても進む。
- Metrics は全リクエストの合計。サインアップ（パスワードのハッシュ化は重い）、D1、ISR の描画も混ざる。ルートごとの
  CPU 時間は、このグラフでは分からない。

ブログへの影響: 公開ページは ISR で返すので、リクエストごとに shiki を動かさない。コードの色付けと OG 画像は、公開時に
1 回だけ行う（計画のとおり）。その処理は公開の API の中で動くので、有料プラン（CPU 時間の既定が 30 秒）が要る。
費用の目安は、CPU 時間が 100 万 ms あたり $0.02（月 3,000 万 ms まで有料プランに含まれる）。1 リクエスト 300ms で
100 万回なら約 $6 だが、公開側は ISR のキャッシュで返るので、ここまでは使わない。有料プランでの動作は未確認。

### 本番の片付け

`void project delete` は Cloudflare のリソースを消さない（`docs/integrations/cloudflare.md`）。ダッシュボードで、
Worker、D1、R2 のバケット、KV の namespace（`KV` と `ISR_CACHE`）を消した。R2 の購読と Budget alert は、$0 のままなら
残してよい。削除後、`$URL/api/hello` は 404 になった。D1、R2、KV の削除は、こちらからは確認できていない
（`wrangler` が未ログインだったため）。

### 公開前の漏洩チェックで見たこと

`void-spike` を GitHub に置く前に、次を確認した。

- 追跡しているファイルの一覧（`git ls-files`）に、Cookie、`.env`、`.void-wrangler.jsonc` が入っていない。
  `cookies.txt`、`.env`、`.void-wrangler.jsonc`、`.void/` は `.gitignore` に入れてある。
- 全履歴（`git log -p --all`）を、アカウント ID、`api_token`、`secret`、`Bearer`、GitHub のトークン（`gho_`、`ghp_`）、
  `BETTER_AUTH_SECRET` で検索した。見つかったのは、まだ push していないコミットの `account_id` だけ。
- リポジトリの公開状態は、`void-spike` が private、ブログ本体が public。ブログ本体の手順書や Q&A に入っているのは、
  サンプルのメールとパスワード（`me@example.com`、`example-password-123`）だけ。ローカル専用で、本番には作っていない。
- 本番のセッションのトークンやパスワードを、チャットや手順書に貼らない。貼ってしまったら、サインアウトで無効にする。
  Spike は確認後に Worker ごと消す。

## D1 と R2

### `/api/d1` は何をしているか

`posts` テーブルに 1 行追加（`slug` は `s-` + 現在時刻のミリ秒）して、先頭から最大 3 行と `id` が 1 の行を読み戻す。
`count` は最大 3 で頭打ちになる。`db`・`eq`・`posts` は Drizzle ORM の API。

GET で書き込むのは、本来は避ける書き方（ブラウザの先読みやクローラーで行が増える）。確認を 1 回の `curl` で済ませる
ためにそうしている。本番のコードでは書き込みを `POST` にする。

### `/api/r2` は何をしているか

`published/test.json` というキーに `{"ok":true}` を保存し、同じキーで読み戻して返す。

### R2 は NoSQL と同じか

別物。R2 はオブジェクトストレージ（S3 に近い）で、キーを指定してファイルを丸ごと出し入れする。中身を理解しない
ので、中身での検索や部分更新はできない。D1 は検索や並べ替えをしたい表形式のデータ、R2 は画像や公開用の
Markdown のようなファイルを置く場所。

### R2 の実体は大きな 1 ファイルか

1 キー = 1 オブジェクトで、大きな 1 ファイルではない。`/` は名前の一部で、フォルダではない。更新は丸ごと上書き。
ローカルでは `.void/v3/r2/default/blobs/` に中身が 1 つずつ別のファイルとして入り、`metadata.sqlite` がキーや
`contentType` を管理していた。（確認: ローカルの `miniflare` の構造のみ。本物の R2 の内部構造は未確認）
