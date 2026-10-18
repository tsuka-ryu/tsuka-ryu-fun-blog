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

24.21.0 未満なら、Spike のディレクトリだけ Node を切り替える（A1 で作ったあとに実行する）。
`mise use` はそのディレクトリに `mise.toml` を作るだけで、このリポジトリの Node（24.16.0）には影響しない。

```sh
cd void-spike
mise use node@24.22.0
node -v   # v24.22.0
```

## パート A: ローカルで確認する

### A1. プロジェクトを作る

このリポジトリの外に空のディレクトリを作る（リポジトリの中だと `package.json` が干渉する）。

```sh
mkdir void-spike && cd void-spike
mkdir -p pages routes/api db
```

すでに空のディレクトリを用意している場合は、その中に入って `mkdir -p pages routes/api db` だけ実行する。

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
curl -s -H 'Accept: text/html' localhost:5199/ | grep -o '<h1.*</h1>'

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
| 2   | `<h1>spike <!-- -->2026-…</h1>`（`{now}` の前に React が `<!-- -->` を挟む）                        | Pages mode の SSR                  |
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

### A5b. セッションを D1 ではなく Durable Object に置く（任意）

既定ではセッションは D1 の `session` テーブルに入る。Better Auth の `secondaryStorage` に Durable Object をつなぐと、
そこに置ける。Void のドキュメントには記述がなく、Better Auth 側のオプション（`defineAuth` で足せる）を使う形。

`SecondaryStorage` は `get`・`set`・`delete` に加えて、`getAndDelete`（読んで消す）と `increment`（加算）が必須。
この 2 つは原子的であることが前提で、Workers KV にはその操作がない（KV 版は末尾の「KV で試した場合」を参照）。
Durable Object は同じ名前への呼び出しが 1 つずつ順に実行されるので、原子的に書ける。

キー 1 つにつき Durable Object 1 つ（名前がキー）にする。キーごとに別のオブジェクトなので、全リクエストが 1 か所に
集中しない。`durable-objects/session-store.ts` を作る。

```ts
import { defineDurableState } from "void/durable";

type Entry = { value: string | null; expiresAt: number | null };

function isExpired(entry: Entry) {
  return entry.expiresAt !== null && entry.expiresAt <= Date.now();
}

export const SessionStore = defineDurableState({
  initialState: { value: null, expiresAt: null } as Entry,
  methods: {
    get(context) {
      if (isExpired(context.state)) {
        context.state.value = null;
        context.state.expiresAt = null;
      }
      return context.state.value;
    },
    async set(context, value: string, ttl?: number) {
      context.state.value = value;
      context.state.expiresAt = ttl ? Date.now() + ttl * 1000 : null;
      if (context.state.expiresAt !== null) await context.setAlarm(context.state.expiresAt);
    },
    async delete(context) {
      context.state.value = null;
      context.state.expiresAt = null;
      await context.deleteAlarm();
    },
    async getAndDelete(context) {
      const value = isExpired(context.state) ? null : context.state.value;
      context.state.value = null;
      context.state.expiresAt = null;
      await context.deleteAlarm();
      return value;
    },
    async increment(context, ttl: number) {
      // 期限切れなら 0 から数え直す。TTL は最初の加算のときだけ付け、あとの加算では延ばさない。
      if (isExpired(context.state)) {
        context.state.value = null;
        context.state.expiresAt = null;
      }
      const next = Number(context.state.value ?? 0) + 1;
      context.state.value = String(next);
      if (next === 1) {
        context.state.expiresAt = Date.now() + ttl * 1000;
        await context.setAlarm(context.state.expiresAt);
      }
      return next;
    },
  },
  async alarm(context) {
    if (isExpired(context.state)) {
      context.state.value = null;
      context.state.expiresAt = null;
    }
  },
});

export default SessionStore;
```

A5 で作った `auth.ts` を、サインアップを閉じる設定ごと次のように置き換える。サインアップを閉じたあとは新しいユーザーを
作れないので、**サインアップは閉じる前に済ませておく**（A5 の前半）。

