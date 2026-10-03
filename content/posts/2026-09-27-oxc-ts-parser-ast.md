---
title: oxcのTypeScriptパーサーを読む 第4回 そのASTは誰に合わせているのか
description: oxcが吐くASTの形は誰の仕様に合わせているのか。TypeScript AST / TSESTree / oxc の3者の関係を、null型と後置の!の木の形で見ます。
date: 2026-09-27
tags: ["コンパイラ", "パーサー", "oxc", "TypeScript", "oxc-ts-parser"]
draft: true
---

この記事では、oxc が吐く AST の形が誰の仕様に合わせて作られているのかを確かめます。題材は `null` 型と後置の `!` で、oxc の木を、TypeScript AST (tsc の内部で使われている AST) と TSESTree (`@typescript-eslint/typescript-estree`) の木に並べて比べます。

## 今回読むファイル

読んだのは oxc の rev `1aa5ec11ce` です。行番号はすべてこのリビジョンのもので、ズレたときに探せるように関数名とセットで書きます。今回おもに開くのはこのあたりです。

```text
crates/oxc_ast/src/lib.rs                  132行   何に合わせるかを書いた冒頭のdoc
crates/oxc_ast/src/ast/ts.rs             1,876行   TSノードの定義
crates/oxc_ast/src/ast/js.rs             2,929行   JSノードの定義。型の中にも出てきます
crates/oxc_parser/src/ts/types.rs        1,690行   null型を読む腕
crates/oxc_parser/src/js/expression.rs   1,799行   後置の ! とチェーンの組み立て
```

比較のために、TSESTree 8.26.1 も走らせています。oxc とこちらの結果は、次の「下準備」の手順で手元でも同じものが出せます。TypeScript 本体 (tsc 3.9.10 / 4.0.8 / 5.7.3 / 5.9.3 / 6.0.3 と、Go 版の開発版) の結果は、Claude に確認してもらったものです。AST のダンプは、oxc は `cargo run -q -p oxc_parser --example parser -- x.ts --estree`、tsc は `ts.createSourceFile`、typescript-estree は `parse()` で採りました。

## 下準備: oxc と TSESTree の AST を手元で出す

この記事に出てくる oxc と TSESTree の木は、次の手順で手元でも同じものが出せます。Node.js と Rust のツールチェーンが入っていれば動きます。

まず oxc を記事と同じリビジョンで取ってきます。履歴まで丸ごと clone すると時間がかかるので、このコミットだけを `--depth 1` で浅く取ります (コミットを指定して取るので、SHA は省略せずに書きます)。そのうえで、隣に作業用のディレクトリを作り、TSESTree の 8.26.1 を入れます。これが使う `typescript` は peer dependency として npm が自動で入れます (手元では 5.8.3 が入りました)。

```bash
git init oxc
git -C oxc fetch --depth 1 https://github.com/oxc-project/oxc.git 1aa5ec11ce0dcbb0da7799e777c2492211908fbb
git -C oxc checkout FETCH_HEAD
mkdir repro && cd repro
npm init -y
npm install @typescript-eslint/typescript-estree@8.26.1
```

作業用の `repro` の中に、次の3つのファイルを置きます。1つ目は、ESTree 形式の式を、この記事で使う略記 (`Chain(NonNull(Member?(a, b)))` のような形) に直す関数です。

```js
// shape.cjs
// ESTree 形式の式を、記事の略記 (Chain / NonNull / Member? など) に直す
function shape(n) {
  switch (n.type) {
    case "ChainExpression":
      return `Chain(${shape(n.expression)})`;
    case "TSNonNullExpression":
      return `NonNull(${shape(n.expression)})`;
    case "ParenthesizedExpression":
      return `Paren(${shape(n.expression)})`;
    case "MemberExpression": {
      const prop = n.computed ? `[${n.property.raw}]` : n.property.name;
      return `Member${n.optional ? "?" : ""}(${shape(n.object)}, ${prop})`;
    }
    case "CallExpression":
      return `Call${n.optional ? "?" : ""}(${shape(n.callee)})`;
    case "Identifier":
      return n.name;
    default:
      return n.type;
  }
}
module.exports = { shape };
```

