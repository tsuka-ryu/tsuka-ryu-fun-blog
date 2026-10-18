# VRT（ビジュアルリグレッションテスト）

ビルド済みの Void のサイト（`vite preview` が配信する Worker）の見た目が変わっていないことを、スクリーンショットの比較で確かめる。
Void + Cloudflare への作り直し（`docs/void-cloudflare-rebuild.md`）の前後で、見た目が同じであることを
保証するために作った。移行後も、依存の更新などで見た目が壊れたときに気づくために回し続ける。

- 使うもの: Vitest のブラウザモード + Playwright（Chromium）+ `toMatchScreenshot`
- ベースライン画像: `vrt/__screenshots__/site.browser.test.ts/`（コミットする。65 枚、約 44MB）
- 実行時の一時ファイル（失敗した画像と差分画像）: `vrt/.vitest/`（`.gitignore` 済み）

## 実行する

```sh
pnpm build            # dist を最新にする（記事やコードを変えたら必ず先にビルドする）
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

- **対象**: `/sitemap.xml`（Worker が動的に返す）に載っているすべてのページ（トップ、About、タグ一覧、タグ詳細、
  公開済みの記事）と、存在しない URL の 404 画面。ページを足すと自動で対象に入る。
  - `draft: true` の記事は本番ビルドに含まれず、sitemap にもないので対象外。
  - 書き換えている最中の記事は、ベースラインが頻繁に変わるので、`EXCLUDED_PATHS` で外している
    （現在は `2026-10-18-void-cloudflare-rebuild` の記事。確定したら外す）。
- **ビューポート**: デスクトップ（1280px 幅）は全ページ。モバイル（390px 幅）は、構文の種類をカバーする
  代表だけ（`MOBILE_PATHS`。トップ、About、タグ一覧、タグ詳細 1 つ、記事 3 本、404）。
- **範囲**: ページ全体（スクロールした先、フッターまで）。高さが 12000px を超えるページ（長い記事 3 本）は、
  Chromium が 1 枚で描画できる上限（約 16384px）を避けるため、`-1of2` のように分けて撮る。
- **撮らないもの（決定: 不要）**: ホバー中の見た目とアニメーション（ヒーロー見出しのグリッチなど）。
  作り直しでも `src/styles.css` はそのまま使うので壊れる可能性が低く、撮るには iframe の中の要素を
  Playwright でホバーするカスタムコマンドが要るため、費用に見合わないと判断した。必要になったら、
  `defineBrowserCommand` で `iframe.frameLocator(...).locator(...).hover()` を呼ぶコマンドと、
  Web Animations API で止めた時刻での撮影で足せる（未検証）。WebGL のシェーダーは時間を固定できず撮れない。

## 仕組み

1. `vrt/global-setup.ts` が、撮る前にサイトを用意する。公開ページは R2 のスナップショットを読むので、
   まっさらなローカル状態（`vrt/.state/`。開発中の `.void/` には触れない）で `vite preview`
   （Void のビルドを workerd 上で動かす本番に近い配信）をポート 4399 に起動し、`void db migrate` を流して、
   `scripts/import-posts.ts` で `content/posts/*.md` を管理 API から取り込む。終了時に止めて状態を消す。
   - 管理 API のトークンと、認証のダミーの認証情報は、`dist/ssr/.dev.vars` に書く（プレビューはシェルの環境変数を
     受け取らない。認証のミドルウェアは全リクエストで GitHub の認証情報を要求する）。
   - Vitest は `setup` を 2 回呼ぶことがあるので、起動は 1 回だけにしてある。
   - 起動や取り込みに失敗したら、`vrt/.vitest/preview.log` にプレビューの出力が残る。
     `vrt/vitest.config.ts` は、Vitest 自身のパス以外のリクエストをこのプレビューへプロキシする。
     これでテストのページとサイトが**同じオリジン**になり、iframe の中身を操作できる。
     未知の URL は Worker が 404 を返す（`middleware/02.not-found.ts`）。
2. `vrt/site.browser.test.ts` が、テストのページの中に iframe を作って各ページを読み込む（同一オリジンなので
   中身を操作できる）。
3. 撮る前に、次の処理で描画を安定させる。
   - アニメーションとトランジションを止める。WebGL の `canvas`（About のシェーダー）は撮るたびに変わるので
     非表示にする。
   - `loading="lazy"` の画像を `eager` に切り替える（画面の外にある画像が読み込まれず、完了を待つ処理が
     終わらないため）。
   - Web フォントと画像の読み込みを待ち、ハイドレーションが終わるまで少し待つ。
   - **ブラウザの縦幅（`page.viewport`）をページの高さに合わせる。** iframe の要素を撮る方式では、最初の画面
     （viewport）より下が描画されず、画像の下半分が真っ白になる（先頭 800px しか比べられない）。サイトは
     `min-height: 100vh` を使うので、縦幅を変えたあとの高さを測り直して、安定するまで繰り返す。
4. ブラウザは、ライト固定・アニメーション抑制（`prefers-reduced-motion: reduce`）で起動する。

## 作り直しで、見た目が変わったページ

自作の Markdown パーサーに切り替えたとき、ox-content の不具合で崩れていた
**`/posts/2026-09-25-oxc-ts-parser-map` と `/posts/2026-09-26-oxc-ts-parser-trace`** のベースラインだけを、
正しい描画（`oxc_parser` の `_` が消えない）に更新した。ほかのページは、移行前のベースラインのまま通っている。

## 注意

- **ベースラインは Linux の Chromium で撮ったもの。** ファイル名にプラットフォームが入る
  （`...-chromium-linux.png`）ので、Mac など別の環境で実行しても、ベースラインがなく「新しく作成された」
  というエラーになるだけで、画像は比較されない。比較は Linux で行う。
- **初めて撮るページは、ベースラインを作成してテストが失敗する**（Vitest の仕様）。画像を確認して、もう一度
  実行すると通る。
- ベースライン画像は、画像が白く途切れていないかを目で確かめる。下のほうが真っ白な画像は、描画されていない
  （撮り方の不具合）。
- 画素の許容差は、1 枚あたり 100px まで（`allowedMismatchedPixels`）。テキストノードの分割差で出る文字の
  サブピクセル揺れ（数〜数十px）を許すため。画面の崩れは数千px単位で差が出るので、検出力は落ちない。Chromium のバージョンが変わると、文字のアンチエイリアスの差で落ちることがある。
  その場合は、変更が見た目の差だけであることを確認してから、ベースラインを更新する。
- ここにある GitHub Actions はない（このリポジトリには CI がない）。VRT はローカルで手動で回す。
