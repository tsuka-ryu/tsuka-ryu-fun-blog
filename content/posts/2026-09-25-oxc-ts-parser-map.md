---
title: oxcのTypeScriptパーサーを読む 第2回 TypeScriptはどこに住んでいるか
description: oxc のリポジトリを地図として広げて、TypeScript の構文がどのファイルのどこに住んでいるかを、拡張子による枝の切り替わりまで含めて確かめます。
date: 2026-09-25
tags: ["コンパイラ", "パーサー", "oxc", "TypeScript", "oxc-ts-parser"]
---

## 今回読むファイル

読んだのは oxc の rev `1aa5ec11ce` です。行番号はすべてこのリビジョンのもので、ズレたときに探せるように関数名とセットで書きます。今回おもに開くのはこのあたりです。

```text
crates/oxc_parser/src/            44ファイル 24,406行   今回はここ全体を俯瞰します
crates/oxc_span/src/source_type.rs           841行   .ts / .tsx / .js を分ける型
```

## 今回の題材

第1回では型の降下のはしごを下から上まで歩きました。今回は視点を引きます。歩いた道を地図の上に置き直して、TypeScript という言語が
この巨大なリポジトリのどこに住んでいるのかを確かめる回です。コードの引用は少なめ、
ファイル名と行数が多めになります。

以下に出てくる行数と出現回数は、Claudeが `wc -l` と `grep` を走らせて数えた実測値です。

## oxc の全体像

まずoxcとは何か、公式サイトの What is Oxc? には冒頭で一言、こう書いてあります。

> The Oxidation Compiler is a collection of high-performance tools for JavaScript and TypeScript written in Rust.

訳すと「Oxidation Compiler（oxc）は、Rustで書かれたJavaScriptとTypeScriptのための高性能なツール群のコレクションです」。実際 `crates/` の下には 42 個のディレクトリが並んでいて、その中身は
だいたいこういう役割分担になっています。

```
oxc_parser       ソースコード → AST
oxc_semantic     AST → スコープ・シンボル・参照の解決
oxc_linter       Oxlint の本体
oxc_transformer  TS / JSX / 新しい構文の変換
oxc_formatter    Oxfmt の本体
oxc_minifier     圧縮
oxc_codegen      AST → ソースコード
```

これらの下に、全員が共有する土台があります。AST の定義そのものである `oxc_ast`、
アリーナアロケータの `oxc_allocator`、位置情報の `oxc_span`、エラー表現の `oxc_diagnostics`。
公式が掲げる哲学の一つが「One toolchain, shared building blocks」なので、
道具が別々に AST を持たずに一つを共有しているのは設計の意図どおりということになります。

この連載で読んでいるのは、この並びの一番上、入口の `oxc_parser` だけです。
セマンティック解析より後ろには今のところ一度も踏み込んでいません。

ちなみに `crates/` には `oxc_lexer` という独立したクレートもあり、SIMD を使う新しい
字句解析が入っています。ただしパーサーの `Cargo.toml` にこの依存は無く、コメントに
名前が出てくるだけでした。今回の経路に出てくるのは、パーサーが自分で持つほうです。

