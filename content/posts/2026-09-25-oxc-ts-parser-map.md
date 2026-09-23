---
title: oxcのTypeScriptパーサーを読む 第2回 TypeScriptはどこに住んでいるか
description: oxc のリポジトリを地図として広げて、TypeScript の構文がどのファイルのどこに住んでいるかを、拡張子による枝の切り替わりまで含めて確かめます。
date: 2026-09-25
tags: ["コンパイラ", "パーサー", "oxc", "TypeScript"]
---

## 今回読むファイル

読んだのは oxc の rev `1aa5ec11ce` です。行番号はすべてこのリビジョンのもので、ズレたときに探せるように関数名とセットで書きます。今回おもに開くのはこのあたりです。

```text
crates/oxc_parser/src/            44ファイル 24,406行   今回はここ全体を俯瞰します
crates/oxc_span/src/source_type.rs           841行   .ts / .tsx / .js を分ける型
```

## 今回の題材

第1回では型の降下のはしごを下から上まで歩きました。細い道を一本、じっくり歩いた回でしたね。

今回は視点を引きます。歩いた道を地図の上に置き直して、TypeScript という言語が
この巨大なリポジトリのどこに住んでいるのかを確かめる回です。コードの引用は少なめ、
ファイル名と行数が多めになります。

以下に出てくる行数と出現回数は、自分が `wc -l` と `grep` を走らせて数えた実測値です。

## そもそも oxc はパーサーではない

自分は最初、名前の響きから「Rust で書かれた速い JS パーサー」くらいに思っていたのですが、
これは正確ではありませんでした。公式サイトの What is Oxc? は、冒頭でこう名乗っています。

> The Oxidation Compiler is a collection of high-performance tools for JavaScript and TypeScript written in Rust.

コレクションです。実際 `crates/` の下には 42 個のディレクトリが並んでいて、その中身は
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

この時点ですでに、地図としての一番大きな発見があります。TypeScript 専用の
ディレクトリは 3 ファイルしかなく、しかもそのうち `mod.rs` は 2 行です。
つまり中身は実質 2 ファイルしかありません。

個別に見ます。連載で実際に開いたファイルを中心に並べました。

```
ts/types.rs                1,690   型の再帰下降パーサー。第1回の主戦場
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

一番小さい `lexer/typescript.rs` が 53 行というのが個人的にはずっと面白くて、
`f<T>(x)` と `a < b > c` を見分けるという代表的な難所に対して、字句側が用意している装備は
`re_lex_as_typescript_l_angle` と `re_lex_as_typescript_r_angle` の2つだけなんですよね。

### 公式ドキュメントの構造図は古かった

地図を作るにあたって、oxc の Contribute ガイドにある Parser のページも読みました。
Project Structure の節に、ちゃんとツリー図が載っています。ところがそこには
`parser/statement.rs`、`parser/expression.rs`、`parser/typescript.rs`、`parser/jsx.rs`
という名前が並んでいて、実物には `parser/` というディレクトリ自体がありません。

今は `js/`、`ts/`、`jsx/` に分かれていて、型の構文が一枚の `typescript.rs` に収まっていた
時代は過ぎています。迷ったら実物を `find` するのが早いです。自分は少し遠回りしました。

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

地図として言い直すと、TypeScript の構文の住所は `ts/` の中だけでは閉じていない、
ということです。専用ディレクトリが 2,654 行なのに対して `js/expression.rs` は単体で
1,799 行あり、その中に型に関わる分岐が点々と混ざっています。

### 入口は文の側と式の側の2系統

道が2本ある、というのが第0回で書いた話でした。実際のコードで対を確認すると、
きれいに対称になっています。

```
文の側:
  parse_statement_list_item        js/statement.rs:131
    └ self.is_ts && self.at_start_of_ts_declaration()    js/statement.rs:191
        └ parse_ts_declaration_statement                 ts/statement.rs:612
            └ parse_declaration                          ts/statement.rs:640

式の側:
  parse_member_expression_rest     js/expression.rs:859
    ├ Kind::Bang if self.is_ts                           js/expression.rs:915
    └ Kind::LAngle | Kind::ShiftLeft if self.is_ts       js/expression.rs:920
