---
title: oxcのTypeScriptパーサーを読む 第7回 tscの移植の、引き算と足し算
description: oxc の TypeScript パーサーは tsc のパーサーを写したものです。写すときに持ってこなかったものと、写した上に足した近道を、ソースに残ったコメントから拾います。
date: 2026-10-06
tags: ["コンパイラ", "パーサー", "oxc", "TypeScript", "oxc-ts-parser"]
draft: true
---

この記事では、oxc の TypeScript パーサーを tsc のパーサーの移植として読み、移植のときに持ってこなかったもの (引き算) と、移植の上に足した近道 (足し算) を、ソースに残った跡から拾います。

## 今回読むファイル

読んだのは oxc の rev `1aa5ec11ce` です。行番号はすべてこのリビジョンのもので、ズレたときに探せるように関数名とセットで書きます。今回おもに開くのはこのあたりです。

```text
crates/oxc_parser/src/ts/types.rs        1,690行   union 型の組み立てと、JSDoc の型
crates/oxc_parser/src/ts/statement.rs      962行   TS の宣言が始まるかの判定
crates/oxc_parser/src/js/expression.rs   1,799行   左辺式と呼び出しの組み立て
crates/oxc_parser/src/cursor.rs            638行   checkpoint / rewind / lookahead
crates/oxc_parser/src/lexer/mod.rs         650行   1トークンだけ覗く peek_token
```

比べる相手の tsc は、npm で配られている 6.0.3 の `lib/typescript.js` と、Go 版の tsc (以下 ts-go) のソースです。こちらは今は microsoft/TypeScript リポジトリの `tsc/` の下にあり、行番号は rev `f29aeb9f` のものです。この2つの中身と、PR の経緯は Claude に確認してもらったものです。

## 下準備: oxc のエラーを手元で出す

この記事に出てくる oxc の出力は1つだけで、次の手順で手元でも同じものが出せます。Rust のツールチェーンが入っていれば動きます。

oxc を記事と同じリビジョンで取ってきます。履歴まで丸ごと clone すると時間がかかるので、このコミットだけを `--depth 1` で浅く取ります (コミットを指定して取るので、SHA は省略せずに書きます)。

```bash
git init oxc
git -C oxc fetch --depth 1 https://github.com/oxc-project/oxc.git 1aa5ec11ce0dcbb0da7799e777c2492211908fbb
git -C oxc checkout FETCH_HEAD
cd oxc
printf '%s\n' 'type A = string | () => void;' > /tmp/union.ts
cargo run -q -p oxc_parser --example parser -- /tmp/union.ts --estree
```

最後の行が、AST をダンプするサンプルにファイルを食わせるコマンドです。出力は本文の「捨てたのはエラーメッセージの質」の節に載せています。

## 事前知識: 移植と、先を覗く道具

### oxc は tsc を写している

oxc の TypeScript パーサーの関数は、tsc のパーサーの関数とほぼ1対1で対応しています。名前を並べるとこんな具合です (左の列の名前は Claude に確認してもらいました)。

```text
tsc                                  oxc
parseNonArrayType                    parse_non_array_type
parseUnionOrIntersectionType         parse_union_type_or_intersection_type
parseLeftHandSideExpressionOrHigher  parse_lhs_expression_or_higher
parseCallExpressionRest              parse_call_expression_rest
```

Claude に両方を並べてもらうと、関数の分け方も、関数の中で判定する順番も、ほとんど同じでした。TypeScript の構文をどう読むかは tsc が決めていて、oxc はそれを Rust に写している、と読むのが実態に近いと思います。

移植なので、tsc にあって oxc に無いものや、その逆は、移植した人が何かを選んだ跡として読めます。

### checkpoint / lookahead / peek_token

近道の話では、先を覗く道具が3つ出てきます。

1つ目は checkpoint と rewind です。関数 `checkpoint` (`cursor.rs:309`) はレキサーの位置、現在のトークン、エラーの件数などを1つの値にまとめて保存し、`rewind` はそれを受け取って全部を元に戻します。checkpoint を取ってひとまず片方の解釈で読み進め、だめなら rewind して読み直すやり方を、投機パースと呼びます。

2つ目の `lookahead` (`cursor.rs:340`) は、checkpoint を取ってから渡された関数で先を読み、結果に関わらず必ず rewind します。パーサーの関数をまるごと走らせて、判断材料だけを持ち帰る道具です。

