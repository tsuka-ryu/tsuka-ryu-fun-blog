---
title: oxcのTypeScriptパーサーを読む 第4回 そのASTは誰に合わせているのか
description: oxcが吐くASTの形は誰の仕様に合わせているのか。tsc / typescript-estree / oxc の3者の関係を、null型と後置の!の木の形で見ます
date: 2026-09-27
tags: ["コンパイラ", "パーサー", "oxc", "TypeScript"]
---

自分でパーサーを書いているときは、ASTの形は自分で決められます。足し算をどういうノードにするかも、括弧をノードとして残すかどうかも、好きにしていい。

でも実用のパーサーにはそれができません。出力を食べる側がいるからです。リンターのルール、フォーマッター、トランスパイラ。それらは「このノードにはこの名前のフィールドがあるはず」という前提で書かれていて、パーサーを差し替えた瞬間にその前提が崩れると困る。

前回は地図を引いて、パーサーは1つで枝が切り替わるだけだと確認しました。ではその1つのパーサーが吐くASTは、誰の形に合わせているのか。今回はその話です。答えを先に言うと typescript-estree です。

## oxc 自身が何と言っているか

AST の型を定義しているクレート `oxc_ast` の冒頭、`crates/oxc_ast/src/lib.rs` のドキュメントコメントにこうあります。

> AST types are similar to [estree] and [typescript-eslint]'s definition, with a few notable exceptions

リンク先は typescript-eslint の `packages/ast-spec`（v8.9.0 のタグ）です。例外として挙がっているのは3つで、`Identifier` を `BindingIdentifier` / `IdentifierReference` / `IdentifierName` に分けること、`AssignmentExpression` の左辺を `AssignmentTarget` にすること、`Literal` を `BooleanLiteral` や `NumericLiteral` などに分けること。どれもRust側の都合というより、仕様に沿って型をきつくした結果に見えます。

面白いのはそのすぐ下の行です。

> For TypeScript types, we follow how field order is defined in [tsc].

ノードの名前と全体の形は typescript-eslint に、TSノードのフィールドの並び順は本家の実装に合わせる。参照先が2つに分かれています。この時点でもう「誰に合わせているのか」が一枚岩ではないことが分かります。

ちなみに、なぜ typescript-eslint に合わせるのかを説明した文書は、自分はoxcのリポジトリの中に見つけられませんでした。既存のESLintルールがパーサーの差し替えだけで動くようにするため、という理由は自然ですが、ここは自分の推測として書いておきます。以下で根拠にするのは、上のコメントと、パーサーの中に書かれたコメント、それと実際の出力の一致だけです。

## 3者はどういう関係か

登場人物を整理します。

```
                     TypeScript のソースコード
                              │
      ┌───────────────────────┼───────────────────────────┐
      ▼                       ▼                           ▼
     tsc               typescript-estree                 oxc
  本家の実装            変換レイヤー                  Rust製の再実装
  パーサー +            tscのASTを受け取って           自前の手書きパーサー
  チェッカー            ESTree形式に組み替える          型の解決はしない
  （型を解決する）       （ESLintのために）             出力の形は estree 側に寄せる
```

左端が tsc、つまりMicrosoftが配っている本家の実装です。名前が3つとも似ていてややこしいので、以下では tsc のことを「本家」、`@typescript-eslint/typescript-estree` のことを「変換レイヤー」と呼びます。

真ん中の変換レイヤーは、自前のパーサーを持っていません。本家を呼んでASTを作らせて、それをESTree形式に変換します。ESLintのエコシステムはESTreeの上に乗っているので、そのままでは食べられないからです。

右端が今回の主役です。oxcは変換レイヤーではなく、自前の再帰下降パーサーで最初からASTを組み立てます。それでいて、出てくる木の形は真ん中の出力に合わせてある。つまり本家と同じ形を作ってから直すのではなく、作る時点で違う形にしている。

その「作る時点で違う」が一番はっきり出るのが、次の1行です。

## 実例1: null型だけ、箱に入っていない

型エイリアスを1つ書きます。

```ts
type A = null;
```

これをoxcのパーサーに `--estree` を付けて流すとJSONが出てきます。ノードの種類だけ抜き出して木にすると、型注釈の部分はこうです。

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

