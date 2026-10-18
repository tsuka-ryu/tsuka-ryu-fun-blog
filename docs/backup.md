# バックアップと復元

データは 3 か所に、別々の形で持っている。

| 何を                                         | どこに                                                     | 守れるもの                                                                                                                                                                                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公開中の記事の原文（frontmatter 付き `.md`） | R2 の `published/posts/<slug>.md`（公開のたびに書き直す）  | 公開済みの記事の本文。`/posts/<slug>.md` で配信している内容と同じ                                                                                                                                                                                                      |
| 記事・下書き・履歴・タグ・画像の管理表       | D1。`scripts/backup.mjs` で JSON に書き出せる              | **下書き、履歴、公開の状態**を含む全部                                                                                                                                                                                                                                 |
| D1 の直近の状態                              | Cloudflare の D1 Time Travel（自動。追加の設定・費用なし） | 直近への巻き戻し。無料プランは **7 日**、有料プラン（Workers Paid）は **30 日**。巻き戻しは、その時点へ**上書き**で戻す（[公式](https://developers.cloudflare.com/d1/reference/time-travel/)、制限は [Limits](https://developers.cloudflare.com/d1/platform/limits/)） |

アップロードした画像は R2（`uploads/`）にある。R2 自体のバックアップは取っていないので、画像が大事なら、
`wrangler r2 object get` などで別に保管する。`public/blog/` の既存の画像は、リポジトリ（Git）にある。

## D1 を JSON に書き出す（定期的に）

```sh
ADMIN_API_TOKEN=... node scripts/backup.mjs https://tsuka-ryu.dev
# => backups/blog-2026-10-18T12-00-00-000Z.json
```

`backups/` は Git に入れない。書き出しには下書きも入るので、公開リポジトリには置かない。
認証のテーブル（ユーザー・セッション）は含めない（GitHub でログインし直せば作られる）。
週に 1 回程度を目安に、手元か別のストレージに保管する（無料プランの Time Travel は 7 日しか戻れないため）。

## 復元する

1. **空の** D1 を用意する（新しい D1 に `void db migrate --remote`、またはローカルなら `void db reset`）。
   記事がすでにある D1 には戻せない（上書きで壊さないため。409 で断る）。
2. 書き出した JSON を送る。D1 に id のまま戻し、そのあと**公開中の記事を、公開中の版の内容のまま R2 に公開し直す**
   （記事・`.md`・OG 画像・一覧・feed・sitemap・検索索引）。

   ```sh
   curl -X POST https://tsuka-ryu.dev/api/admin/restore \
     -H "authorization: Bearer $ADMIN_API_TOKEN" -H "content-type: application/json" \
     --data-binary @backups/blog-....json
   ```

## 公開スナップショットだけを作り直す

R2 の公開スナップショット（AST を含む JSON など）は、パーサーや描画を変えると古くなる。D1 はそのままで、
公開中の全記事を作り直すには:

```sh
curl -X POST https://tsuka-ryu.dev/api/admin/republish -H "authorization: Bearer $ADMIN_API_TOKEN"
```

公開中の版の内容のまま作り直すので、下書きの未公開の変更は載らない。