3つ目の `peek_token` (`lexer/mod.rs:255`) は、レキサーだけを1トークン進めて戻します。

```rust
pub fn peek_token(&mut self) -> Token {
    let checkpoint = self.checkpoint();
    let token = self.next_token();
    self.rewind(checkpoint);
    token
}
```

ここで呼んでいる `checkpoint` と `rewind` はレキサー自身のもので、パーサーの状態には触りません。次の1トークンの種類さえ分かれば決まる判定なら、`lookahead` ではなくこちらで足ります。

## 引き算: 移植しなかったもの

### コメントアウトされた tsc の原文

union 型 (`A | B`) と intersection 型 (`A & B`) を組み立てる `parse_union_type_or_intersection_type` (`ts/types.rs:252`) です。

```rust
fn parse_union_type_or_intersection_type<F>(
    &mut self,
    kind: Kind,
    parse_constituent_type: F,
) -> TSType<'a>
where
    F: Fn(&mut Self) -> TSType<'a>,
{
    let start = self.cur_start();
    let has_leading_operator = self.eat(kind);
    /* hasLeadingOperator && parseFunctionOrConstructorTypeToError(isUnionType) ||*/
    let mut ty = parse_constituent_type(self);
    if self.at(kind) || has_leading_operator {
        let mut types = ArenaVec::from_value_in(ty, self);
        while self.eat(kind) {
            let ty =
                /*parseFunctionOrConstructorTypeToError(isUnionType) || */
                parse_constituent_type(self);
            types.push(ty);
        }
        let span = self.end_span(start);
        ty = match kind {
            Kind::Pipe => TSType::new_ts_union_type(span, types, self),
            Kind::Amp => TSType::new_ts_intersection_type(span, types, self),
            _ => unreachable!(),
        };
    }
    ty
}
```

コメントの `/* ... */` で囲まれた2行は Rust ではありません。変数名がキャメルケースで、末尾に `||` がぶら下がっています。

Claude に tsc 6.0.3 の対応する関数を見てもらうと、こうなっていました (`lib/typescript.js` から)。

```text
function parseFunctionOrConstructorTypeToError(isInUnionType) {
  if (isStartOfFunctionTypeOrConstructorType()) {
    const type = parseFunctionOrConstructorType();
    let diagnostic;
    if (isFunctionTypeNode(type)) {
      diagnostic = isInUnionType ? Diagnostics.Function_type_notation_must_be_parenthesized_when_used_in_a_union_type : Diagnostics.Function_type_notation_must_be_parenthesized_when_used_in_an_intersection_type;
    } else {
      diagnostic = isInUnionType ? Diagnostics.Constructor_type_notation_must_be_parenthesized_when_used_in_a_union_type : Diagnostics.Constructor_type_notation_must_be_parenthesized_when_used_in_an_intersection_type;
    }
    parseErrorAtRange(type, diagnostic);
    return type;
  }
  return void 0;
}
function parseUnionOrIntersectionType(operator, parseConstituentType, createTypeNode) {
  const pos = getNodePos();
  const isUnionType = operator === 52 /* BarToken */;
  const hasLeadingOperator = parseOptional(operator);
  let type = hasLeadingOperator && parseFunctionOrConstructorTypeToError(isUnionType) || parseConstituentType();
  if (token() === operator || hasLeadingOperator) {
    const types = [type];
    while (parseOptional(operator)) {
      types.push(parseFunctionOrConstructorTypeToError(isUnionType) || parseConstituentType());
    }
    type = finishNode(createTypeNode(createNodeArray(types, pos)), pos);
  }
  return type;
}
```

oxc のコメントの中身は、`parseUnionOrIntersectionType` の `let type = ...` と `types.push(...)` の、`||` より左の部分そのものです。移植では `||` の右側 (`parseConstituentType()`) だけを写し、左側を原文のままコメントにして、元の位置に置いています。

左側の `parseFunctionOrConstructorTypeToError` は、エラーメッセージのための関数です。union や intersection の構成要素が関数型やコンストラクタ型の形で始まっていたら、ひとまずそれを読み切ってから、「union の中で関数型を書くなら括弧で囲め」というエラーを付けます。関数型の `=>` は `|` より弱く結合するので、`string | () => void` は括弧が無いと正しい型になりません。

### 捨てたのはエラーメッセージの質

その入力を実際に食わせてみます。oxc の出力は、下準備のコマンドで出したこれです。

