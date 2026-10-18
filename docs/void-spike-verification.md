# Void Spike の確認手順

`docs/void-cloudflare-rebuild.md` の Phase 0（Spike）で確認したことを、人間が手元で再現・確認するための手順書。
Spike は「捨てる前提の小さな実験」のことで、本番のコードを書く前に、計画の前提（Workers の上で D1・R2・認証・
シンタックスハイライト・OG 画像が動くか）が成り立つかを確かめるために行う。ここで作るアプリは確認が済んだら捨てる。

- 検証したバージョン: `void` 1.1.11 / `@void/react` 1.1.11 / `vite` 8.3 / `shiki` 4.5.0 / `@takumi-rs/wasm` 2.16.3 / Node 24.22.0
- パート A はローカルだけで完結する（Cloudflare アカウント不要）。パート B は自分の Cloudflare アカウントが必要。
- 結果は `docs/build-log.md` の「Void の Spike（ローカル検証）」に記録してある。パート B の結果はそこに追記する。

## 前提

- Node.js 24.21.0 以上（Void の要件。このリポジトリの `mise.toml` は 24.16.0 なので、Spike ではリポジトリの外で別の Node を使う）
- pnpm
- curl
- パート B: Cloudflare アカウント（無料プランで可。ただし CPU 時間の制限に注意。B のメモ参照）

```sh
node -v   # v24.21.0 以上であること
```

## パート A: ローカルで確認する

### A1. プロジェクトを作る

このリポジトリの外に空のディレクトリを作る（リポジトリの中だと `package.json` が干渉する）。

```sh
mkdir void-spike && cd void-spike
mkdir -p pages routes/api db
```

次のファイルを作る。

`package.json`

```json
{
  "name": "void-spike",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": {
    "@void/react": "1.1.11",
    "hono": "^4.13.13",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "void": "1.1.11"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "typescript": "^5.9.0",
    "vite": "^8.0.16"
  }
}
```

> Vite は 8 系にする。7 系だと `@void/react` が引き込む `@vitejs/plugin-react` が `vite/internal` を解決できず、
> `ERR_PACKAGE_PATH_NOT_EXPORTED` で起動しない。

`pnpm-workspace.yaml`（ネイティブのビルドスクリプトの許可。Void は同梱のバイナリを使うので `better-sqlite3` は無効）

```yaml
allowBuilds:
  esbuild: true
  sharp: true
  workerd: true
  better-sqlite3: false
```

`vite.config.ts`

```ts
import { voidReact } from "@void/react/plugin";
import { defineConfig } from "vite";
import { voidPlugin } from "void";

export default defineConfig({ plugins: [voidPlugin(), voidReact()] });
```

`void.config.ts`

```ts
import { defineConfig } from "void/config";

export default defineConfig({ worker: { compatibility_date: "2026-02-24" } });
```

`tsconfig.json`

```json
{
  "extends": "./.void/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "types": ["void/env"],
    "allowImportingTsExtensions": true
  },
  "include": ["pages", "routes", "middleware", "db"]
}
```

`db/schema.ts`

```ts
import { sql } from "void/db";
import { sqliteTable, integer, text } from "void/schema-d1";

export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});
```

`pages/index.server.ts`（loader が現在時刻を返す。`revalidate` は ISR の TTL（秒））

```ts
import { defineHandler } from "void";

export type Props = Readonly<{ now: string }>;
export const revalidate = 3600;
export const loader = defineHandler<Props>(() => ({ now: new Date().toISOString() }));
```

`pages/index.tsx`

```tsx
import type { Props } from "./index.server.ts";

export default function Home({ now }: Props) {
  return <h1>spike {now}</h1>;
}
```

`routes/api/hello.ts`

```ts
import { defineHandler } from "void";

export const GET = defineHandler(() => ({ message: "Hello from Void" }));
```

`routes/api/d1.ts`（D1 に 1 行挿入して読む）

```ts
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

`routes/api/r2.ts`（R2 に書いて読む）

```ts
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

`routes/api/private.ts`（未ログインなら 401）

```ts
import { defineHandler } from "void";
import { requireAuth } from "void/auth";

export const GET = defineHandler((c) => {
  const user = requireAuth(c);
  return { email: user.email };
});
```