2つ目は、TSESTree で型と式をパースして、型注釈の種類と式の形を出すスクリプトです。

```js
// estree.cjs
const { parse } = require("@typescript-eslint/typescript-estree");
const { shape } = require("./shape.cjs");

const types = ["type A = null;", "type C = true;", "type F = `abc`;"];
for (const src of types) {
  const t = parse(src).body[0].typeAnnotation;
  console.log(src.padEnd(18), t.type, t.literal ? `> ${t.literal.type}` : "");
}

const exprs = [
  "a!",
  "a?.b!",
  "a?.b!.c",
  "a?.b.c!",
  "a!.b?.c",
  "a?.[0]!",
  "a?.()!",
  "a?.b!(x)",
  "(a?.b)!.c",
];
for (const src of exprs) {
  console.log(src.padEnd(12), shape(parse(src).body[0].expression));
}
```

3つ目は、oxc の `parser` サンプルの出力から JSON を取り出して、同じ形で出すスクリプトです。

```js
// oxc.cjs
// oxc の parser example の出力 (標準入力) から JSON を取り出し、式の形を略記で出す
const { shape } = require("./shape.cjs");
const out = require("fs").readFileSync(0, "utf8");
const ast = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
const stmt = ast.body[0];
if (stmt.typeAnnotation) {
  const t = stmt.typeAnnotation;
  console.log(t.type, t.literal ? `> ${t.literal.type}` : "");
} else {
  console.log(shape(stmt.expression));
}
```

TSESTree 側は、そのまま実行します。

```bash
node estree.cjs
```

oxc 側は、入力を1つずつファイルに書いて `parser` サンプルに `--estree` を付けて流し、その出力を `oxc.cjs` に渡します。

```bash
cd ../oxc
for src in 'type A = null;' 'type C = true;' 'type F = `abc`;' \
           'a!' 'a?.b!' 'a?.b!.c' 'a?.b.c!' 'a!.b?.c' 'a?.[0]!' 'a?.()!' 'a?.b!(x)' '(a?.b)!.c'; do
  printf '%s\n' "$src" > /tmp/x.ts
  printf '%-18s ' "$src"
  cargo run -q -p oxc_parser --example parser -- /tmp/x.ts --estree | node ../repro/oxc.cjs
done
```

どちらも、本文に出てくる木と同じ形が出力されます。

## 今回の題材

自分でパーサーを書いているときは、AST の形は自分で決められます。足し算をどういうノードにするかも、括弧をノードとして残すかどうかも、好きにしていい。

でも実用のパーサーにはそれができません。出力を食べる側がいるからです。リンターのルール、フォーマッター、トランスパイラ。それらは「このノードにはこの名前のフィールドがあるはず」という前提で書かれていて、パーサーを差し替えた瞬間にその前提が崩れると困る。

今回は、このパーサーが吐く AST は誰の形に合わせているのか、という話をします。答えを先に言うと TSESTree です。

## oxc 自身が何と言っているか

AST の型を定義しているクレート `oxc_ast` の冒頭、`crates/oxc_ast/src/lib.rs` のドキュメントコメントにこうあります。

> AST types are similar to [estree] and [typescript-eslint]'s definition, with a few notable exceptions

リンク先は typescript-eslint の `packages/ast-spec` (v8.9.0 のタグ) です。例外として挙がっているのは3つで、`Identifier` を `BindingIdentifier` / `IdentifierReference` / `IdentifierName` に分けること、`AssignmentExpression` の左辺を `AssignmentTarget` にすること、`Literal` を `BooleanLiteral` や `NumericLiteral` などに分けること。どれも Rust 側の都合というより、仕様に沿って型をきつくした結果に見えます。

面白いのはそのすぐ下の行です。

> For TypeScript types, we follow how field order is defined in [tsc].

ノードの名前と全体の形は typescript-eslint に、TS ノードのフィールドの並び順は tsc の実装に合わせる。参照先が2つに分かれています。この時点でもう「誰に合わせているのか」が一枚岩ではないことが分かります。