```text
TS-ESTree AST:
{
  "type": "Program",
  "body": [],
  "sourceType": "script",
  "hashbang": null,
  "start": 0,
  "end": 0
}

  x Unexpected token
   ,----
 1 | type A = string | () => void;
   :                    ^
   `----

Parsed with Errors.
```

指しているのは `(` の次の `)` で、メッセージは `Unexpected token` です。`(` を括弧で囲んだ型の始まりとして読み、中身が空だったところで止まっています。

同じ入力を tsc 6.0.3 の `ts.createSourceFile` でパースし、パースのエラー (`parseDiagnostics`) と、木に残った文の数を出してもらった結果がこちらです (Claude に確認してもらったもの)。

```text
== union.ts
1:18 TS1385: Function type notation must be parenthesized when used in a union type.
statements: 1
```

どちらもエラーで、受け付けない点は同じです。違うのは、tsc は関数型の部分を指して「union の中の関数型は括弧で囲め」と名指しすること、そしてエラーを付けたうえで文を1つ木に残していることです。oxc の出力は `body` が空でした。

### 理由は PR に書かれていない

このコメントが入ったのは、2024年6月の [#3903](https://github.com/oxc-project/oxc/pull/3903) (refactor(parser): improve parsing of TypeScript types) でした。`ts/types.rs` を大きく書き直した PR ですが、本文は `- [x] fix everything` の1行だけで、この2行を写さなかった理由は書かれていません (ここも Claude に確認してもらいました)。

なので以下は自分の推測です。Claude に tsc 側をもう少し見てもらうと、`parseFunctionOrConstructorTypeToError` が最初に呼ぶ `isStartOfFunctionTypeOrConstructorType` は、構成要素が `(` で始まるときに `lookAhead` で先を覗いていました。この書き方のままだと、`string | (() => void)` のような正しい型でも、`(` で始まる構成要素ごとに先読みが1回増えます。正しいコードの速さに払うコストと、間違ったコードに出すメッセージの質を比べて、後者を捨てた、と読むのが自然に見えます。

コメントで残してあることにも意味があると思います。知らずに落としたのではなく、ここに tsc の処理があることを知ったうえで写さなかった、という印になっています。

### JSDoc の型は TODO のまま

コメントアウトされた tsc の原文は、型パーサーの中にもう1か所あります。型の分岐の根っこにいる `parse_non_array_type` (`ts/types.rs:411`) の途中、`ts/types.rs:431` からの部分です。前後の腕は省いて、コメントのところだけを載せます。

```rust
// TODO: js doc types: `JSDocAllType`, `JSDocFunctionType`
// Kind::StarEq => {
// scanner.reScanAsteriskEqualsToken();
// falls through
// }
// Kind::Star => {
// return parseJSDocAllType();
// }
// case SyntaxKind.QuestionQuestionToken:
// // If there is '??', treat it as prefix-'?' in JSDoc type.
// scanner.reScanQuestionToken();
// // falls through
// case SyntaxKind.FunctionKeyword:
// return parseJSDocFunctionType();
Kind::Question => self.parse_js_doc_unknown_or_nullable_type(),
Kind::Bang => self.parse_js_doc_non_nullable_type(),
```

JSDoc は、JavaScript のファイルにコメントで型を書くための記法です。`/** @type {string} */` のように書きます。tsc はこの中身を TypeScript の型と同じパーサーで読むので (Claude に確認してもらいました)、型パーサーには JSDoc だけの書き方を読む腕が混ざっていて、oxc にもその腕が移植されています。

コメントになっているのは2つです。`*` は「何でもよい型」(`JSDocAllType`)、`function(string): void` は Closure Compiler 由来の関数型の書き方 (`JSDocFunctionType`) です。すぐ下の `?` と `!` の腕は JSDoc の型を読む関数を呼んでいて、こちらは移植されています。union のときとは違って、先頭に `TODO` と書いてあるので、捨てたというより後回しにした、という扱いです。

ここで面白かったのが ts-go です。Claude に `parseNonArrayType` (`tsc/internal/parser/parser.go:2804`) を見てもらうと、`*` を読む腕はあるのに、`function` を読む腕がありませんでした。ts-go のリポジトリには、JS 版から意図的に変えたことを並べた [CHANGES.md](https://github.com/microsoft/TypeScript/blob/f29aeb9f825d96feea27841f3f7342dbf0df68a8/tsc/CHANGES.md#L113-L117) があり、そこにはっきり書いてありました。

> JSDoc types are parsed in normal type annotation position but show a grammar error. Corsa no longer parses the JSDoc types below, giving a parse error instead of a grammar error.
>
> 1. No Closure `function(string,string): void` types.
> 2. No JSDoc standalone `?` type.
> 3. No JSDoc module namepaths: `module:folder/file.C`

Corsa は Go 版の、Strada は JS 版の開発コードネームで、CHANGES.md はこの2つの名前で両者を比べています。`JSDocFunctionType` を扱うコードを消した typescript-go の PR [#408](https://github.com/microsoft/typescript-go/pull/408) (2025年3月) の本文も、「It's not supported in Corsa」の1文から始まっています。

3者を並べるとこうなります。tsc と ts-go は Claude にソースを読んでもらった結果です。oxc は自分で読んだ腕に加えて、`let a: *;` と `let b: function(string): void;` を Claude に食わせてもらい、どちらもエラーになることを確かめています。

| 書き方                          | tsc 6.0.3 | ts-go    | oxc      |
| ------------------------------- | --------- | -------- | -------- |
| `*` (何でもよい型)              | 読む      | 読む     | 読まない |
| `function(string): void`        | 読む      | 読まない | 読まない |
| 単独の `?` (型が分からないこと) | 読む      | 読まない | 読む     |

Microsoft 自身も Go に移植するときに、JSDoc の書き方を一部捨てていました。ただ、捨てたものは oxc と同じではありません。ts-go は `*` を残して単独の `?` を捨て、oxc は単独の `?` を読んで `*` を後回しにしています。`function(...)` だけは両方が持ってきていませんでした。

## 足し算: tsc に無い近道

ここからは逆向きの話です。oxc には、写したコードの上に、tsc には無い近道を足した場所があります。

Claude に oxc の履歴を見てもらうと、2026年6月の1か月で、パーサーに `perf(parser)` で始まるコミットが23本入っていました。多くは Boshen さんによるもので、checkpoint を取っていた判定を `peek_token` に置き換えるものや、`lookahead` の手前に近道を置くものが並んでいます。その中から2つを見ます。

### TS の宣言の入口: `at_start_of_ts_declaration`

1つ目は文の入口です。`type` や `interface`、`namespace` は TypeScript の宣言の始まりですが、JavaScript では普通の識別子として使えます。`type = 5;` は変数 `type` への代入です。なので文の入口では、これらのキーワードが来るたびに「ここから TS の宣言が始まるか」を判定します。それが `at_start_of_ts_declaration` (`ts/statement.rs:863`) です。

```rust
pub(crate) fn at_start_of_ts_declaration(&mut self) -> bool {
    // Fast path: the single-keyword declaration forms are decided by `cur_kind` plus at most one
    // peeked token, so resolve them here instead of paying for the full `lookahead` (checkpoint +
    // speculative sub-parse + rewind). Each arm mirrors the matching arm of
    // `at_start_of_ts_declaration_worker` exactly.
    match self.cur_kind() {
        // `var x`  `let x`  `const x`  `function f`  `class C`  `enum E`
        Kind::Var | Kind::Let | Kind::Const | Kind::Function | Kind::Class | Kind::Enum => true,
        // `interface I`  `type T = …`  (keyword + binding ident on the same line)
        Kind::Interface | Kind::Type => {
            let next = self.lexer.peek_token();
            next.kind().is_binding_identifier() && !next.is_on_new_line()
        }
        // `module M`  `module "m"`  `namespace N`  (keyword + binding ident or string)
        Kind::Module | Kind::Namespace => {
            let next = self.lexer.peek_token();
            !next.is_on_new_line()
                && (next.kind().is_binding_identifier() || next.kind() == Kind::Str)
        }
        // `global { … }`  `global export …`  (`global` + `{` / `export` / ident)
        Kind::Global => {
            matches!(self.lexer.peek_token().kind(), Kind::Ident | Kind::LCurly | Kind::Export)
        }
        // `import x`  `import "m"`  `import *`  `import {`  (`import` + string / `*` / `{` / ident)
        Kind::Import => {
            let next = self.lexer.peek_token().kind();
            matches!(next, Kind::Str | Kind::Star | Kind::LCurly) || next.is_identifier()
        }
        // Multi-token modifier chains (`declare const x`, `abstract class C`, `export type T`,
        // `async function f`, `static …`) and `export = …` / `export default …` need real
        // lookahead, as do non-declaration tokens.
        _ => self.lookahead(Self::at_start_of_ts_declaration_worker),
    }
}
```

冒頭のコメントを訳すと、「高速経路: キーワード1個で始まる宣言の形は、`cur_kind` (現在のトークンの種類) と、多くても1個の覗いたトークンで決まる。だから、完全な `lookahead` (checkpoint と投機的な部分パースと rewind) のコストを払わずに、ここで解決する。各腕は、`at_start_of_ts_declaration_worker` の対応する腕と、そのまま一致している」。

最後の `_` の腕が、もともとの判定です。`declare const x` や `export type T` のように修飾子が何個続くか分からない形は、1トークン覗くだけでは決まらないので、`lookahead` の中で `at_start_of_ts_declaration_worker` (`ts/statement.rs:899`) を走らせます。その worker の冒頭はこうなっています (残りの腕は省きました)。

```rust
/// Check if the parser is at a start of a ts declaration
fn at_start_of_ts_declaration_worker(&mut self) -> bool {
    loop {
        match self.cur_kind() {
            Kind::Var | Kind::Let | Kind::Const | Kind::Function | Kind::Class | Kind::Enum => {
                return true;
            }
            Kind::Interface | Kind::Type => {
                self.bump_any();
                return self.cur_kind().is_binding_identifier()
                    && !self.cur_token().is_on_new_line();
            }
            Kind::Module | Kind::Namespace => {
                self.bump_any();
                return !self.cur_token().is_on_new_line()
                    && (self.cur_kind().is_binding_identifier()
                        || self.cur_kind() == Kind::Str);
            }
```

worker は `bump_any` で実際にトークンを1つ進めてから次を見て、高速経路は `peek_token` で覗くだけです。違うのはそこだけで、見ている条件は同じです。`type = 5;` は、`type` の次が `=` で束縛できる識別子ではないので、どちらの経路でも偽になって式の文として読まれます。

Claude に確認してもらうと、tsc 6.0.3 の `isStartOfDeclaration` も、ts-go の `isStartOfDeclaration` ([`parser.go:6123`](https://github.com/microsoft/TypeScript/blob/f29aeb9f825d96feea27841f3f7342dbf0df68a8/tsc/internal/parser/parser.go#L6123-L6125)) も、中身は `lookAhead` の1行だけでした。

```go
func (p *Parser) isStartOfDeclaration() bool {
	return p.lookAhead((*Parser).scanStartOfDeclaration)
}
```

oxc の worker は、この `lookAhead` に渡される関数の移植にあたります。高速経路にあたるものは、tsc にも ts-go にも見つけられませんでした (Go 版のほうは、2026年10月3日時点の microsoft/TypeScript の main でも同じでした)。

高速経路は [#23083](https://github.com/oxc-project/oxc/pull/23083) (perf(parser): fast-path single-keyword TS declarations、2026年6月) で入りました。PR の本文によると、`interface` や `type`、`enum`、`namespace` のよくある宣言を checkpoint なしで済ませるためで、テストのスナップショットがバイト単位で変わらないことに加えて、`module.exports` や `type = 5`、`interface()`、キーワードの直後の改行のような、判定を間違えると結果が変わる入力を集めたファイルで、出力が変わらないことを確かめています。

### 同じ判定を2か所に持つ

この近道で、同じ判定がソースの2か所に書かれることになりました。高速経路の腕と、遅い経路にあたる worker の腕です。遅い経路の側の、高速経路と重なる腕も消せません。`declare const x` を読むときに、`declare` を食べたあとの `const` を、自分の `Kind::Const` の腕で判定するからです。

2か所が食い違うと、同じ入力でも高速経路を通るか遅い経路を通るかで結果が変わります。2か所が一致していることを示しているのは、冒頭のコメントの「mirrors ... exactly」の1文と、PR で確かめた出力の一致です。tsc を写した worker が正しさの本体で、高速経路はそれと同じ答えを安く出すための写し、という関係になっています。

### 式の葉ごとの無駄を省く

2つ目は、左辺式を1つ読む `parse_lhs_expression_or_higher` (`js/expression.rs:748`) です。左辺式は `a.b` や `f(x)`、`a?.b` のような、代入の左辺になれる形の式で、式を読むときはほぼ必ずここを通ります。

```rust
/// Section 13.3 Left-Hand-Side Expression
pub(crate) fn parse_lhs_expression_or_higher(&mut self) -> Expression<'a> {
    self.with_pure_comments(Self::parse_lhs_expression_or_higher_impl)
}

fn parse_lhs_expression_or_higher_impl(&mut self) -> Expression<'a> {
    let start = self.cur_start();
    let mut in_optional_chain = false;
    // `MemberExpression`
    let primary = self.parse_primary_expression();
    let member_expression = self.parse_member_expression_rest(
        start,
        primary,
        &mut in_optional_chain,
        /* allow_optional_chain */ true,
    );
    // A fully-parsed `MemberExpression` only extends into a `LeftHandSideExpression` via
    // `Arguments` (`(`) or an `OptionalChain` (`?.`); see <https://tc39.es/ecma262/#sec-left-hand-side-expressions>.
    // So skip `parse_call_expression_rest` (and its redundant member-rest re-scan) otherwise.
    let lhs = if matches!(self.cur_kind(), Kind::LParen | Kind::QuestionDot) {
        self.parse_call_expression_rest(start, member_expression, &mut in_optional_chain)
    } else {
        member_expression
    };
```

引用は `_impl` の途中までで、後半 (`?.` があったときに全体を包む処理) は省きました。

最初の識別子や数値を `parse_primary_expression` で読み、`.b` や `[0]` のような後ろに続くものを `parse_member_expression_rest` で積みます。そのあとの `if` が近道です。コメントを訳すと、「完全にパースし終わった `MemberExpression` が `LeftHandSideExpression` に伸びるのは、`Arguments` (`(`) か `OptionalChain` (`?.`) を経由するときだけ。だから、それ以外のときは `parse_call_expression_rest` (と、その中の重複したメンバー式の再走査) を飛ばす」。

tsc の側はどうなっているか。Claude に ts-go の `parseLeftHandSideExpressionOrHigher` ([`parser.go:5199`](https://github.com/microsoft/TypeScript/blob/f29aeb9f825d96feea27841f3f7342dbf0df68a8/tsc/internal/parser/parser.go#L5199-L5266)) の最後と、そこから呼ばれる `parseCallExpressionRest` ([`parser.go:5505`](https://github.com/microsoft/TypeScript/blob/f29aeb9f825d96feea27841f3f7342dbf0df68a8/tsc/internal/parser/parser.go#L5505)) の冒頭を出してもらいました。どちらも途中を省いた抜粋です。

```go
	// Now, we *may* be complete.  However, we might have consumed the start of a
	// CallExpression or OptionalExpression.  As such, we need to consume the rest
	// of it here to be complete.
	return p.parseCallExpressionRest(pos, expression)
}
```

```go
func (p *Parser) parseCallExpressionRest(pos int, expression *ast.Expression) *ast.Expression {
	for {
		expression = p.parseMemberExpressionRest(pos, expression /*allowOptionalChain*/, true)
```

左辺式を読み終えると、後ろに何が来ても `parseCallExpressionRest` を呼び、その中のループは最初に `parseMemberExpressionRest` をもう一度走らせます。直前に走らせ終えたばかりなので、`(` も `?.` も来ていなければ、何も積まずに戻ってくるだけの1周です。tsc 6.0.3 も同じ形でした。

これを `if` 1つで飛ばしたのが [#23063](https://github.com/oxc-project/oxc/pull/23063) (perf(parser): skip parse_call_expression_rest when no call follows、2026年6月) です。PR の本文 (Claude に確認してもらったもの) によると、oxc ももとはこの形をそのまま写していて、式の中の `a` や `1` のような葉の1つ1つがこの空回りを払っていました。本文には、ts-go も JS 版 tsc も同じ形で、同じ重複を持ったまま最適化していない、とも書いてあります。

効果も PR に載っています。`parse_member_expression_rest` はプロファイルで1番のホットスポットで、近道を入れると、式が密な2.5 MB のファイルで1回のパースが約22.6ミリ秒から約19.7ミリ秒になり、約13%速くなったそうです。AST とスパンとトークンの出力は、変更前とバイト単位で同じだったそうです。

### 近道の前提を debug_assert で書く

翌日には続きの [#23068](https://github.com/oxc-project/oxc/pull/23068) が入っています。`parse_call_expression_rest` (`js/expression.rs:1091`) の冒頭です。

```rust
/// Section 13.3 Call Expression
fn parse_call_expression_rest(
    &mut self,
    lhs_start: u32,
    lhs: Expression<'a>,
    in_optional_chain: &mut bool,
) -> Expression<'a> {
    let mut lhs = lhs;
    // The caller only enters here with the current token being `(` or `?.`. For `(`,
    // `parse_member_expression_rest` is a no-op (`(` ∉ its FIRST set: `?.`, `.`, `[`,
    // template, TS `!`/`<`), so skip the redundant re-scan on entry; entering on `?.`, and
    // every later iteration (after `Arguments`), still needs it.
    debug_assert!(
        matches!(self.cur_kind(), Kind::LParen | Kind::QuestionDot),
        "parse_call_expression_rest is only entered on `(` or `?.`",
    );
    let mut rescan_members = !self.at(Kind::LParen);
    while self.fatal_error.is_none() {
        if rescan_members {
            lhs = self.parse_member_expression_rest(
                lhs_start,
                lhs,
                in_optional_chain,
                /* allow_optional_chain */ true,
            );
        }
```

関数の残りは省きました。

コメントを訳すと、「呼び出し元は、現在のトークンが `(` か `?.` のときにしかここへ入らない。`(` のときは `parse_member_expression_rest` は何もしない (`(` はその関数が最初に受け付けるトークン、つまり `?.`、`.`、`[`、テンプレート、TS の `!` と `<` のどれでもない) ので、入った直後の重複した再走査を飛ばす。`?.` で入ったときと、2周目以降 (引数を読んだあと) は、まだ必要」。

この近道は、呼び出し元の `if` が `(` か `?.` のときだけ呼ぶ、という前提に乗っています。その前提を、コメントだけでなく `debug_assert!` でも書いています。デバッグビルドでは、前提が崩れた呼び出しがあればその場で止まります。

### 同じ近道が ts-go に足されることもある

近道は oxc だけのものとも限りません。式の中の `<` を型引数として投機パースする関数には、現在のトークンが `<` でなければ checkpoint を取る前に帰る門番があります。この門番は、ts-go の [#4234](https://github.com/microsoft/typescript-go/pull/4234) と oxc の [#23069](https://github.com/oxc-project/oxc/pull/23069) で、2026年6月に1日違いで作られた PR によって両方へ足されていました (Claude に確認してもらいました)。oxc が足したのと同じ近道が、tsc の側 (ts-go) に足されることもあるわけです。一方、この記事で見た2つの近道は、Go 版の main にも見つけられませんでした。

## 引き算も足し算も、tsc との関係を書き残している

引き算と足し算を並べてみると、残し方が似ています。

引き算のほうは、写さなかった tsc の処理を、原文のままコメントにして元の位置に置いていました。足し算のほうは、近道の横に「worker の腕とそのまま一致している」「呼び出し元は `(` か `?.` のときにしか入らない」と、何と同じ答えを出すべきかを書いていました。

どちらも、tsc を写した部分との関係を、ソースの中に書き残しています。元のコードと並べて読むときは、このコメントが目印になります。

## まとめ

- oxc の TypeScript パーサーは、関数の分け方も判定の順番も tsc を写している。だから違うところは、移植した人が選んだ跡として読める
- 引き算: union の中の関数型に名指しのエラーを出す tsc の処理は、原文のままコメントにして写していない。失ったのはエラーメッセージの質で、理由は PR に書かれていない
- 引き算: JSDoc の `*` と `function(...)` は TODO のまま。ts-go も `function(...)` と単独の `?` は意図的に捨てていて、捨てたものの組み合わせは oxc と同じではない
- 足し算: TS の宣言の入口の高速経路と、左辺式で呼び出しが続かないときの近道は、tsc にも ts-go にも見つけられなかった。どちらも、tsc を写した遅い経路と同じ答えを出すことを、コメントと `debug_assert!` と出力の一致で保っている

次回は「積み残した型の難所たち」です。mapped type、tuple type、template literal type、型述語、それからアロー関数の曖昧性と、ここまでの回で扱いきれなかった型の文法の難所を、まとめて見ていきます。

なお、この記事で自分で実際に読んだのは oxc のパーサーだけです。tsc と ts-go の中身や、PR と履歴の経緯は Claude に確認してもらったものなので、間違っていたら指摘してもらえると助かります。