`routes/api/shiki.ts`（シンタックスハイライト。正規表現エンジンは JS 実装なので WASM 不要）

```ts
import { defineHandler } from "void";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export const GET = defineHandler(async () => {
  const t0 = Date.now();
  const hl = await createHighlighterCore({
    themes: [import("shiki/themes/github-dark.mjs")],
    langs: [import("shiki/langs/typescript.mjs"), import("shiki/langs/rust.mjs")],
    engine: createJavaScriptRegexEngine(),
  });
  const html = hl.codeToHtml("const a: number = 1;", { lang: "typescript", theme: "github-dark" });
  return { ms: Date.now() - t0, htmlHead: html.slice(0, 80) };
});
```

`routes/api/og.ts`（WASM 版 Takumi で OG 画像を PNG にする）

```ts
import init, { Renderer } from "@takumi-rs/wasm";
import wasmModule from "@takumi-rs/wasm/auto";
import { defineHandler } from "void";

let renderer: Renderer | undefined;

export const GET = defineHandler(async () => {
  const t0 = Date.now();
  if (!renderer) {
    // workerd 用の /auto は default export が WebAssembly.Module。init に渡して初期化する。
    await init({ module_or_path: wasmModule });
    renderer = new Renderer();
  }
  const png = await renderer.render(
    { type: "container", children: [{ type: "text", text: "Hello OG" }] },
    { width: 1200, height: 630 },
  );
  return new Response(png as BodyInit, {
    headers: { "content-type": "image/png", "x-render-ms": String(Date.now() - t0) },
  });
});
```

`routes/api/isr.ts`（ISR のキャッシュを指定パスだけ無効化する）

```ts
import { defineHandler } from "void";
import { revalidate } from "void/isr";

export const POST = defineHandler(async () => {
  await revalidate({ paths: ["/", "/posts/hello"] });
  return { ok: true };
});
```

### A2. 依存を入れて準備する

```sh
pnpm install
pnpm add shiki @takumi-rs/wasm
pnpm exec void prepare     # 型と tsconfig を生成。「Project codegen is ready.」と出れば OK
pnpm exec void db push     # ローカルの D1 にスキーマを反映。「Database schema pushed.」と出れば OK
```

### A3. 開発サーバーを起動する

```sh
pnpm exec vite --port 5199
```

> D1・R2 の使用を新しく書いたあとは、サーバーの再起動が必要。コンソールに
> `New D1 (void/db) binding detected. Restart to apply.` と出たら、止めて起動し直す。
> 再起動前は `Missing Cloudflare binding 'DB'` で 500 になる。

別のターミナルで、以降の curl を実行する。

### A4. 各機能を確認する

番号の順に実行して、期待する結果と見比べる。

```sh
# 1. API ルート
curl -s localhost:5199/api/hello

# 2. Pages mode の SSR（HTML の中に <h1> が描画されている）
curl -s -H 'Accept: text/html' localhost:5199/ | grep -o '<h1[^>]*>[^<]*'

# 3. D1 への書き込みと読み取り
curl -s localhost:5199/api/d1

# 4. R2 への書き込みと読み取り
curl -s localhost:5199/api/r2

# 5. 未ログインで保護ルートが弾かれる
curl -s -w ' %{http_code}\n' localhost:5199/api/private

# 6. shiki が JS エンジンで動く
curl -s localhost:5199/api/shiki

# 7. WASM 版 Takumi が PNG を返す
curl -s -D - -o og.png localhost:5199/api/og | grep -i -e content-type -e x-render-ms

# 8. ISR の無効化 API が例外なく呼べる
curl -s -X POST -w ' %{http_code}\n' localhost:5199/api/isr
```