ちなみに、なぜ typescript-eslint に合わせるのかを説明した文書は、自分は oxc のリポジトリの中に見つけられませんでした。既存の ESLint ルールがパーサーの差し替えだけで動くようにするため、という理由は自然ですが、ここは自分の推測として書いておきます。以下で根拠にするのは、上のコメントと、パーサーの中に書かれたコメント、それと実際の出力の一致だけです。

## 3者はどういう関係か

登場人物を整理します。

```
                     TypeScript のソースコード
                              │
      ┌───────────────────────┼───────────────────────────┐
      ▼                       ▼                           ▼
     TypeScript AST        TSESTree                       oxc
  公式の実装            変換レイヤー                  Rust製の再実装
  パーサー +            tscのASTを受け取って           自前の手書きパーサー
  チェッカー            ESTree形式に組み替える          型の解決はしない
  （型を解決する）       （ESLintのために）             出力の形は TSESTree に寄せる
```

左端が tsc、つまり Microsoft が配っている公式の実装です。tsc が内部で使っている AST は、`ts.createSourceFile` などのコンパイラ API で `ts.Node` の木として取り出せます。この記事ではこれを TypeScript AST と呼びます。

真ん中の TSESTree は、自前のパーサーを持っていません。tsc を呼んで AST を作らせて、それを ESTree 形式に変換します。ESLint のエコシステムは ESTree の上に乗っているので、そのままでは食べられないからです。

右端が今回の主役です。oxc は TSESTree のような変換役ではなく、自前の再帰下降パーサーで最初から AST を組み立てます。それでいて、出てくる木の形は真ん中の出力に合わせてある。つまり TypeScript AST と同じ形を作ってから直すのではなく、作る時点で違う形にしている。

その「作る時点で違う」が一番はっきり出るのが、次の1行です。

## 実例1: null 型だけ、箱に入っていない

型エイリアスを1つ書きます。

```ts
type A = null;
```

これを oxc のパーサーに `--estree` を付けて流すと JSON が出てきます。ノードの種類だけ抜き出して木にすると、型注釈の部分はこうです。

```
TSTypeAliasDeclaration
  id: Identifier "A"
  typeAnnotation: TSNullKeyword
```

キーワードのノードが1個あるだけです。ところが同じ書き方で `type C = true;` を流すと、こう変わります。

```
TSTypeAliasDeclaration
  id: Identifier "C"
  typeAnnotation: TSLiteralType
    literal: Literal (true)
```

