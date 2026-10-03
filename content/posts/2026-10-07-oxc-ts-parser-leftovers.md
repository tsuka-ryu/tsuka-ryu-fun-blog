---
title: oxcのTypeScriptパーサーを読む 第8回 積み残した型の難所たち
description: mapped type、tuple type、template literal type、型述語、そしてアロー関数の曖昧性を、oxc のパーサーがどう読み分けているのかを1つずつ見ます。アロー関数では、投機パースとカバー文法の2つのやり方を並べました。
date: 2026-10-07
tags: ["コンパイラ", "パーサー", "oxc", "TypeScript", "oxc-ts-parser"]
draft: true
---

この記事では、TypeScript の型の文法のうち扱いが特殊な4つ (mapped type、tuple type、template literal type、型述語) と、アロー関数の曖昧性を、oxc のパーサーがどう読み分けているのかを1つずつ見ていきます。

## 今回読むファイル

読んだのは oxc の rev `1aa5ec11ce` です。行番号はすべてこのリビジョンのもので、ズレたときに探せるように関数名とセットで書きます。今回おもに開くのはこのあたりです。

```text
crates/oxc_parser/src/ts/types.rs        1,690行   型の4つの話題はすべてここ
crates/oxc_parser/src/js/arrow.rs          410行   アロー関数の判定と投機
crates/oxc_parser/src/cursor.rs            638行   lookahead / checkpoint / rewind、テンプレートの読み直し
crates/oxc_parser/src/js/object.rs         247行   オブジェクトリテラルの中の { a = 1 }
crates/oxc_parser/src/js/grammar.rs        245行   分割代入のためのカバー文法
crates/oxc_parser/src/lib.rs             1,340行   パースの最後に出すエラー
```

アロー関数の節では、比較のために acorn (8.18.0) と tsc (6.0.3) も出てきます。この2つの中身と実行結果は、Claude に確認してもらったものです。

## 下準備: oxc の AST を手元で出す

この記事に出てくる oxc の出力は、次の手順で手元でも同じものが出せます。Rust のツールチェーンが入っていれば動きます。

まず oxc を記事と同じリビジョンで取ってきます。履歴まで丸ごと clone すると時間がかかるので、このコミットだけを `--depth 1` で浅く取ります (コミットを指定して取るので、SHA は省略せずに書きます)。

```bash
git init oxc
git -C oxc fetch --depth 1 https://github.com/oxc-project/oxc.git 1aa5ec11ce0dcbb0da7799e777c2492211908fbb
git -C oxc checkout FETCH_HEAD
```

次に、入力を1つずつファイルに書いて、`parser` サンプルに `--estree` を付けて流します。

```bash
cd oxc
for src in 'type M = { [K in T]: U };' 'type I = { [k: string]: U };' 'type A = [...string[], ...number[]];' 'type B<T extends unknown[]> = [...string[], ...T];' 'type C = [...string[], ...readonly number[]];' 'type L = `a${string}b${number}c`;' 'declare function f(x: unknown): x is string;' 'type is = number; declare function g(x: unknown): [is];' 'declare function h(x: unknown): asserts x;' '({ a = 1 }) => a;' '({ a = 1 });' '({ a = 1 } = obj);'; do
  printf '%s\n' "$src" > /tmp/x.ts
  echo "===== $src"
  cargo run -q -p oxc_parser --example parser -- /tmp/x.ts --estree
done
```

AST の JSON に続いて、エラーが無ければ `Parsed Successfully.`、あればエラーの表示と `Parsed with Errors.` が出ます。本文に載せる木は、この出力から必要な部分だけを切り出したもので、どこを切ったかはそれぞれの場所に書きます。

## 事前知識: 先読み、投機パース、カバー文法

本題に入る前に、パーサーが曖昧な場所を読み分けるための道具を説明しておきます。曖昧な場所とは、途中まで読んだだけでは、どの文法規則で読めばいいのか決められない場所のことです。

### lookahead と peek_token

1つ目は、先を覗いて判断材料だけを持ち帰る先読みです。oxc では `cursor.rs` の `lookahead` (`cursor.rs:340`) がこれにあたります。

```rust
pub(crate) fn lookahead<U>(&mut self, predicate: impl Fn(&mut ParserImpl<'a, C>) -> U) -> U {
    let checkpoint = self.checkpoint();
    let answer = predicate(self);
    self.rewind(checkpoint);
    answer
}
```

関数 `checkpoint` は、読み位置やエラーの件数などを1つの値にまとめて保存します。`rewind` は、それを受け取って全部を元に戻します。`lookahead` はこの2つで渡された関数を挟んでいるので、関数の中でトークンをいくつ食べても、終わったら読み位置は元に戻ります。