```ts
import { defineAuth } from "void/auth";

// このファイルは起動時に素の Node からも読み込まれる。Durable Object のモジュールは
// `cloudflare:workers` を import していて Node では読めないので、先頭で import せず、
// メソッドが呼ばれたときに動的に読み込む。
async function store(key: string) {
  const { SessionStore } = await import("./durable-objects/session-store.ts");
  return SessionStore.get(key);
}

export default defineAuth(({ defaults }) => ({
  ...defaults,
  emailAndPassword: { enabled: true, disableSignUp: true },
  secondaryStorage: {
    get: async (key) => (await store(key)).get(),
    set: async (key, value, ttl) => {
      await (await store(key)).set(value, ttl);
    },
    delete: async (key) => {
      await (await store(key)).delete();
    },
    getAndDelete: async (key) => (await store(key)).getAndDelete(),
    increment: async (key, ttl) => (await store(key)).increment(ttl),
  },
}));
```

`auth.ts` は起動時に、Vite を通さず素の Node の `import()` で読み込まれる。そのため次の 2 点に注意する。

- import には拡張子 `.ts` が要る（省略すると `ERR_MODULE_NOT_FOUND` で dev サーバーが起動しない）。
- Durable Object のモジュールを先頭で import してはいけない。その先の `void/durable` が `cloudflare:workers` を import
  していて、Node は読めない（`ERR_UNSUPPORTED_ESM_URL_SCHEME`）。上のように、メソッドの中で動的に import する。
  KV 版が先頭の import で動いたのは、`void/kv` が Cloudflare 専用のモジュールを読まないため。

`tsconfig.json` の `include` に `"durable-objects"` を足す。Durable Object を新しく使うので、dev サーバーを再起動する。
`void.lock.json` に Durable Object のバインディングとマイグレーションが自動で書かれる（コミットする）。

> 古いセッション（D1 や KV にあるもの）は引き継がれない。切り替えたあとは、サインインし直す。
> サインアップが済んでいない状態で失敗したときも、ユーザーだけ D1 に作られていることがある。
> やり直しはサインアップではなく、サインイン（`/api/auth/sign-in/email`）を使う。
> `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` と言われるのは、そのため。

確認すること（Durable Object 版。ローカルで確認済みの項目に ✓）:

- ✓ サインインして、セッション付きで `/api/private` が通る。`{"email":"me@example.com"} 200`
- ✓ D1 の `session` テーブルが 0 件のまま（`user` は 1 件）。
- ✓ セッションが Durable Object に入っている。`.void/v3/do/void-spike-SessionStoreDurableObject/` の下に、キーごとの SQLite ファイルができる。
- ✓ `void.lock.json` に `SESSION_STORE` のバインディングとマイグレーションが自動で追加される（コミットする）。
- ✓ サインアウトのあと、同じ Cookie で `/api/private` が 401 になる。

```sh
curl -s -b cookies.txt -c cookies.txt -X POST localhost:5199/api/auth/sign-out \
  -H 'content-type: application/json' -H 'origin: http://localhost:5199' -d '{}'
# → {"success":true}
curl -s -b cookies.txt -w ' %{http_code}\n' localhost:5199/api/private
# → Unauthorized 401
```

本番での確認は未実施（パート B）。KV 版では結果整合でずれる可能性があったが、Durable Object は同じ名前が常に同じ
1 か所で処理されるので、サインアウト直後の 401 がずれない想定。

#### 原子的な加算の比較実験（任意）

KV と Durable Object で、同じカウンターを並行に加算して違いを見る。`durable-objects/counter.ts`（`defineDurableState` で
`increment` / `read`）と `routes/api/counter.ts`（`mode=kv` / `mode=do` で切り替え。KV 版は「読む → 1 足す → 書く」）を作る。

```sh
seq 50 | xargs -P 10 -I{} curl -s -X POST 'localhost:5199/api/counter?mode=kv&name=t1' > /dev/null
curl -s 'localhost:5199/api/counter?mode=kv&name=t1'   # → 9（41 回分が取りこぼし）

seq 50 | xargs -P 10 -I{} curl -s -X POST 'localhost:5199/api/counter?mode=do&name=t1' > /dev/null
curl -s 'localhost:5199/api/counter?mode=do&name=t1'   # → 50
```

`name` を変えると 0 から数え直せる。KV を使うルートがあれば `void/kv` は検出されるが、`auth.ts` だけで使う場合は
後述のとおり設定が要る。

#### KV で試した場合（参考）

`secondaryStorage` に `void/kv` をつなぐこともできる。ただし `getAndDelete` と `increment` は読み書きを分けた近似になり、
並行に叩かれると取りこぼす（上の実験のとおり）。レート制限のカウンターは `increment` に依存するので、
`rateLimit: { storage: "memory" }` で KV から外す。実装は Git の履歴（void-spike の `13b9a44`）にある。