```

文の入口は `match` の腕のガードに `at_start_of_ts_declaration`(`ts/statement.rs:863`)が
呼ばれていて、この関数が「ここから TypeScript の宣言が始まるか」を判定します。
式の入口は、左辺式のループの `match` に専用の腕が生えているだけです。

同じ「型の側へ渡る」という仕事でも、文は専用の判定関数を経由し、式はループの腕として
直接持つ、という非対称がありました。

## パーサーは1つ、枝が切り替わるだけ

ここからが今回の本題かもしれません。oxc には TypeScript 専用のパーサーがありません。
JavaScript 専用のパーサーもありません。同じ一つのパーサーが、`is_ts` という
真偽値でどの枝を有効にするかを切り替えています。

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

### 54 か所の内訳

この `self.is_ts` がパーサーの中に何か所あるか、自分で数えたら 54 でした。
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
`export type` のような、型だけの輸出入の構文がここに集まっているからです。
一方で `ts/types.rs` は 2 か所しかありません。型の文法世界には、そもそも
TypeScript でなければ到達しないので、中で改めて確認する必要がないわけです。

判定が多いのは境界のファイル、少ないのは奥まったファイル。地図らしい分布だと思います。

### 拡張子を変えると何が起きるか

ここで `SourceType` が受け付ける拡張子は 8 種類で、`oxc_span/src/source_type.rs:119` に
定数として並んでいます。

```rust
pub const VALID_EXTENSIONS: &[&str] = &["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"];
```

同じソースを拡張子だけ変えて、付属の parser サンプル(`cargo run -p oxc_parser --example parser`)に
食わせてみました。左から `.ts` / `.tsx` / `.js` / `.jsx` の結果です。

```
type A = string;     成功   成功   構文エラー          構文エラー
enum E { A }         成功   成功   構文エラー          構文エラー
const b = a!;        成功   成功   構文エラー          構文エラー
const c = x as string;  成功  成功  TS8016 のエラー     TS8016 のエラー
const a = <T>x;      成功   構文エラー   JSX のエラー   構文エラー
const d = <div />;   構文エラー  成功  JSX のエラー     成功
f<T>(x);             成功   成功   成功                成功
```

行ごとに違う顔をしていて、これが 54 か所の枝の総体です。面白いところを3つ。

まず `as` の行。`.js` で出るのは構文エラーではなく TS8016、つまり「型アサーションは
TypeScript のファイルでしか使えません」という意味のエラーです。腕そのものは JavaScript でも
構文を読み切ってしまい、読んだ後にエラーだけを足します。後置の `!` が腕のガードで
弾かれるのとは、対処が違うわけです。

次に最終行。`f<T>(x)` はどの拡張子でも通りますが、出てくる木が違います。ESTree 出力で
確かめると、`.ts` では型引数を持つ呼び出し式になり、`.js` では `(f < T) > (x)` という
比較の入れ子、つまり BinaryExpression が2段になります。エラーが出ないぶん静かに意味が
変わる例で、次回追いかける `<` の投機はこの行の `.ts` 側でだけ起きていたことになります。

そして `<T>x` と `<div />` の行が、ちょうど鏡写しになっているところ。次の話です。

### 分岐の軸は `is_ts` だけではない

さて、`<` の行き先を決めているのは `is_ts` ではありませんでした。`SourceType` は
独立した2つの軸を持っています。`Language` が JavaScript / TypeScript /
TypeScriptDefinition の3値、`LanguageVariant` が Standard / Jsx の2値です。

```rust
// crates/oxc_span/src/source_type.rs:430
pub fn is_typescript(self) -> bool {
    matches!(self.language, Language::TypeScript | Language::TypeScriptDefinition)
}

// crates/oxc_span/src/source_type.rs:442
pub fn is_jsx(self) -> bool {
    self.variant == LanguageVariant::Jsx
}
```

たとえば `.tsx` は言語が TypeScript で、かつ変種が Jsx。だから `is_typescript()` も
`is_jsx()` も真になります。この2軸が、`<` を見たときの振り分けをそのまま決めます。
実物は `parse_unary_expression_or_higher`(`js/expression.rs:1247`)の腕です。

```rust
// TS type assertion, a modified `UnaryExpression`: `< Type > UnaryExpression`, e.g. `<T>x`.
Kind::LAngle if !self.source_type.is_jsx() => {
    if self.is_ts {
        self.with_pure_comments(Self::parse_ts_type_assertion)
    } else {
        self.parse_jsx_in_non_jsx_error()
    }
}
```

腕のガードが見ているのは変種が Jsx かどうかで、しかも否定形です。`.tsx` や `.jsx` の
ファイルならこの腕には入らず、下の `parse_update_expression` まで落ちて、そこで JSX の
要素として読まれます。腕に入れたときに初めて `is_ts` を見て、型アサーションかエラーかを決めます。

つまり判定の順番は、まず JSX かどうか、次に TypeScript かどうか、です。
`.tsx` で `<T>x` という型アサーションが書けないのは、型の機能が無効だからではなく、
`<` が先に JSX として取られて腕に入れないからでした。TypeScript 側の事情ではなく、
字句の取り合いに負けているだけ、という理解になります。

同じ判定は `parse_simple_unary_expression`(`js/expression.rs:1272`)にもあります。

```rust
// js/expression.rs:1272 parse_simple_unary_expression
Kind::LAngle => {
    if self.source_type.is_jsx() {
        return self.parse_jsx_expression();
    }
    if self.is_ts {
        return self.with_pure_comments(Self::parse_ts_type_assertion);
    }
    self.parse_jsx_in_non_jsx_error()
}
```

こちらはガードを使わず、腕の中で `is_jsx()` を先に見てから `is_ts` を見る書き方でした。
動きは同じですが、書き方が揃っていません。こういう二重管理は oxc のあちこちにあって、
`at_start_of_ts_declaration` の高速経路とその worker も同じ形をしています。

ついでに、パース中の文脈フラグは `context.rs` に 9 個あり、そのうち型由来は
`DisallowConditionalTypes` と `Ambient` の2つでした。ファイル単位で固定の `is_ts` と違って、
こちらはパースの途中で付け外しされます。第1回で条件型のネストを禁止するために
出入りしていたのが、前者のフラグです。

## まとめ

今回の地図を三行にすると、こうなります。

oxc は 42 クレートのツールチェーンで、今読んでいるのはその入口一枚だけ。
パーサー本体は 24,406 行あって、TypeScript 専用のディレクトリはそのうち 2,654 行しかない。
残りは `js/` に食い込む形で住んでいて、入口は文の側と式の側の2系統。

そして、TypeScript 専用のパーサーというものは存在しません。`self.is_ts` の 54 か所と、
`is_jsx()` を見るいくつかの分岐が、同じ一つのパーサーの中で枝を開け閉めしているだけです。
拡張子を変えて同じコードを食わせたとき、はねられるもの、木だけが静かに変わるもの、
読んだ後にエラーを足されるものの3種類が出たのは、開け閉めの仕方が場所ごとに違うからでした。

地図が引けたので、次回からはまた細い道に戻ります。第3回では `f<T>(x);` という1行を
先頭から通しで追って、先読みと投機パースとre-lexが全部出てくるところを見ていきます。