真偽値のほうは `TSLiteralType` という箱に入って、その中にリテラルが入る。JavaScriptの値としては `null` も `true` も同じくリテラルなのに、片方だけ箱がありません。

### パーサーの中では、腕が違う

理由はパーサーのソースにそのまま書いてあります。型の分岐の根っこにいる `parse_non_array_type`（`crates/oxc_parser/src/ts/types.rs:411`）の、いちばん最初の腕です。

```rust
Kind::Any
| Kind::Unknown
| Kind::String
| Kind::Number
// ...
| Kind::Object
// Parse `null` as `TSNullKeyword` instead of null literal to align with typescript eslint.
| Kind::Null => {
```

コメントの意味は「nullリテラルではなく `TSNullKeyword` としてパースする。typescript-eslint に合わせるため」。`Kind::Null` が `string` や `number` と同じ腕に並べられていて、この腕は `parse_keyword_type`（同ファイル `:508`）に進みます。キーワード型のノードを1個作って終わりです。

いっぽう真偽値と文字列はもっと下の腕にいます。

```rust
Kind::Str | Kind::True | Kind::False => self.parse_literal_type(),
```

こちらは `parse_literal_type`（`:1118`）で、リテラルを読んでから `TSLiteralType` で包みます。ひとつのmatch式の中で、nullだけが別のグループに引っ越している。しかもその引っ越しの理由が、ECMAScriptの仕様でもTypeScriptの仕様でもなく、リンター向けパッケージへの追従だと書いてある。

### 本家のほうは4.0で形が変わっていた

では合わせなかった場合、つまり本家の形はどうなのか。手元にバージョン違いを並べて、`ts.createSourceFile` でASTをダンプしてみました。

```
type A = null;

  3.9.10        NullKeyword
  4.0.8         LiteralType > NullKeyword
  5.9.3         LiteralType > NullKeyword
  6.0.3         LiteralType > NullKeyword
```

比較用に同じファイルへ入れた他の型も出しています。`type B = undefined;` はどのバージョンでも `UndefinedKeyword` 単体、`type C = true;` はどれも `LiteralType > TrueKeyword`、`type D = string;` はどれも `StringKeyword`。動いたのはnullだけでした。

3.9 まではnullもキーワードのノード1個で、4.0 から `LiteralType` の中に入るようになった。ここで大事なのは、oxcが作る `TSNullKeyword` は「本家に存在しない独自ノード」ではないということです。昔の本家にはあった形で、今の本家には無い。合わせる相手が本家ではないので、追従しなかっただけです。

### 変換レイヤーが剥がしていた

真ん中の層を見ると、経緯が一本につながります。`@typescript-eslint/typescript-estree` の 8.26.1、`dist/convert.js` の2439行目からです。

```js
case SyntaxKind.LiteralType: {
    if (node.literal.kind === SyntaxKind.NullKeyword) {
        // 4.0 started nesting null types inside a LiteralType node
        // but our AST is designed around the old way of null being a keyword
        return this.createNode(node.literal, {
            type: AST_NODE_TYPES.TSNullKeyword,
        });
    }
    return this.createNode(node, {
        type: AST_NODE_TYPES.TSLiteralType,
        literal: this.convertChild(node.literal),
    });
}
```

自分たちのASTは、nullがキーワードだった昔の形を前提に設計してある。だから包まれたものは剥がす、と。バージョンを名指しで書いてあるので、上のダンプの結果とも合います。

実際に 8.26.1 を動かすと、`type A = null;` は `TSNullKeyword`、`type C = true;` は `TSLiteralType` を返しました。oxcの出力と一致します。

というわけで、順番はこうでした。

1. 3.9 まで、本家ではnull型はキーワードのノードだった
2. 4.0 で `LiteralType` の中に入るようになった
3. 変換レイヤーは既存の利用者のために、それを剥がして昔の形を保った
4. oxcは、剥がした後の形を最初から作るようにした

ついでに、Go版の本家（`tsc/internal/parser/parser.go`）も4.0以降の形を引き継いでいます。

```go
case ast.KindNoSubstitutionTemplateLiteral, ast.KindStringLiteral, ast.KindNumericLiteral,
     ast.KindBigIntLiteral, ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword:
    return p.parseLiteralTypeNode(false /*negative*/)
```

nullがリテラル型の仲間に並んでいます。移植のときも、ここは変えなかったわけです。

