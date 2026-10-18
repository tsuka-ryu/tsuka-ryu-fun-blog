# VRT（ビジュアルリグレッションテスト）

ビルド済みのサイト（`dist/public`）の見た目が変わっていないことを、スクリーンショットの比較で確かめる。
Void + Cloudflare への作り直し（`docs/void-cloudflare-rebuild.md`）の前後で、見た目が同じであることを
保証するために作った。移行後も、依存の更新などで見た目が壊れたときに気づくために回し続ける。

- 使うもの: Vitest のブラウザモード + Playwright（Chromium）+ `toMatchScreenshot`
- ベースライン画像: `vrt/__screenshots__/site.browser.test.ts/`（コミットする。約 9MB、60 枚）
- 実行時の一時ファイル（失敗した画像と差分画像）: `vrt/.vitest/`（`.gitignore` 済み）

## 実行する

```sh
pnpm build            # dist/public を最新にする（記事やコードを変えたら必ず先にビルドする）
pnpm run test:vrt     # ベースラインと比べる。全件 green が正常
```

失敗したときは、ログに出る `Actual screenshot` と `Diff image`（`vrt/.vitest/attachments/` の下）を開く。
差分は赤い画素で出る。

### Node と Chromium

- Node 24 で実行する（リポジトリは `mise.toml` で固定）。
- Playwright が期待する Chromium が入っていない環境では、`pnpm exec playwright install chromium` で入れる。
  すでに別の場所に Chromium がある環境では、`VRT_CHROMIUM_PATH` で実行ファイルを指定する。

  ```sh
  VRT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm run test:vrt
  ```

特定のページだけ流すときは、テスト名で絞る。**`pnpm run test:vrt` の後ろに `--` を付けないこと**
（付けると、後ろのオプションが無視されて全件が走る）。

```sh
pnpm run test:vrt -t "desktop > /about"
```

### ベースラインを更新する

**サイトの見た目や記事の内容を、意図して変えたときだけ**更新する。

```sh
pnpm build
pnpm run test:vrt --update         # 差分のあった画像をベースラインとして書き換える
```

更新した画像は、必ず目で見て意図どおりか確認してからコミットする。記事を足す・直すと、その記事（と、
一覧やタグのページ）の画像が変わるので、同じ PR の中でベースラインも更新する。

## 何を撮っているか

- **対象**: `dist/public/sitemap.xml` に載っているすべてのページ（トップ、About、タグ一覧、タグ詳細、
  公開済みの記事）と、存在しない URL の 404 画面。ページを足すと自動で対象に入る。
  - `draft: true` の記事は本番ビルドに含まれず、sitemap にもないので対象外。
  - 書き換えている最中の記事は、ベースラインが頻繁に変わるので、`EXCLUDED_PATHS` で外している
    （現在は `2026-10-18-void-cloudflare-rebuild` の記事。確定したら外す）。
- **ビューポート**: デスクトップ（1280px 幅）は全ページ。モバイル（390px 幅）は、構文の種類をカバーする
  代表だけ（`MOBILE_PATHS`。トップ、About、タグ一覧、タグ詳細 1 つ、記事 3 本、404）。
- **範囲**: ページ全体（スクロールした先まで）。

## 仕組み

1. `vrt/vitest.config.ts` が、`dist/public` を Vite の `publicDir` として、変換なしでそのまま配る。
   Vercel の `cleanUrls` と同じ解決（`/posts/x` → `posts/x.html`、存在しないパス → `404.html`）も
   再現する。サイトのクライアントルーターは URL のパスでルートを照合するので、`.html` 付きの URL
   だと 404 画面になってしまうため。
2. `vrt/site.browser.test.ts` が、テストのページの中に iframe を作って各ページを読み込む（同一オリジンなので
   中身を操作できる）。
3. 撮る前に、次の処理で描画を安定させる。
   - アニメーションとトランジションを止める。WebGL の `canvas`（About のシェーダー）は撮るたびに変わるので
     非表示にする。
   - `loading="lazy"` の画像を `eager` に切り替える（画面の外にある画像が読み込まれず、完了を待つ処理が
     終わらないため）。
   - Web フォントと画像の読み込みを待ち、ハイドレーションが終わるまで少し待つ。
   - ページ全体の高さに iframe を広げる。
4. ブラウザは、ライト固定・アニメーション抑制（`prefers-reduced-motion: reduce`）で起動する。

## 注意

- **ベースラインは Linux の Chromium で撮ったもの。** ファイル名にプラットフォームが入る
  （`...-chromium-linux.png`）ので、Mac など別の環境で実行しても、ベースラインがなく「新しく作成された」
  というエラーになるだけで、画像は比較されない。比較は Linux で行う。
- **初めて撮るページは、ベースラインを作成してテストが失敗する**（Vitest の仕様）。画像を確認して、もう一度
  実行すると通る。
- 画素の許容差は 0（既定値）。Chromium のバージョンが変わると、文字のアンチエイリアスの差で落ちることがある。
  その場合は、変更が見た目の差だけであることを確認してから、ベースラインを更新する。
- ここにある GitHub Actions はない（このリポジトリには CI がない）。VRT はローカルで手動で回す。
