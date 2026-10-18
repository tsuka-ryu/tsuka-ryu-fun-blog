# ローカル開発の環境変数

Void は、プロジェクト直下の `.env` だけを読む（`.env.example` などの別ファイルがあるとビルドが止まる）。
`.env` は Git に入れない。次の内容を書く。

```ini
# 管理 API をスクリプト（記事のインポートなど）から呼ぶための Bearer トークン。
ADMIN_API_TOKEN=local-token

# 開発サーバー（`vite`）だけで、管理画面の認可を省く。本番のビルドでは、この分岐ごと取り除かれる。
ADMIN_DEV_BYPASS=1

# GitHub ログイン。認証のミドルウェアは全リクエストで認証情報を要求するので、ローカルでもダミーの値が要る
# （ないと、公開ページまで 500 になる）。本物の GitHub OAuth App の値は、本番で `void secret put` する。
AUTH_GITHUB_CLIENT_ID=dummy
AUTH_GITHUB_CLIENT_SECRET=dummy

# 管理者として認める GitHub の数値のユーザー ID（ブラウザからのログインを実際に使うときだけ）。
# ADMIN_GITHUB_ID=
```

## 知っておくこと

- **環境変数は、ビルド時に `dist/ssr/.dev.vars` へ写される**。`vite preview` のワーカーが読むのはこのファイルで、
  シェルの環境変数は渡らない。`.env` を変えたら、`pnpm build` し直す。
- 開発サーバーを動かす前に、`pnpm exec void db migrate` でローカルの D1 に migration を流す。D1 と R2 を使うコードを
  足したあとは、開発サーバーを再起動する。
- 管理画面の通しの確認は `node scripts/e2e-admin.mjs`（開発サーバーを起動しておく）。
- **島（アイランド）は、ページのファイルで `with { island: ... }` を付けて import した、default export の
  コンポーネントだけが動く。** `#` のサブパスではなく相対パスで import する。レイアウトの中の島は描画されるだけで動かない。
  詳しくは `docs/build-log.md`。