## 実例2: 後置の `!` とオプショナルチェーン

さっきの話は、ノード1個の形をどう決めるかでした。もう少し木らしい例として、非nullアサーションの後置 `!` と `?.` の組み合わせを見ます。ここもパースの手順ではなく、出来上がった木の形だけの話です。

デモは `demos/oxc-step5b` に置いてあります。11通りの入力を、3者に食わせて形を並べたものです。表にすると縦に長いので、木の略記で並べます。`Chain` は `ChainExpression`、`NonNull` は `TSNonNullExpression`、`Member?` と `Call?` は optional なメンバーアクセスと呼び出し、`[chain]` は本家のノードに `NodeFlags.OptionalChain` が立っていることを表します。

```
a!
  oxc / estree   NonNull(a)
  本家           NonNull(a)

a?.b!
  oxc / estree   Chain(NonNull(Member?(a, b)))
  本家           NonNull(Prop?[chain](a, b))

a?.b!.c
  oxc / estree   Chain(Member(NonNull(Member?(a, b)), c))
  本家           Prop[chain](NonNull[chain](Prop?[chain](a, b)), c)

a?.b.c!
  oxc / estree   Chain(NonNull(Member(Member?(a, b), c)))
  本家           NonNull(Prop[chain](Prop?[chain](a, b), c))

a!.b?.c
  oxc / estree   Chain(Member?(Member(NonNull(a), b), c))
  本家           Prop?[chain](Prop(NonNull(a), b), c)

a?.[0]!
  oxc / estree   Chain(NonNull(Member?(a, [0])))
  本家           NonNull(Elem?[chain](a, 0))

a?.()!
  oxc / estree   Chain(NonNull(Call?(a)))
  本家           NonNull(Call?[chain](a))

a?.b!(x)
  oxc / estree   Chain(Call(NonNull(Member?(a, b))))
  本家           Call[chain](NonNull[chain](Prop?[chain](a, b)))
```

読み取れることが2つあります。

ひとつめ。左の2者は、ここに並べた8つすべてで木が一致しました。デモにはあと3つあって、改行を挟んだ `a` と `!b` は両方とも「2つの文」として同じ扱いになり、拡張子を `.js` にしたものは変換レイヤー側を走らせていないので比較対象外。残る1つが括弧つきの `(a?.b)!.c` で、ここだけ見た目が割れます。

とはいえ、これは差というより設定の話でした。oxcのパーサーには `preserve_parens` というオプションがあって、ドキュメントコメント自身が非標準だと断ったうえで既定値をオンにしています。オンのあいだは括弧が `ParenthesizedExpression` というノードとして残る。ESTreeの仕様に括弧のノードは無いので、切れば消えます。つまり実質は全一致です。

ふたつめ。本家だけ、作りがまるごと違います。そもそも `ChainExpression` に当たるノードを持っていません。手元の 5.7.3 で `SyntaxKind` の中からChainを含む名前を探すと0件で、代わりに `NodeFlags.OptionalChain`（値は64）というビットがあり、チェーンに属するノードそれぞれに立ちます。

面白いのは `!` の位置でフラグの付き方が変わるところです。`a?.b!.c` をダンプするとこうなりました。

```
PropertyAccessExpression [chain]
  NonNullExpression [chain]
    PropertyAccessExpression [chain]
      Identifier
      QuestionDotToken
      Identifier
  Identifier
```

3つとも立っています。ところが `a?.b!` のほうは、外側の `NonNullExpression` にフラグが立ちません。`!` がチェーンの途中ならチェーンの一部、末尾ならチェーンの外側、という扱いです。左の2者はそこを区別せず、`?.` を含む式の全体を `Chain` で包んで、`NonNull` はいつもその内側に入れます。

### 橋渡しをしている1行

oxc側で、この形を作っているコードは3か所に分かれています。

まず `!` を食べる腕。`parse_member_expression_rest`（`crates/oxc_parser/src/js/expression.rs:859`）の中、`:915` からの3行です。

```rust
Kind::Bang if self.is_ts && !self.cur_token().is_on_new_line() => {
    self.bump_any();
    lhs = Expression::new_ts_non_null_expression(self.end_span(lhs_start), lhs, self);
}
```