このクレートは、いずれ `oxc_parser` の字句解析をまるごと置き換える計画の第一歩でした
（[PR #24172](https://github.com/oxc-project/oxc/pull/24172)）。作者は P95（実行時間の
95パーセンタイル、遅めのケースも含めた指標）で 80〜100% の高速化を見込んでいると書いています。
今のパーサー側のコメントには、その
移行時に困らないよう先回りした配慮（定数の余裕分など）もすでに入っていました。

## パーサー本体のファイル地図

パーサー本体の中身を数えると、44 個の Rust ファイルで合計 24,406 行でした。
ディレクトリ単位でまとめると、こうなります。

```
crates/oxc_parser/src/
  lexer/      8,256 行 (19 ファイル)   字句解析
  js/         7,171 行 (12 ファイル)   JavaScript の構文
  ts/         2,654 行 ( 3 ファイル)   TypeScript 固有の構文
  jsx/          582 行 ( 1 ファイル)   JSX
  直下        5,743 行 ( 9 ファイル)   lib.rs / cursor.rs / diagnostics.rs など
```

TypeScript 専用のディレクトリは 3 ファイルしかなく、しかもそのうち `mod.rs` は 2 行です。
つまり中身は実質 2 ファイルしかありません。

個別に見ます。連載で実際に開いたファイルを中心に並べました。

```
ts/types.rs                1,690   型の再帰下降パーサー。
ts/statement.rs              962   enum / interface / type alias / namespace / declare
ts/mod.rs                      2   上の2つを束ねるだけ

js/expression.rs           1,799   式のはしご。as / satisfies / ! / <T>x がここに埋まる
js/module.rs               1,466   import / export。型だけの輸出入もここ
js/statement.rs              932   文の入口。TS の宣言への分岐はここから
js/class.rs                  901   クラス本体。修飾子と型注釈の巣
js/function.rs               567   引数リスト。型注釈とオーバーロード
js/arrow.rs                  410   アロー関数の曖昧性

lib.rs                     1,340   公開 API と ParserImpl の定義
diagnostics.rs             1,423   エラーメッセージの定義
modifiers.rs                 935   declare / readonly / abstract など 15 種の修飾子
cursor.rs                    638   checkpoint / rewind / lookahead という投機の道具
jsx/mod.rs                   582   JSX 専用の、もう一つの独立した再帰下降パーサー
context.rs                   190   パース中の文脈フラグ 9 個
lexer/typescript.rs           53   < と > の再字句解析。関数が2つだけ
```

一番小さい `lexer/typescript.rs` が 53 行というのが面白くて、
`f<T>(x)` と `a < b > c` を見分けるという代表的な難所に対して、字句側が用意している装備は
`re_lex_as_typescript_l_angle` と `re_lex_as_typescript_r_angle` の2つだけなんですよね。ここは第3回で見ていきます。

## TypeScript が関わる3つの世界

第0回で名前だけ挙げた「3つの世界」を、いま作った地図の上に置き直します。

1つ目は型の文法世界です。`ts/types.rs` の 1,690 行に、式とはまったく別の再帰下降
パーサーが丸ごと一個入っています。`parse_ts_type`(15 行目)を頂点に、union から
primary まで階層が関数で固定されている、第1回で歩いた場所です。

2つ目は TypeScript 固有の文です。`ts/statement.rs` の 962 行が担当していて、
enum、interface、type alias、namespace、declare が入っています。文法は素直です。

3つ目が、JavaScript の側への食い込みです。`as`、`satisfies`、後置の `!`、`<T>expr`、
`foo<T>()` といった構文は、専用ファイルを持ちません。式のパーサーの中に直接
埋め込まれています。次回の第3回で、`f<T>(x)` という一行を通しトレースするのがこの世界です。

つまり、TypeScript の構文は、`ts/` の中だけでは閉じていません。専用ディレクトリが
2,654 行なのに対して `js/expression.rs` は単体で 1,799 行あり、その中に型に関わる
分岐が点々と混ざっています。

## パーサーは1つ、枝が切り替わるだけ

実は、oxc には TypeScript 専用のパーサーがありません。
JavaScript 専用のパーサーもありません。同じ一つのパーサーが、`is_ts` という
真偽値でどの枝を有効にするかを切り替えています（ちなみにJSXも `is_jsx()` で分岐してるだけですが、
こちらは `is_ts` のような専用フィールドは無く、呼ぶたびに `self.source_type.is_jsx()` を
見ています）。

フィールドの定義は `ParserImpl` の中にあります。

```rust
// crates/oxc_parser/src/lib.rs:663
/// Precomputed typescript detection
is_ts: bool,
```

値が入るのはコンストラクタの中の一行だけです。

```rust
// crates/oxc_parser/src/lib.rs:695
is_ts: source_type.is_typescript(),
```

コメントの precomputed が示すとおり、パース中に変わりません。`SourceType` から一度だけ
計算して、あとは参照するだけの定数です。

### `is_ts` で分岐する54か所

この `self.is_ts` がパーサーの中に何か所あるか、Claudeで数えたら 54 でした。
ファイル別の内訳がこちらです。

```
js/module.rs        10
ts/statement.rs      9
js/function.rs       8
js/expression.rs     7
js/class.rs          7
js/statement.rs      3
js/binding.rs        3
js/arrow.rs          3
ts/types.rs          2
jsx/mod.rs           1
js/declaration.rs    1
```

最多が `js/module.rs` の 10 か所というのは意外でした。`import type` や
`export type` のような、型だけの輸出入の構文がここに集まっているからみたいです（今回読んでない）。
一方で `ts/types.rs` は 2 か所しかありません。これは `class A extends B<string> {}` の
ように、式側の `<` 判定が失敗したときだけ型引数のパースに落ちてきて、`.js` でも
読み切ったうえで TS8011 のエラーを出す、というケースでした。

### `SourceType` が受け付ける拡張子

拡張子は 8 種類で、`oxc_span/src/source_type.rs:119` に定数として並んでいます。

```rust
pub const VALID_EXTENSIONS: &[&str] = &["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"];
```

同じソースでも拡張子を変えるだけで通ったり通らなかったり、木の形が変わったりすることがあります。

## 余談: 本家（tsc）の全体感

ついでに本家（tsc）の全体感も見ておきます。Go移植版（tsgo、rev `f29aeb9f`）と、Go移植前
最後のJS版（v6.0.3）です。ファイルの割り方が対照的で、こちらは1機能=1つの巨大ファイル
という作り（`parser.ts` が10,823行1本、`checker.ts` にいたっては54,434行1本）ですが、
Go版は同じ役割を複数ファイルに割っています。テストを除いた行数を役割ごとに並べると、
こうでした。

| 役割         | tsc(JS 6.0.3) | 行数(ファイル数) | tsc(Go tsgo) | 行数(ファイル数) |
| ------------ | ------------- | ---------------- | ------------ | ---------------- |
| 字句解析     | scanner.ts    | 4,101行(1)       | scanner/     | 4,330行(4)       |
| パーサー     | parser.ts     | 10,823行(1)      | parser/      | 9,102行(6)       |
| バインダー   | binder.ts     | 3,916行(1)       | binder/      | 3,570行(3)       |
| AST定義      | types.ts      | 10,670行(1)      | ast/         | 21,219行(21)     |
| 出力         | emitter.ts    | 6,378行(1)       | printer/     | 11,748行(17)     |
| 型チェッカー | checker.ts    | 54,434行(1)      | checker/     | 60,831行(25)     |

全体では `src/compiler`（64ファイル）が179,030行、`tsc/internal`（539ファイル・52パッケージ）が317,397行でした。

型チェッカーの25ファイルは、均等に割られているわけではありませんでした。内訳の上位はこうです。

```text
checker.go            32,575行  型チェック本体。これだけでJS版 checker.ts (54,434行) の6割に迫る
relater.go             5,046行  型の関係性判定（assignability など）
nodebuilderimpl.go     3,714行  型 → AST表現の構築
flow.go                2,761行  制御フロー解析
grammarchecks.go       2,237行  文法チェック
（残り20ファイルはすべて2,000行未満）
```

`checker.go` 1本だけでパッケージ全体（60,831行）の過半数を占めていて、切り出されたのは
型の関係性判定・制御フロー解析・JSXといった周辺だけでした。「Go移植なら読みやすく
分割されているかも」という淡い期待は、儚く消えました。

話を oxc との比較に戻すと、パーサーと字句解析だけならどちらのバージョンも
1万3千〜1万5千行台で、oxc_parser（44ファイル・24,406行）よりむしろ小さいくらいです。
逆に型チェッカーは JS版・Go版とも単体で oxc_parser 全体の2倍を超えます。

oxc 側で一番近いのは `oxc_semantic`（11,257行）ですが、こちらはスコープとシンボルの
解決までで型は解決しません。`oxc_type_checker` という名前のクレート（2,272行）も
ありますが、README に Experimental とある通りの足場で、中身の `check()` は AST を
歩くだけの no-op です。つまり、現状は「oxc は型を解決しない」のですが、今後に期待ですね。

## まとめ

今回の地図を三行にすると、こうなります。

oxc は 42 クレートのツールチェーンで、今読んでいるのはその入口一枚だけ。
パーサー本体は 24,406 行あって、TypeScript 専用のディレクトリはそのうち 2,654 行しかない。
残りは `js/` に食い込む形で住んでいます。

そして、TypeScript 専用のパーサーというものは存在しません。`self.is_ts` の 54 か所が、
同じ一つのパーサーの中で枝を開け閉めしているだけです。

地図が引けたので、次回からはまた細い道に戻ります。第3回では `f<T>(x);` という1行を
先頭から通しで追って、先読みと投機パースとre-lexが全部出てくるところを見ていきます。