| #   | 期待する結果                                                                                        | 何を確認しているか                 |
| --- | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | `{"message":"Hello from Void"}`                                                                     | API ルート（`routes/`）            |
| 2   | `<h1>spike ` で始まる行                                                                             | Pages mode の SSR                  |
| 3   | `{"count":1,"first":{"id":1,"slug":"s-…","title":"hello","createdAt":"…"}}`（呼ぶたびに行が増える） | D1 への書き込みと読み取り          |
| 4   | `{"body":{"ok":true}}`                                                                              | R2 への書き込みと読み取り          |
| 5   | `Unauthorized 401`                                                                                  | 保護ルート（`requireAuth`）        |
| 6   | `{"ms":…,"htmlHead":"<pre class=\"shiki github-dark\" …"}`（初回は 200〜300ms 程度）                | shiki（JS 正規表現エンジン）       |
| 7   | `content-type: image/png` と `x-render-ms: …`。`og.png` を画像ビューアで開くと 1200×630             | WASM 版 Takumi                     |
| 8   | `{"ok":true} 200`                                                                                   | `revalidate({ paths })` の呼び出し |

ローカルの開発サーバーでは ISR のキャッシュは効かない（8 は「呼べる」ことだけの確認）。キャッシュの動作はパート B で見る。

### A5. 認証（Better Auth）を確認する

サインアップは、Void のデフォルトではメール+パスワードが誰にでも開いている。まずその状態を確認する。

```sh
# サインアップ（開いている）
curl -s -c cookies.txt -X POST localhost:5199/api/auth/sign-up/email \
  -H 'content-type: application/json' -H 'origin: http://localhost:5199' \
  -d '{"email":"me@example.com","password":"example-password-123","name":"me"}'
# → {"token":"…","user":{"email":"me@example.com",…}}

# セッション付きなら保護ルートが通る
curl -s -b cookies.txt -w ' %{http_code}\n' localhost:5199/api/private
# → {"email":"me@example.com"} 200

# セッションなしなら 401
curl -s -w ' %{http_code}\n' localhost:5199/api/private
# → Unauthorized 401
```

次に、サインアップを閉じる。`auth.ts` をプロジェクト直下に作る。

```ts
import { defineAuth } from "void/auth";

export default defineAuth(({ defaults }) => ({
  ...defaults,
  emailAndPassword: { enabled: true, disableSignUp: true },
}));
```

数秒待って（再読み込みされる）、もう一度確認する。

```sh
# 知らない人のサインアップは拒否される
curl -s -X POST -w '\n%{http_code}\n' localhost:5199/api/auth/sign-up/email \
  -H 'content-type: application/json' -H 'origin: http://localhost:5199' \
  -d '{"email":"intruder@example.com","password":"example-password-123","name":"x"}'
# → {"message":"Email and password sign up is not enabled","code":"EMAIL_PASSWORD_SIGN_UP_DISABLED"} 400

# 作成済みのユーザーのサインインは通る
curl -s -X POST -w '\n%{http_code}\n' localhost:5199/api/auth/sign-in/email \
  -H 'content-type: application/json' -H 'origin: http://localhost:5199' \
  -d '{"email":"me@example.com","password":"example-password-123"}'
# → 200 と、token・user を含む JSON
```

### A6. つまずいたときの表

| 症状                                                           | 原因                                     | 対処                                                        |
| -------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| `ERR_PACKAGE_PATH_NOT_EXPORTED: './internal'` で起動しない     | Vite が 7 系                             | `package.json` の `vite` を `^8.0.16` にして `pnpm install` |
| 500 と `Missing Cloudflare binding 'DB'`（または `'STORAGE'`） | バインディングの検出後に再起動していない | 開発サーバーを止めて起動し直す                              |
| `/api/og` が 500（`default is not a function` 系）             | `init()` を引数なしで呼んでいる          | `init({ module_or_path: wasmModule })` と渡す               |
| `pnpm install` でビルドスクリプトがブロックされる              | pnpm のビルド許可                        | `pnpm-workspace.yaml` の `allowBuilds` を書く（上記）       |
| 起動時に Node のバージョンエラー                               | Node が 24.21.0 未満                     | Node を上げる                                               |

## パート B: Cloudflare の本番で確認する

ローカルでは確認できなかった項目（デプロイ、ISR のキャッシュ、本番の CPU 時間とメモリ、スクリプトサイズ）を確認する。
**自分の Cloudflare アカウントにリソース（Worker・D1・R2）が作られる**ので、確認後に片付ける（B5）。

### B1. デプロイ

```sh
pnpm exec void connect --platform cloudflare   # ブラウザが開くのでサインインしてアカウントを選ぶ
pnpm exec void db generate                     # スキーマからマイグレーションの SQL を生成（初回は必須。deploy は未生成だと止まる）
pnpm exec void deploy --platform cloudflare
```