`auth.ts` はプロジェクト直下にあり、Void が `void/kv` などの使用を探す走査の対象外（走査するのは `routes`・`middleware`・
`queues`・`pages`・`crons`・`email`・`durable-objects`・`src`）。そのままだと `Missing Cloudflare binding 'KV'` になる。
`void.config.ts` で KV を明示する。

```ts
export default defineConfig({
  worker: { compatibility_date: "2026-02-24" },
  inference: { bindings: { kv: true } },
});
```

KV 版で確認できたこと: サインインでセッションが KV に入り（`.void/v3/kv/local/blobs/`）、D1 の `session` は 0 件のまま、
`/api/private` が通る。Cookie `better-auth.session_token` の値は `トークン.署名` の形で、先頭がサインインのレスポンスの
`token` と一致する。未確認: 本番の KV は結果整合なので、サインアウト直後の 401 がずれるか（パート B で確認する）。

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
**自分の Cloudflare アカウントにリソース（Worker・D1・R2・KV・Durable Object）が作られる**ので、確認後に片付ける（B5）。

プランについて（2026-10-18 に公式ドキュメントで確認した値。詳細は `docs/void-spike-qa.md` の「Cloudflare の料金と制限」）:

- Worker のサイズは、無料・有料とも非圧縮で 64 MiB。圧縮後の上限はない。WASM とフォントを入れても収まる。
- 違うのは 1 リクエストの CPU 時間。無料は 10ms、有料（Workers Paid、月 $5）は既定 30 秒。
- 使った金額の上限を設ける機能は、Workers のページには載っていない。Spike の使い方なら、基本料金以外の課金は出にくい。
- 無料のままデプロイして、`/api/shiki` と `/api/og` が `Error 1102` になるかを見る。なったら Workers Paid に加入して、
  同じものを測り直す（B4）。

### B1. デプロイ

```sh
pnpm exec void connect --platform cloudflare   # ブラウザが開くのでサインインしてアカウントを選ぶ
pnpm exec void db generate                     # スキーマからマイグレーションの SQL を生成（初回は必須。deploy は未生成だと止まる）
pnpm exec void deploy --platform cloudflare
```

- デプロイの要約に URL が表示される（`https://…workers.dev` の形）。以降、その URL を `$URL` として使う。
- D1 と R2 は、コードから使用を推論して自動で作られる。要約に作成されたリソースが出るのでメモする。
- 要約や出力にスクリプトのサイズ（アップロード量）が出る場合は控える。`@takumi-rs/wasm` の `.wasm` は約 4MB（非圧縮）、
  日本語フォントは 5.3MB。ローカルのビルドでは、圧縮後が WASM 約 1.7MB、フォント約 3.1MB だった。
- 日本語フォントは Git に入れていない（`.gitignore`）。デプロイの前に `src/og/fonts/NotoSansJP-Bold.bin` があることを確かめる
  （ブログの `src/og/fonts/NotoSansJP-Bold.ttf` を、拡張子を `.bin` にしてコピーする）。

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
- 無料プランでは 1 リクエストの CPU 時間が 10ms に制限されている。shiki の初期化や WASM の初期化は
  それを超えて `Error 1102`（Worker exceeded resource limits）になることがある（ローカルでは shiki が 94ms、OG が 21〜59ms）。
  **超えた場合は有料プラン（Workers Paid、月 $5）で再度試し、「無料プランでは足りない」ことを記録する。**
- 有料プランでは、暴走を防ぐために `limits.cpu_ms` で 1 リクエストの CPU 時間に上限を付けられる。
- Durable Object のセッションが本番でも動くか（サインイン → `/api/private` が 200 → サインアウト → 401）も見る。
- OG は、日本語フォント（Noto Sans JP）を渡した場合の生成時間も見る（計画では公開時に 1 回だけ生成する）。

### B5. 片付ける

確認が済んだら、不要な課金や公開が残らないように消す。Cloudflare ダッシュボードで次を削除する。

- Workers & Pages → Spike の Worker
- Storage & Databases → D1 → Spike のデータベース
- Storage & Databases → R2 → Spike のバケット
- Storage & Databases → KV → Spike の namespace（`/api/counter?mode=kv` を使った場合）
- Durable Object は Worker に紐づく（Worker を消すと一緒に消えると理解しているが、ダッシュボードで残っていないか確認する）
- Workers Paid に加入した場合は、不要になったらプランを解約する。月額の契約なので、日割りで戻るかは未確認。今月中に済ませる

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