次に、式全体を読み終えたところで包む判断。`parse_lhs_expression_or_higher_impl`（同ファイル `:752`）が `in_optional_chain` という旗を持って回していて、立っていれば `map_to_chain_expression` に渡します。

そして、その `map_to_chain_expression`（`:801`）の中身が今回の肝です。腕が4本あるだけの関数で、最初の2本は中身を省いて載せます。

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

メンバーアクセスと呼び出しが並んでいるのは、ECMAScriptのオプショナルチェーンとして当然です。3つめの腕だけがTypeScript固有で、しかもこれが無いと `a?.b!` の `NonNull` が `Chain` の外に出てしまいます。本家と同じ形になってしまう、と言ってもいい。

後置の記号を読む3行より、この1行のほうが「誰に合わせているのか」をよく語っている気がします。パースそのものには要らない腕だからです。

## ASTは1つで、JSとTSが混ざっている

ここまで `TSNullKeyword` や `TSLiteralType` のようなTS専用のノードを見てきましたが、oxcにはTS用の木とJS用の木が別々にあるわけではありません。1本の木に両方のノードが混ざって生えています。

分かりやすいのがテンプレートリテラル型です。

```ts
type F = `abc`;
```

埋め込みが無いので、これはただの文字列リテラル型です。oxcの出力はこうなります。

```
TSTypeAliasDeclaration
  typeAnnotation: TSLiteralType
    literal: TemplateLiteral
      quasis: [ TemplateElement "abc" ]
      expressions: []
```

型のノードの中に、式のノードが直接入っています。しかもこの `TemplateLiteral` は、JavaScriptのコードに出てくるテンプレートリテラルと同じ型です。

型定義のほうを見ても同じです。`TSLiteralType`（`crates/oxc_ast/src/ast/ts.rs:215`）の `literal` フィールドの型は `TSLiteral`（同 `:226`）という列挙で、その選択肢に `TemplateLiteral` がいます。定義されている場所は `ast/js.rs` の419行目、つまりJavaScript側のファイルです。逆向きもあって、変数宣言などが持つ `type_annotation` はTS側のノードを指します。ファイルは分かれていても、型としては相互に乗り入れている。

ここが、実例1の見え方を変えます。oxcには「本家のASTをESTree形式に直す変換レイヤー」が存在しません。`--estree` という出力は、この1本の木をそのまま書き出したものです。だから形を合わせたければ、後から直すのではなく、作るときに合わせるしかない。nullの判定がパーサーのmatch式の腕に書いてあるのは、そこしか書く場所が無いからでもあります。

念のため他の2者も確認しました。変換レイヤーの 8.26.1 は同じく `TSLiteralType` の中に `TemplateLiteral` を入れます。本家は `LiteralType` の中に `NoSubstitutionTemplateLiteral` が入る形で、こちらは箱と中身の名前が違うだけです。

## まとめ

- oxcが出すASTの名前と形は typescript-estree（typescript-eslint の ast-spec）に寄せてある。ただしTSノードのフィールドの並び順は本家に倣う、と `oxc_ast` のドキュメントコメントに書いてある
- null型の木は本家だけ違う。4.0から `LiteralType` で包むようになり、変換レイヤーはそれを剥がして昔の形を保ち、oxcは剥がした後の形を最初から作る
- 後置の `!` と `?.` の組み合わせも、括弧のノードを残すかどうかを除けば、oxcと変換レイヤーは一致した。本家は `ChainExpression` を持たず、ノードにフラグを立てて表す
- oxcのASTは1本で、TSのノードの中にJSのノードが直接入る。変換レイヤーが無いぶん、互換性への配慮がパーサーのmatch式の腕として埋まっている

「本家と同じものをRustで速く作り直した」という話ではなく、「合わせる相手を選んだ」という話でした。どちらに合わせるかで木の形が変わるので、oxcの出力を読んでいて本家と違うところに出会ったら、まず変換レイヤー側を見ると答えがあることが多いです。

今回参照した実行結果は `demos/oxc-step5b` に置いてあります。読んだoxcのリビジョンは `1aa5ec11ce`、変換レイヤーは 8.26.1、本家は 3.9.10 / 4.0.8 / 5.7.3 / 5.9.3 / 6.0.3 と、Go版の開発版です。

次回は、曖昧性と戦うための道具のカタログです。