- デプロイの要約に URL が表示される（`https://…workers.dev` の形）。以降、その URL を `$URL` として使う。
- D1 と R2 は、コードから使用を推論して自動で作られる。要約に作成されたリソースが出るのでメモする。
- 要約や出力にスクリプトのサイズ（アップロード量）が出る場合は控える。`@takumi-rs/wasm` の `.wasm` は約 4MB（非圧縮）。

### B2. 基本の動作

パート A の 1〜8 と同じ確認を `$URL` に対して行う（`localhost:5199` を `$URL` に置き換える）。
`/api/d1` は本番の D1 に行を足す（数行なので課金への影響はほぼない）。

### B3. ISR のキャッシュ

`/` は `revalidate = 3600` なので、1 時間キャッシュされる。レスポンスヘッダー `x-isr-cache`（`MISS` / `HIT` / `STALE`）で見る。

```sh
# 1 回目: MISS（レンダリングしてキャッシュに入れる）
curl -s -D - -o /dev/null "$URL/" -H 'Accept: text/html' | grep -i -E '^HTTP|x-isr-cache|cache-control'
# 2 回目: HIT（キャッシュから返る）。本文の時刻が 1 回目と同じであることも見る
curl -s -D - "$URL/" -H 'Accept: text/html' | grep -i -E '^HTTP|x-isr-cache|<h1'

# キャッシュを無効化する
curl -s -X POST "$URL/api/isr"

# 3 回目: 再び MISS になり、本文の時刻が新しくなる
curl -s -D - "$URL/" -H 'Accept: text/html' | grep -i -E '^HTTP|x-isr-cache|<h1'
```

期待する流れは「MISS → HIT（時刻が同じ）→ 無効化 → MISS（時刻が新しい）」。HIT のまま変わらないなら、
`revalidate({ paths })` のパスの書き方（`/` が正規のキーか）を確認する。
注意: `Cookie` や `Authorization` 付きのリクエストはキャッシュを素通りするので、ブラウザではなく curl で見る。

### B4. 本番の CPU 時間・メモリ

- Cloudflare ダッシュボード → Workers & Pages → 対象の Worker → Metrics で、`/api/shiki` と `/api/og` を叩いたあとの
  CPU time を見る。
- 無料プランでは 1 リクエストの CPU 時間が 10ms 程度に制限されている。shiki の初期化や WASM の初期化は
  それを超えて `Error 1102`（Worker exceeded resource limits）になることがある。**超えた場合は有料プラン
  （Workers Paid）で再度試し、「無料プランでは足りない」ことを記録する。**
- OG は、日本語フォント（Noto Sans JP）を渡した場合の生成時間も見る（計画では公開時に 1 回だけ生成する）。

### B5. 片付ける

確認が済んだら、不要な課金や公開が残らないように消す。Cloudflare ダッシュボードで次を削除する。

- Workers & Pages → Spike の Worker
- Storage & Databases → D1 → Spike のデータベース
- Storage & Databases → R2 → Spike のバケット

### B6. 結果を記録する

`docs/build-log.md` の「Void の Spike（ローカル検証）」の「未確認」の項目に、確認できたこと・できなかったことと
数値（CPU 時間、スクリプトサイズ、生成時間）を追記する。

## パート C: まだ手順がない項目

次の項目は、手順が固まっていないので、確認するときにこの文書に追記する。

- 画像の WebP 変換: Void の docs に Cloudflare Images バインディングの記載がない。ブラウザ側で変換する方法と、
  WASM のライブラリを使う方法の 2 つを試す。
- GitHub OAuth のログイン: GitHub で OAuth App を作り、`AUTH_GITHUB_CLIENT_ID` / `AUTH_GITHUB_CLIENT_SECRET` を
  `void secret put` で設定し、`void.config.ts` の `auth.providers` に `"github"` を足す。自分の GitHub ID 以外の
  サインアップを拒否する仕組み（Better Auth の `databaseHooks` など）も合わせて試す。
- 既存の `src/markdown` レンダラーを Pages mode で動かす: 自作パーサー（Phase 2）の完成後に確認する。
