# 検索の仕組み

このブログのサイト内検索は **ox-content（`@ox-content/napi`）** を使い、
**ビルド時にインデックスを作る**処理と、**ブラウザ上で検索する**処理を完全に分離している。
ネイティブ（NAPI）モジュールはクライアントには一切届かない。

実装: [`src/lib/search.ts`](../src/lib/search.ts)

## 全体像（データフロー）

```
[ビルド時 / サーバー]                          [配信される静的ファイル]        [ブラウザ / クライアント]

src/content.ts (getAllPosts)
      │  記事の mdast + frontmatter
      ▼
src/lib/search.ts
  collectContent()  ──┐
  searchDocuments()   │  記事 → JsSearchDocument[]
      │               │
      ├─ buildSearchIndexJson()  ──►  /search-index.json  ──┐
      │  （BM25 インデックスを JSON 化）                      │  fetch
      │                                                      ▼
      └─ buildSearchRuntimeJs()  ──►  /search.js  ──►  SearchBox（純 JS ランタイム）
         （ox-content が生成する純 JS の                      │
          BM25 検索ランタイム。CJK トークナイズ対応）          ▼
                                                        検索結果を表示
```

- `buildSearchIndexJson()` / `buildSearchRuntimeJs()` は **build entry（`src/app/build.ts`）**から呼ばれ、
  生成された HTML と同じ出力ディレクトリに `/search-index.json` と `/search.js` を書き出す。
- クライアントの `SearchBox`（後フェーズで実装）は `/search.js` を読み込み、`/search-index.json` を
  取得して検索する。
- **ネイティブモジュールがブラウザに来ない理由**: `@ox-content/napi` はビルド時にしか呼ばれず、
  `vite.config.ts` の `ssr.external` / `optimizeDeps.exclude` で除外しているため、クライアント
  バンドルに混入しない。クライアントが使うのは ox-content が**出力した純 JS の文字列**（`/search.js`）だけ。

## 検索ドキュメント（`JsSearchDocument`）

各記事は次の形に変換される（`searchDocuments()`）。

| フィールド | 中身           | 由来                                   |
| ---------- | -------------- | -------------------------------------- |
| `id`       | 記事スラッグ   | `post.slug`                            |
| `title`    | 記事タイトル   | `post.frontmatter.title`               |
| `url`      | 記事 URL       | `/posts/<slug>`                        |
| `body`     | 本文テキスト   | 段落・リスト等の `text` / `inlineCode` |
| `headings` | 見出しテキスト | `heading` ノード（h1〜h6）             |
| `code`     | コードブロック | `code` ノード（フェンスドコード）      |

`title` / `headings` / `body` / `code` を分けて渡すことで、ox-content 側がフィールドごとに
重み付けして関連度（BM25 スコア）を計算できる。

## 本文収集ルール（`collectContent`）

mdast ツリーを走査し、ノード種別ごとに振り分ける。

- **`code`**: `code` 配列へ。子は持たないのでそこで打ち切り（再帰しない）。
- **`heading`**: 見出しテキストを `headings` 配列へ集約し、**そこで打ち切る**。
  → 見出し語が `body` にも入る「二重計上」を避けるため、heading 配下へは再帰しない。
- **`text` / `inlineCode`**: 値を `body` 配列へ。
- **その他（`paragraph` / `list` / `link` など）**: 子ノードへ再帰。
  → リンクのラベル文字列は `text` 子として `body` に入る（＝検索対象）。リンクの URL は対象外。

### 現状の非対象

- **画像の `alt`**: `image` ノードは子を持たず `alt` は別フィールドのため、現状インデックスに含めない。
- **リンクの `url`**: 検索ノイズになるため `body` には含めない（ラベルのみ対象）。

## クライアントランタイムのオプション（`SEARCH_OPTIONS`）

`generateSearchModuleFromOptions` に渡す `JsSearchRuntimeOptions`。

| オプション    | 値                | 意味                                         |
| ------------- | ----------------- | -------------------------------------------- |
| `enabled`     | `true`            | 検索を有効化                                 |
| `limit`       | `8`               | 表示する最大件数                             |
| `prefix`      | `true`            | 前方一致を有効化                             |
| `placeholder` | `"記事を検索..."` | 入力欄のプレースホルダ                       |
| `hotkey`      | `"/"`             | 検索にフォーカスするキーボードショートカット |

インデックスの取得元パスは `INDEX_PATH = "/search-index.json"` で固定。