覗くのが次の1トークンだけでいいときは、もっと軽い `self.lexer.peek_token()` も使われます。こちらはパーサーの状態には触らず、レキサーだけを1トークン進めて戻します。

### 投機パース

2つ目は、checkpoint を取ってから、ひとまず片方の解釈で本当に読んでしまうやり方です。うまく読めればその結果を採用し、だめなら rewind して別の解釈で読み直します。この記事では、これを投機パースと呼びます。

先読みとの違いは、成功したときに巻き戻さないことです。読み直しが起きるのは失敗したときだけで、そのときは同じトークン列を2回読むことになります。

### カバー文法

3つ目は、ECMAScript の仕様が使っているやり方です。曖昧な場所を、両方の解釈を含む緩い文法 (カバー文法) でいったん読んでおき、どちらだったかが分かった時点で、読んだ結果をもう一方の文法で解釈し直します。

代表例が、アロー関数の引数と括弧で囲んだ式です。仕様の [13.2 Primary Expression](https://tc39.es/ecma262/2025/multipage/ecmascript-language-expressions.html#prod-CoverParenthesizedExpressionAndArrowParameterList) には `CoverParenthesizedExpressionAndArrowParameterList` という規則があり、`(a, b)` のような括弧の並びは、まずこの規則で読まれます。[15.3 Arrow Function Definitions](https://tc39.es/ecma262/2025/multipage/ecmascript-language-functions-and-classes.html#sec-arrow-function-definitions) には、`=>` が続いてアロー関数の引数だと分かった場合は、それを `ArrowFormalParameters` の文法で解釈し直す (refine する)、と書かれています。

投機パースとの違いは、トークン列を読み直さないことです。そのかわり、読み終えた木を別の種類の木に作り直すコードが必要になります。

## mapped type: `{ [K in` と `{ [k:` は4トークン目で分かれる

mapped type は、`{ [K in T]: U }` のように、キーの集合を回して新しいオブジェクト型を作る型です。

```ts
type M = { [K in T]: U };
```

oxc の出力から、型エイリアスの右辺 (`typeAnnotation`) の部分だけを切り出すとこうなります。

```json
{
  "type": "TSMappedType",
  "key": {
    "type": "Identifier",
    "decorators": [],
    "name": "K",
    "optional": false,
    "typeAnnotation": null,
    "start": 12,
    "end": 13
  },
  "constraint": {
    "type": "TSTypeReference",
    "typeName": {
      "type": "Identifier",
      "decorators": [],
      "name": "T",
      "optional": false,
      "typeAnnotation": null,
      "start": 17,
      "end": 18
    },
    "typeArguments": null,
    "start": 17,
    "end": 18
  },
  "nameType": null,
  "typeAnnotation": {
    "type": "TSTypeReference",
    "typeName": {
      "type": "Identifier",
      "decorators": [],
      "name": "U",
      "optional": false,
      "typeAnnotation": null,
      "start": 21,
      "end": 22
    },
    "typeArguments": null,
    "start": 21,
    "end": 22
  },
  "optional": false,
  "readonly": null,
  "start": 9,
  "end": 24
}
```

ところが、字面のよく似た `type I = { [k: string]: U };` を流すと、右辺は `TSTypeLiteral` になり、その `members` に `TSIndexSignature` (インデックスシグネチャ) が1つ入ります。どちらも `{` `[` 識別子 と始まるのに、違う種類のノードになります。

### 判定は lookahead で4トークンを見る

分かれ目は、型の先頭のトークンで分配する `parse_non_array_type` の `{` の腕 (`ts/types.rs:482`) です。

```rust
Kind::LCurly => {
    if self.lookahead(Self::is_start_of_mapped_type) {
        self.parse_mapped_type()
    } else {
        self.parse_type_literal()
    }
}
```

ここで `lookahead` に渡している `is_start_of_mapped_type` (`ts/types.rs:606`) はこうです。

```rust
fn is_start_of_mapped_type(&mut self) -> bool {
    self.bump_any();
    let kind = self.cur_kind();
    if kind == Kind::Plus || kind == Kind::Minus {
        self.bump_any();
        return self.at(Kind::Readonly);
    }

    self.bump(Kind::Readonly);

    if !self.eat(Kind::LBrack) && self.cur_kind().is_identifier_name() {
        return false;
    }

    self.bump_any();
    self.at(Kind::In)
}
```

上から順に、`{` を食べる、`+readonly` か `-readonly` ならその場で mapped type と決める、`readonly` があれば読み飛ばす、`[` が無くて名前が来たら普通のプロパティなので偽、と進みます。最後に `[` の次のトークン (キーの名前) を食べて、その次が `in` かどうかを見ます。

つまり、`{ [K in T]: U }` と `{ [k: string]: U }` は、`{` `[` 識別子 の3トークンまで同じ形で、4トークン目が `in` か `:` かで初めて分かれます。逆に言えば、何トークン先を見れば決まるかが最初から分かっているので、投機パースは要らず、固定長の先読みで済んでいます。`lookahead` の中で食べたトークンは判定のあとで全部巻き戻るので、本体の `parse_mapped_type` (`ts/types.rs:640`) は、もう一度 `{` から素直に読み直します。

## tuple type: rest 要素の重複は、書かれた形で判定する

tuple type の rest 要素 (`...string[]` のように `...` を付けた要素) は、1つのタプルに1個までしか書けません。

```ts
type A = [...string[], ...number[]];
```

oxc のパーサーに流すと、AST は最後まで作られたうえで、エラーが1件出ます。

```text
  x TS(1265): A rest element cannot follow another rest element.
   ,----
 1 | type A = [...string[], ...number[]];
   :           ^^^^^|^^^^^  ^^^^^|^^^^^
   :                |            `-- Second rest element here
   :                `-- First seen here
   `----

Parsed with Errors.
```

### パーサーが見ているのは、`...` の後ろの見た目

この検査は `parse_tuple_type` (`ts/types.rs:967`) にあります。要素を1つ読むたびに呼ばれるクロージャの前半です。後半には optional 要素 (`a?: T`) の並び順の検査が続きますが、ここでは省きます。

```rust
let tuple = me.parse_tuple_element();
// check for array type, because unknown types can be destructed, example of valid code:
// type C<T extends unknown[]> = [...string[], ...T];
// example of invalid code:
// type C<T extends unknown[]> = [...string[], ...T[]];
if let TSTupleElement::TSRestType(rest) = &tuple
    && let Some(rest_type) = (match &rest.type_annotation {
        TSType::TSNamedTupleMember(named) => named.element_type.as_ts_type(),
        ty => Some(ty),
    })
    && match rest_type {
        TSType::TSArrayType(_) => true,
        // Check for `Array<...>` type
        TSType::TSTypeReference(ts_ref) => match &ts_ref.type_name {
            TSTypeName::IdentifierReference(id_ref) => id_ref.name == "Array",
            _ => false,
        },
        _ => false,
    }
{
    if let Some(seen_span) = seen_rest_span {
        me.error(diagnostics::rest_element_cannot_follow_another_rest_element(
            seen_span,
            tuple.span(),
        ));
    }
    seen_rest_span = Some(tuple.span());
}
```

rest 要素として数えるのは、`...` の後ろが `X[]` という配列型の構文か、`Array` という名前の型参照のときだけです。2個目が見つかると、1個目の位置 (`seen_rest_span`) と今の要素の位置の2か所にラベルを付けてエラーにします。

コメントにあるとおり、`...T` のように型パラメータが来た場合は数えません。`T` が何に展開されるかは、この時点では分からないからです。実際、`type B<T extends unknown[]> = [...string[], ...T];` はエラーなしで通ります。

裏を返すと、この判定は型を解決せず、書かれた形だけを見ています。そのため、中身は配列でも見た目が `X[]` でないものは数えません。

```text
type C = [...string[], ...readonly number[]];
```

この入力の `readonly number[]` は、`readonly` という前置の型演算子のノード (`TSTypeOperator`) が配列型を包んだ形なので、上の `match` の `_ => false` に落ちます。oxc のパーサーはこれを `Parsed Successfully.` で通しました。Claude に oxc の `crates` の中を探してもらいましたが、TS1265 を出すコードはパーサーの `diagnostics.rs` 以外に見つけられませんでした。

### tsc ではチェッカーの検査

ここは Claude に tsc 6.0.3 で確認してもらった内容です。

tsc では、同じ TS1265 をパーサーではなく型チェッカーの `checkTupleType` が出しています。`...` の後ろの型を `getTypeFromTypeNode` で解決してから、配列型か、rest 要素を含むタプル型のときだけ数える作りです。そのため、上の `type C` も、`type S = number[];` というエイリアスを挟んだ `[...string[], ...S]` も、tsc ではエラーになりました。型パラメータの `...T` が通るのは oxc と同じでした。

型を解決しないパーサーが、本来は型の解決が要る検査を、構文の形で近似している、ということになります。

## template literal type: `}` をテンプレートの続きとして読み直す

template literal type は、`${}` の中に型を埋め込むテンプレート文字列の型です。

```ts
type L = `a${string}b${number}c`;
```

oxc の出力から、右辺の部分だけを切り出したものがこちらです。

```json
{
  "type": "TSTemplateLiteralType",
  "quasis": [
    {
      "type": "TemplateElement",
      "value": {
        "raw": "a",
        "cooked": "a"
      },
      "tail": false,
      "start": 9,
      "end": 13
    },
    {
      "type": "TemplateElement",
      "value": {
        "raw": "b",
        "cooked": "b"
      },
      "tail": false,
      "start": 19,
      "end": 23
    },
    {
      "type": "TemplateElement",
      "value": {
        "raw": "c",
        "cooked": "c"
      },
      "tail": true,
      "start": 29,
      "end": 32
    }
  ],
  "types": [
    {
      "type": "TSStringKeyword",
      "start": 13,
      "end": 19
    },
    {
      "type": "TSNumberKeyword",
      "start": 23,
      "end": 29
    }
  ],
  "start": 9,
  "end": 32
}
```

文字列の部分 (`quasis`) と埋め込んだ型 (`types`) が別々の配列に入っています。

注目したいのは `quasis` の位置です。2つ目の `"b"` は19から23で、ソースでいうと `}b${` の4文字にあたります。3つ目の `"c"` も29から32の `` }c` `` です。`}` が、型の側ではなく文字列の部分のトークンに含まれています。

### `}` は最初、ただの閉じ波括弧として切られる

テンプレートは、レキサーから見ると4種類のトークンに分かれます。`${}` が無いもの全体 (`NoSubstitutionTemplate`)、先頭から `${` まで (`TemplateHead`)、`}` から次の `${` まで (`TemplateMiddle`)、最後の `}` から閉じのバッククォートまで (`TemplateTail`) です。

問題は `}` です。レキサーは文脈を知らないので、`${string}` の `string` を読み終えたところで `}` を見ると、ブロックやオブジェクトの閉じと同じ `}` のトークンとして切ってしまいます。仕様でも、[12 ECMAScript Language: Lexical Grammar](https://tc39.es/ecma262/2025/multipage/ecmascript-language-lexical-grammar.html#sec-ecmascript-language-lexical-grammar) の冒頭で、`TemplateMiddle` や `TemplateTail` が来られるかどうかは構文の文脈が決める、として、字句の文法に複数の開始記号 (goal symbol) を用意しています。

そこで、文脈を知っているパーサーの側がレキサーに読み直しを頼みます。型を読むループ `parse_template_type` (`ts/types.rs:762`) はこうなっています。

```rust
fn parse_template_type(&mut self, tagged: bool) -> TSType<'a> {
    let start = self.cur_start();
    let mut types = ArenaVec::new_in(self);
    let mut quasis = ArenaVec::new_in(self);
    match self.cur_kind() {
        Kind::NoSubstitutionTemplate => {
            quasis.push(self.parse_template_element(tagged));
        }
        Kind::TemplateHead => {
            quasis.push(self.parse_template_element(tagged));
            types.push(self.parse_ts_type());
            self.re_lex_template_substitution_tail();
            while self.fatal_error.is_none() {
                match self.cur_kind() {
                    Kind::TemplateTail => {
                        quasis.push(self.parse_template_element(tagged));
                        break;
                    }
                    Kind::TemplateMiddle => {
                        quasis.push(self.parse_template_element(tagged));
                    }
                    Kind::Eof => {
                        self.expect(Kind::TemplateTail);
                        break;
                    }
                    _ => {
                        types.push(self.parse_ts_type());
                        self.re_lex_template_substitution_tail();
                    }
                }
            }
        }
        _ => unreachable!("parse_template_literal"),
    }

    TSType::new_ts_template_literal_type(self.end_span(start), quasis, types, self)
}
```

型を `parse_ts_type` で1つ読むたびに、すぐ `re_lex_template_substitution_tail` (`cursor.rs:242`) を呼んでいます。

```rust
/// Tell lexer to read a template substitution tail
pub(crate) fn re_lex_template_substitution_tail(&mut self) {
    if self.fatal_error.is_some() {
        return;
    }
    if self.at(Kind::RCurly) {
        self.token = self.lexer.next_template_substitution_tail();
    }
}
```

現在のトークンが `}` なら、レキサーの `next_template_substitution_tail` に、その `}` からテンプレートの続きとして読み直させます。読み直した結果が `TemplateMiddle` ならループが `quasis` に足して次の型へ、`TemplateTail` なら足して終わりです。`quasis` の `"b"` が `}` の位置から始まっていたのは、この読み直しで `}b${` が1つのトークンになったからです。

この呼び出しは、式のテンプレートリテラルを読む `parse_template_literal` (`js/expression.rs:555`) にも同じ形で2か所あります。`${}` の中身が式か型かが違うだけで、`}` の扱いは式と型で共通です。

## 型述語: `x is` は1トークン覗くだけで決める

型述語は、戻り値の型の位置に書く `x is string` のような構文です。この関数が `true` を返したら引数 `x` は `string` だ、と型チェッカーに伝えます。

```ts
declare function f(x: unknown): x is string;
```

oxc の出力から、戻り値の型 (`returnType`) の部分だけを切り出したものがこちらです。

```json
{
  "type": "TSTypeAnnotation",
  "typeAnnotation": {
    "type": "TSTypePredicate",
    "parameterName": {
      "type": "Identifier",
      "decorators": [],
      "name": "x",
      "optional": false,
      "typeAnnotation": null,
      "start": 32,
      "end": 33
    },
    "asserts": false,
    "typeAnnotation": {
      "type": "TSTypeAnnotation",
      "typeAnnotation": {
        "type": "TSStringKeyword",
        "start": 37,
        "end": 43
      },
      "start": 37,
      "end": 43
    },
    "start": 32,
    "end": 43
  },
  "start": 30,
  "end": 43
}
```

アサーション関数の `declare function h(x: unknown): asserts x;` も、同じ `TSTypePredicate` のノードになります。違いは `"asserts": true` で、`is` が無いので型の側の `"typeAnnotation"` は `null` でした。

### 名前の次が `is` かどうかを覗く

戻り値の型を読むときは、まず `parse_type_or_type_predicate` (`ts/types.rs:1334`) を通ります。

```rust
fn parse_type_or_type_predicate(&mut self) -> TSType<'a> {
    let start = self.cur_start();
    let type_predicate_variable = self.parse_type_predicate_prefix();

    let ty = self.parse_ts_type();
    if let Some(parameter_name) = type_predicate_variable {
        let type_annotation = Some(TSTypeAnnotation::boxed(ty.span(), ty, self));
        return TSType::new_ts_type_predicate(
            self.end_span(start),
            parameter_name,
            false,
            type_annotation,
            self,
        );
    }
    ty
}
```

先頭の `x is` の部分を `parse_type_predicate_prefix` (`ts/types.rs:1355`) で読めたら、残りを型として読んで `TSTypePredicate` で包みます。読めなければ普通の型として読むだけです。

```rust
/// Parse `<ident> is` or `this is` prefix of a type predicate.
/// Returns `None` (without consuming anything) when the current token is
/// not followed by `is` on the same line.
fn parse_type_predicate_prefix(&mut self) -> Option<TSTypePredicateName<'a>> {
    if !self.cur_kind().is_identifier_name() {
        return None;
    }
    let next = self.lexer.peek_token();
    if next.kind() != Kind::Is || next.is_on_new_line() {
        return None;
    }
    let parameter_name = if self.at(Kind::This) {
        TSTypePredicateName::This(self.parse_this_type_node())
    } else {
        let ident_name = self.parse_identifier_name();
        TSTypePredicateName::Identifier(self.alloc(ident_name))
    };
    self.bump_any(); // bump `is`
    Some(parameter_name)
}
```

判定は3段です。今のトークンが名前になれるか、次のトークンが `is` か、その `is` が同じ行にあるか。次のトークンは `peek_token` で覗くだけなので、述語でないと分かったときは何も消費せずに `None` を返せます。

1段目が効く例がこれです。

```ts
type is = number;
declare function g(x: unknown): [is];
```

ここでの `is` はソフトキーワード (文脈によってだけキーワードになる単語) なので、型の名前にも使えます。`[is]` は、今のトークンが `[` で次が `is` なので、2段目だけを見ると `x is` の形に見えます。1段目で `[` が名前になれないと分かるので、普通の型として読まれます。oxc の出力の `returnType` はこうでした。

```json
{
  "type": "TSTypeAnnotation",
  "typeAnnotation": {
    "type": "TSTupleType",
    "elementTypes": [
      {
        "type": "TSTypeReference",
        "typeName": {
          "type": "Identifier",
          "decorators": [],
          "name": "is",
          "optional": false,
          "typeAnnotation": null,
          "start": 51,
          "end": 53
        },
        "typeArguments": null,
        "start": 51,
        "end": 53
      }
    ],
    "start": 50,
    "end": 54
  },
  "start": 48,
  "end": 54
}
```

### もとは投機パースだった

この関数は、もとから覗くだけの形だったわけではありません。Claude に oxc の git の履歴を調べてもらうと、2026年4月のコミット (PR [#21532](https://github.com/oxc-project/oxc/pull/21532)、`perf(parser): reduce try_parse usage in favour of lookahead`) で今の形になっていました。それまでの `parse_type_or_type_predicate` は、名前を読んでみて、次が `is` でなければ失敗にする関数を、投機パースの `try_parse` で包んで呼んでいました。

ここは Claude に確認してもらった内容ですが、tsc 6.0.3 の `parseTypeOrTypePredicate` も `tryParse(parseTypePredicatePrefix)` と投機の形で、Go 版の tsc (typescript-go の `tsc/internal/parser/parser.go:3456`) も `p.mark()` で状態を保存してから名前を読み、`is` が来なければ `p.rewind(state)` で戻す形でした。`x is` の `x` と `is` の間には何も入らないので、1トークン覗けば足ります。oxc は、移植したあとで、この投機を先読みに置き換えたことになります。

## アロー関数: 投機パースとカバー文法

最後は型ではなく式の話です。アロー関数は、TypeScript を持ち出すまでもなく、JavaScript だけで曖昧です。

```ts
(a, b);
(a, b) => a;
```

1行目は括弧で囲んだカンマ式、2行目はアロー関数です。`(a, b)` まで読んだ時点ではどちらか決まらず、`=>` が来るかどうかで初めて分かります。しかも括弧の中身はいくらでも長くできるので、固定長の先読みでは決められません。

### まず Tristate で見当を付ける

oxc は、`(` に着いたところで、まず `is_parenthesized_arrow_function_expression` (`js/arrow.rs:58`) で見当を付けます。返り値の `Tristate` (`js/mod.rs:17`) は、真と偽に「まだわからない」を足した3値です。

```rust
pub enum Tristate {
    True,
    False,
    Maybe,
}
```

判定の本体の `is_parenthesized_arrow_function_expression_worker` (`js/arrow.rs:77`) は、`(` の次 (`second`) とその次 (`third`) のトークンを見て、この3値のどれかを返します。`(` の次が識別子だった場合の、最後の `match` がこれです。

```rust
match third {
    // If we have something like "(a:", then we must have a
    // type-annotated parameter in an arrow function expression.
    Kind::Colon => Tristate::True,
    // If we have "(a?:" or "(a?," or "(a?=" or "(a?)" then it is definitely a lambda.
    Kind::Question => {
        self.bump_any();
        let fourth = self.cur_kind();
        if matches!(
            fourth,
            Kind::Colon | Kind::Comma | Kind::Eq | Kind::RParen
        ) {
            return Tristate::True;
        }
        Tristate::False
    }
    // If we have "(a," or "(a=" or "(a)" this *could* be an arrow function
    Kind::Comma | Kind::Eq | Kind::RParen => Tristate::Maybe,
    // It is definitely not an arrow function
    _ => Tristate::False,
}
```

JavaScript に `(a:` で始まる式は無いので、`:` が来たら型注釈付きの引数と分かり、その場で `True` です。`(a?:` や `(a?,` も同じで、TypeScript にしかない省略可能な引数の書き方です。一方 `(a,` `(a=` `(a)` は、括弧の式としても引数としても成り立つので `Maybe` になります。ほかに、`(` の次が `[` か `{` の場合 (`([x])` や `({ x })`) も、配列やオブジェクトのリテラルか分割代入の引数か決められないので、`Maybe` を返す腕があります。

TypeScript が構文を足したことで、かえって先読みだけで決まる形が増えています。型注釈の付いた引数は、それだけでアロー関数と確定します。`(` の次が識別子の場合に投機パースに回るのは、`(a,` `(a=` `(a)` の3つだけです。

### Maybe のときは引数として読んでみる

判定が `Maybe` だと、`parse_possible_parenthesized_arrow_function_expression` (`js/arrow.rs:356`) で投機パースに入ります。前半はこうです。後半は、アロー関数の本体を読んだあと、条件演算子の `? :` の中で戻り値の型の `:` と取り違えていないかを確かめる処理で、ここでは省きます。

```rust
fn parse_possible_parenthesized_arrow_function_expression(
    &mut self,
    allow_return_type_in_arrow_function: bool,
) -> Option<Expression<'a>> {
    let pos = self.cur_token().start();
    if self.state.not_parenthesized_arrow.contains(&pos) {
        return None;
    }

    let checkpoint = self.checkpoint_with_error_recovery();

    let head = self.parse_parenthesized_arrow_function_head();
    if self.has_fatal_error() {
        self.state.not_parenthesized_arrow.insert(pos);
        self.rewind(checkpoint);
        return None;
    }
```

checkpoint を取り、`parse_parenthesized_arrow_function_head` で括弧の中をアロー関数の引数として読みます。この関数は引数のリストのあとで `self.expect(Kind::Arrow)` を呼ぶので、`=>` が来なければ、そこで致命的なエラーになります。そうなったら rewind して `None` を返し、呼び出し元が今度は式として読み直します。`(a, b);` の `a` と `b` は、引数として1回、式として1回の、合わせて2回読まれることになります。

失敗したときに位置を入れている `not_parenthesized_arrow` は、この位置はアロー関数ではなかった、と覚えておくための集合です。同じ位置でもう一度ここに来たときに、投機をせずにすぐ諦められます。

### acorn はカバー文法で読む

ここは Claude に acorn 8.18.0 のソースを読んで、動かしてもらった内容です。

JavaScript のパーサーの acorn は、同じ場面を仕様どおりのカバー文法で扱っています。`parseParenAndDistinguishExpression` ([`acorn/src/expression.js:620`](https://github.com/acornjs/acorn/blob/d788421b242ddccb28040f1431438ee5cf474208/acorn/src/expression.js#L620-L685)) は、`(` を食べたら、括弧の中身をまず式として読み、`exprList` に並べます。閉じ括弧のあとの部分を抜き出すとこうです (`expression.js:653` から)。

```text
    if (canBeArrow && this.shouldParseArrow(exprList) && this.eat(tt.arrow)) {
      this.checkPatternErrors(refDestructuringErrors, false)
      this.checkYieldAwaitInDefaultParams()
      this.yieldPos = oldYieldPos
      this.awaitPos = oldAwaitPos
      return this.parseParenArrowList(startPos, startLoc, exprList, forInit)
    }

    if (!exprList.length || lastIsComma) this.unexpected(this.lastTokStart)
    if (spreadStart) this.unexpected(spreadStart)
    this.checkExpressionErrors(refDestructuringErrors, true)
```

閉じ括弧のあとに `=>` を食べられたら、式として読んだ `exprList` を `parseParenArrowList` に渡します。その先の `toAssignable` (`acorn/src/lval.js:11`) が、たとえば `ObjectExpression` のノードに `node.type = "ObjectPattern"` と書き込んで、パターンのノードに作り変えます。トークン列を読み直すのではなく、できあがった木の種類を書き換えて引数にするわけです。

その代わり、どちらの解釈なら許されるかの検査を後回しにする仕組みが要ります。それが `refDestructuringErrors` です。たとえば `{ a = 1 }` は、引数 (分割代入のパターン) としては正しいのに、オブジェクトリテラルとしては書けません。acorn は、式として読んでいる途中でこの形を見つけると、エラーにせずに位置だけを `refDestructuringErrors.shorthandAssign` に記録しておきます。`=>` が来ればそのまま引数として通し、来なければ上の `checkExpressionErrors` がエラーにします。実際、`({ a = 1 }) => a;` は通り、`({ a = 1 });` は `Shorthand property assignments are valid only in destructuring patterns` で失敗しました。

仕様の側でも、この形は [13.2.5.1](https://tc39.es/ecma262/2025/multipage/ecmascript-language-expressions.html#sec-object-initializer-static-semantics-early-errors) で、`CoverInitializedName` という、オブジェクトリテラルを分割代入のカバー文法として使うためだけの規則として定義されています。実際のオブジェクトリテラルに現れたら構文エラー、という扱いです。

### oxc の中にもカバー文法がある

では oxc はカバー文法を使わないのかというと、そうではありません。同じ `({ a = 1 });` を流すと、こうなります。

```text
  x Invalid assignment in object literal
   ,----
 1 | ({ a = 1 });
   :    ^^^^^
   `----
  help: Did you mean to use a ':'? An '=' can only follow a property name
        when the containing object literal is part of a destructuring
        pattern.

Parsed with Errors.
```

流れとしては、`(` の次が `{` なので `Maybe` になり、まず引数として読みます。`{ a = 1 }` は引数としては正しいので読めますが、`=>` が来ないので rewind して、今度は式として読み直します。ここまでは投機パースです。

エラーのもとを作っているのは、オブジェクトリテラルのプロパティを読む `js/object.rs:103` からの部分です。`if self.eat(Kind::Eq)` の腕の終わりまでを載せます。

```rust
let is_shorthand_property_assignment = token_is_identifier && !self.at(Kind::Colon);

if is_shorthand_property_assignment {
    if let PropertyKey::StaticIdentifier(identifier_name) = key {
        // CoverInitializedName ({ foo = bar })
        if self.eat(Kind::Eq) {
            let right = self.parse_assignment_expression_or_higher();
            let left = AssignmentTarget::new_assignment_target_identifier(
                identifier_name.span,
                identifier_name.name,
                self,
            );
            let expr = AssignmentExpression::new(
                self.end_span(start),
                AssignmentOperator::Assign,
                left,
                right,
                self,
            );
            self.state.cover_initialized_name.insert(start, expr);
        }
```

ここでは `a = 1` を見つけても、その場ではエラーにせず、`self.state.cover_initialized_name` に位置をキーにして取っておきます。acorn の `shorthandAssign` と同じ発想です。

取っておいたものは、あとで分割代入だと分かると消されます。`({ a = 1 } = obj);` のように `=` が続いた場合、代入の左辺を `AssignmentTarget::cover` で代入先のパターンに作り変えます。この変換を集めた `js/grammar.rs` の冒頭の doc コメントは `//! Cover Grammar for Destructuring Assignment` で、プロパティを変換する腕 (`js/grammar.rs:226`) が `cover_initialized_name` から該当するものを取り除いています。

```rust
// convert `CoverInitializedName`
let init = p.state.cover_initialized_name.remove(&property.span.start).map(|e| e.right);
```

最後まで消されずに残ったものは、パースの最後に呼ばれる `check_unfinished_errors` (`lib.rs:918`) がまとめてエラーにします。

```rust
fn check_unfinished_errors(&mut self) {
    use oxc_span::GetSpan;
    // PropertyDefinition : cover_initialized_name
    // It is a Syntax Error if any source text is matched by this production.
    for expr in self.state.cover_initialized_name.values() {
        self.errors.push(diagnostics::cover_initialized_name(expr.span()));
    }
}
```

コメントの2行目は、仕様の `CoverInitializedName` の規則そのままです。`({ a = 1 } = obj);` は、oxc でもエラーなしで通りました。

つまり oxc は、アロー関数の引数は投機パースで、分割代入の左辺はカバー文法で、と使い分けています。`({ a = 1 });` は、その両方を通っていたことになります。

なお、アロー関数を投機パースで扱うのは oxc の独自の判断ではありません。Claude に確認してもらったところ、tsc 6.0.3 の `isParenthesizedArrowFunctionExpressionWorker` にも、上の `match third` と同じ分岐が同じコメント付きで並んでいました (3つ目の値の名前は、oxc の `Maybe` に対して tsc は `Unknown`)。oxc はこの判定を tsc から移植しています。

## まとめ

- mapped type とインデックスシグネチャは、`{` `[` 識別子 の次のトークンで分かれる。何トークン見れば決まるかが固定なので、投機ではなく `lookahead` で済む
- tuple type の rest 要素の重複は、oxc ではパーサーが `...` の後ろの書かれた形で判定する。tsc はチェッカーが型を解決してから判定するので、`readonly number[]` やエイリアスの扱いが違う
- template literal type の `}` は、レキサーが最初は閉じ波括弧として切り、パーサーが頼んでテンプレートの続きとして読み直させる。この仕組みは式のテンプレートリテラルと共通
- 型述語の `x is` は、次の1トークンを `peek_token` で覗くだけで判定する。tsc と ts-go は投機の形で、oxc も2026年4月までは同じ形だった
- アロー関数の引数は、`Tristate` で見当を付け、`Maybe` のときだけ投機パースする。一方で、分割代入の左辺にはカバー文法を使っていて、oxc の中に2つのやり方が同居している

## 連載を終えて

この連載では、oxc のパーサーの中で TypeScript が関わる部分を、型の文法、式への食い込み、AST の形、と順に読んできました。曖昧な場所に出会うたびに、先読みで決めるのか、読んでみて戻るのか、レキサーに読み直しを頼むのか、読んだ木を作り変えるのか、という選択が出てきて、その選び方を追うのがいちばん面白いところでした。この回で連載はおしまいです。最後まで読んでいただき、ありがとうございました。

なお、この記事で自分で実際に読んだのは oxc のパーサーだけです。tsc、typescript-go、acorn の中身や、仕様の該当箇所は Claude に確認してもらったものなので、間違っていたら指摘してもらえると助かります。