真偽値のほうは `TSLiteralType` という箱に入って、その中にリテラルが入る。JavaScript の文法では `null` も `true` も同じ `Literal` の仲間 ([ECMAScript 2025 の 13.2.3 Literals](https://tc39.es/ecma262/2025/multipage/ecmascript-language-expressions.html#sec-primary-expression-literals)) なのに、片方だけ箱がありません。

### パーサーの中では、腕が違う

理由はパーサーのソースにそのまま書いてあります。型の分岐の根っこにいる `parse_non_array_type` (`ts/types.rs:411`) の、いちばん最初の腕です。

```rust
Kind::Any
| Kind::Unknown
| Kind::String
| Kind::Number
| Kind::BigInt
| Kind::Symbol
| Kind::Boolean
| Kind::Undefined
| Kind::Never
| Kind::Object
// Parse `null` as `TSNullKeyword` instead of null literal to align with typescript eslint.
| Kind::Null => {
    if self.lexer.peek_token().kind() == Kind::Dot {
        self.parse_type_reference()
    } else {
        self.parse_keyword_type()
    }
}
```

コメントの意味は「null リテラルではなく `TSNullKeyword` としてパースする。typescript-eslint に合わせるため」。`Kind::Null` が `string` や `number` と同じ腕に並べられていて、次のトークンが `.` でなければ `parse_keyword_type` (`ts/types.rs:508`) に進みます。キーワード型のノードを1個作って終わりです。

いっぽう真偽値と文字列はもっと下の腕にいます。

```rust
Kind::Str | Kind::True | Kind::False => self.parse_literal_type(),
```

こちらは `parse_literal_type` (`ts/types.rs:1118`) で、リテラルを読んでから `TSLiteralType` で包みます。ひとつの match 式の中で、null だけが別のグループに引っ越している。しかもその引っ越しの理由が、ECMAScript の仕様でも TypeScript の仕様でもなく、リンター向けパッケージへの追従だと書いてある。

### TypeScript AST のほうは4.0で形が変わっていた

では合わせなかった場合、つまり TypeScript AST の形はどうなのか。ここは Claude に、バージョン違いの tsc を並べて `ts.createSourceFile` で AST をダンプしてもらいました。

```
type A = null;

  3.9.10        NullKeyword
  4.0.8         LiteralType > NullKeyword
  5.9.3         LiteralType > NullKeyword
  6.0.3         LiteralType > NullKeyword
```

比較用に同じファイルへ入れた他の型も出しています。`type B = undefined;` はどのバージョンでも `UndefinedKeyword` 単体、`type C = true;` はどれも `LiteralType > TrueKeyword`、`type D = string;` はどれも `StringKeyword`。動いたのは null だけでした。

つまり oxc の `TSNullKeyword` は独自のノードではなく、3.9 までの TypeScript AST にあった形です。

### TSESTree が剥がしていた

真ん中の層を見ると、経緯が一本につながります。TSESTree の 8.26.1、`dist/convert.js` の2439行目からです。

```js
case SyntaxKind.LiteralType: {
    if (node.literal.kind === SyntaxKind.NullKeyword) {
        // 4.0 started nesting null types inside a LiteralType node
        // but our AST is designed around the old way of null being a keyword
        return this.createNode(node.literal, {
            type: ts_estree_1.AST_NODE_TYPES.TSNullKeyword,
        });
    }
    return this.createNode(node, {
        type: ts_estree_1.AST_NODE_TYPES.TSLiteralType,
        literal: this.convertChild(node.literal),
    });
}
```

自分たちの AST は、null がキーワードだった昔の形を前提に設計してある。だから包まれたものは剥がす、と。バージョンを名指しで書いてあるので、上のダンプの結果とも合います。

実際に 8.26.1 を動かすと、`type A = null;` は `TSNullKeyword`、`type C = true;` は `TSLiteralType` を返しました。oxc の出力と一致します。

というわけで、順番はこうでした。

1. 3.9 まで、TypeScript AST では null 型はキーワードのノードだった
2. 4.0 で `LiteralType` の中に入るようになった
3. TSESTree は既存の利用者のために、それを剥がして昔の形を保った
4. oxc は、剥がした後の形を最初から作るようにした

ついでに Claude に Go 版の tsc (`tsc/internal/parser/parser.go:2830`) も確認してもらうと、4.0以降の形を引き継いでいました。

```go
case ast.KindNoSubstitutionTemplateLiteral, ast.KindStringLiteral, ast.KindNumericLiteral, ast.KindBigIntLiteral, ast.KindTrueKeyword,
	ast.KindFalseKeyword, ast.KindNullKeyword:
	return p.parseLiteralTypeNode(false /*negative*/)
```

null がリテラル型の仲間に並んでいます。移植のときも、ここは変えなかったわけです。

## 実例2: 後置の `!` とオプショナルチェーン

さっきの話は、ノード1個の形をどう決めるかでした。もう少し木らしい例として、非 null アサーションの後置 `!` と `?.` の組み合わせを見ます。ここもパースの手順ではなく、出来上がった木の形だけの話です。

11通りの入力を3者に食わせて、できた木の形を並べました。TypeScript AST の列は、Claude に tsc 6.0.3 で確認してもらったものです。表にすると縦に長いので、木の略記で並べます。`Chain` は `ChainExpression`、`NonNull` は `TSNonNullExpression`、`Member?` と `Call?` は optional なメンバーアクセスと呼び出し、`[chain]` は TypeScript AST のノードに `NodeFlags.OptionalChain` が立っていることを表します。

```
a!
  oxc・TSESTree   NonNull(a)
  TypeScript AST  NonNull(a)

a?.b!
  oxc・TSESTree   Chain(NonNull(Member?(a, b)))
  TypeScript AST  NonNull(Prop?[chain](a, b))

a?.b!.c
  oxc・TSESTree   Chain(Member(NonNull(Member?(a, b)), c))
  TypeScript AST  Prop[chain](NonNull[chain](Prop?[chain](a, b)), c)

a?.b.c!
  oxc・TSESTree   Chain(NonNull(Member(Member?(a, b), c)))
  TypeScript AST  NonNull(Prop[chain](Prop?[chain](a, b), c))

a!.b?.c
  oxc・TSESTree   Chain(Member?(Member(NonNull(a), b), c))
  TypeScript AST  Prop?[chain](Prop(NonNull(a), b), c)

a?.[0]!
  oxc・TSESTree   Chain(NonNull(Member?(a, [0])))
  TypeScript AST  NonNull(Elem?[chain](a, 0))

a?.()!
  oxc・TSESTree   Chain(NonNull(Call?(a)))
  TypeScript AST  NonNull(Call?[chain](a))

a?.b!(x)
  oxc・TSESTree   Chain(Call(NonNull(Member?(a, b))))
  TypeScript AST  Call[chain](NonNull[chain](Prop?[chain](a, b)))
```

読み取れることが2つあります。

ひとつめ。oxc と TSESTree は、ここに並べた8つすべてで木が一致しました。入力はあと3つあって、改行を挟んだ `a` と `!b` は両方とも「2つの文」として同じ扱いになり、拡張子を `.js` にしたものはそちらを走らせていないので比較対象外。残る1つが括弧つきの `(a?.b)!.c` で、ここだけ見た目が割れます。

とはいえ、これは差というより設定の話でした。oxc のパーサーには `preserve_parens` というオプションがあって、ドキュメントコメント自身が非標準だと断ったうえで既定値をオンにしています。オンのあいだは括弧が `ParenthesizedExpression` というノードとして残る。ESTree の仕様に括弧のノードは無いので、切れば消えます。つまり実質は全一致です。

ふたつめ。TypeScript AST だけ、作りがまるごと違います。そもそも `ChainExpression` に当たるノードを持っていません。Claude に 5.7.3 の `SyntaxKind` から Chain を含む名前を探してもらうと0件で、代わりに `NodeFlags.OptionalChain` (値は64) というビットがあり、チェーンに属するノードそれぞれに立ちます。

面白いのは `!` の位置でフラグの付き方が変わるところです。`a?.b!.c` を Claude に tsc 6.0.3 でダンプしてもらうと、こうなりました。

```
PropertyAccessExpression [chain]
  NonNullExpression [chain]
    PropertyAccessExpression [chain]
      Identifier
      QuestionDotToken
      Identifier
  Identifier
```

3つとも立っています。ところが `a?.b!` のほうは、外側の `NonNullExpression` にフラグが立ちません。`!` がチェーンの途中ならチェーンの一部、末尾ならチェーンの外側、という扱いです。oxc と TSESTree はそこを区別せず、`?.` を含む式の全体を `Chain` で包んで、`NonNull` はいつもその内側に入れます。

### 橋渡しをしている腕

oxc 側で、この形を作っているコードは3か所に分かれています。

まず `!` を食べる腕。`parse_member_expression_rest` (`js/expression.rs:859`) の中、`js/expression.rs:915` からの腕です。

```rust
Kind::Bang if self.is_ts && !self.cur_token().is_on_new_line() => {
    self.bump_any();
    lhs =
        Expression::new_ts_non_null_expression(self.end_span(lhs_start), lhs, self);
}
```

次に、式全体を読み終えたところで包む判断。`parse_lhs_expression_or_higher_impl` (`js/expression.rs:752`) が `in_optional_chain` という旗を持って回していて、立っていれば `map_to_chain_expression` に渡します。

そして、その `map_to_chain_expression` (`js/expression.rs:801`) の中身が今回の肝です。腕が4本あるだけの関数で、最初の2本は中身を省いて載せます。

```rust
fn map_to_chain_expression(&self, span: Span, expr: Expression<'a>) -> Expression<'a> {
    match expr {
        match_member_expression!(Expression) => { /* ChainExpression で包む */ }
        Expression::CallExpression(e) => { /* ChainExpression で包む */ }
        Expression::TSNonNullExpression(e) => {
            Expression::new_chain_expression(span, ChainElement::TSNonNullExpression(e), self)
        }
        expr => expr,
    }
}
```

メンバーアクセスと呼び出しが並んでいるのは、ECMAScript のオプショナルチェーンとして当然です。3つめの腕だけが TS 固有で、しかもこれが無いと `a?.b!` の `NonNull` が `Chain` の外に出てしまいます。TypeScript AST と同じ形になってしまう、と言ってもいい。

後置の記号を読む腕より、この腕のほうが「誰に合わせているのか」をよく語っている気がします。パースそのものには要らない腕だからです。

## AST は1つで、JS と TS が混ざっている

ここまで `TSNullKeyword` や `TSLiteralType` のような TS 専用のノードを見てきましたが、oxc には TS 用の木と JS 用の木が別々にあるわけではありません。1本の木に両方のノードが混ざって生えています。

分かりやすいのがテンプレートリテラル型です。

```ts
type F = `abc`;
```

埋め込みが無いので、これはただの文字列リテラル型です。oxc の出力はこうなります。

```
TSTypeAliasDeclaration
  typeAnnotation: TSLiteralType
    literal: TemplateLiteral
      quasis: [ TemplateElement "abc" ]
      expressions: []
```

型のノードの中に、式のノードが直接入っています。しかもこの `TemplateLiteral` は、JavaScript のコードに出てくるテンプレートリテラルと同じ型です。

型定義のほうを見ても同じです。`oxc_ast` の `TSLiteralType` (`ast/ts.rs:215`) の `literal` フィールドの型は `TSLiteral` (`ast/ts.rs:226`) という列挙で、その選択肢に `TemplateLiteral` がいます。定義されている場所は `ast/js.rs:419`、つまり JavaScript 側のファイルです。逆向きもあって、変数宣言などが持つ `type_annotation` は TS 側のノードを指します。ファイルは分かれていても、型としては相互に乗り入れている。

ここが、実例1の見え方を変えます。oxc には、TSESTree のように TypeScript AST を ESTree 形式に直す段が存在しません。`--estree` という出力は、この1本の木をそのまま書き出したものです。だから形を合わせたければ、後から直すのではなく、作るときに合わせるしかない。null の判定がパーサーの match 式の腕に書いてあるのは、そこしか書く場所が無いからでもあります。

念のため他の2者も確認しました。TSESTree の 8.26.1 は同じく `TSLiteralType` の中に `TemplateLiteral` を入れます。TypeScript AST は `LiteralType` の中に `NoSubstitutionTemplateLiteral` が入る形で、こちらは箱と中身の名前が違うだけです。

## まとめ

- oxc が出す AST の名前と形は TSESTree (typescript-eslint の ast-spec) に寄せてある。ただし TS ノードのフィールドの並び順は tsc に倣う、と `oxc_ast` のドキュメントコメントに書いてある
- null 型の木は TypeScript AST だけ違う。4.0から `LiteralType` で包むようになり、TSESTree はそれを剥がして昔の形を保ち、oxc は剥がした後の形を最初から作る
- 後置の `!` と `?.` の組み合わせも、括弧のノードを残すかどうかを除けば、oxc と TSESTree は一致した。TypeScript AST は `ChainExpression` を持たず、ノードにフラグを立てて表す
- oxc の AST は1本で、TS のノードの中に JS のノードが直接入る。変換の段が無いぶん、互換性への配慮がパーサーの match 式の腕として埋まっている

「tsc と同じものを Rust で速く作り直した」という話ではなく、「合わせる相手を選んだ」という話でした。どちらに合わせるかで木の形が変わるので、oxc の出力を読んでいて TypeScript AST と違うところに出会ったら、まず TSESTree 側を見ると答えがあることが多いです。

次回は、`1 + 1 as number / 2` という1行にまつわる事件です。`as` の優先順位が、7.0で意図的に変えられた話をします。

---

_最終更新: 2026年10月03日_
