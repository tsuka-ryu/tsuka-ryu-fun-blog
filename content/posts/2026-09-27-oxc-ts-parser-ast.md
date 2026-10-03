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

比較のために、TSESTree 8.26.1 も走らせています。oxc とこちらの結果は、次の「下準備」の手順で手元でも同じものが出せます。TypeScript 本体 (tsc 3.9.10 / 4.0.8 / 5.9.3 / 6.0.3 と、Go 版の開発版) の結果は、Claude に確認してもらったものです。AST のダンプは、oxc は `cargo run -q -p oxc_parser --example parser -- x.ts --estree`、tsc は `ts.createSourceFile`、TSESTree は `parse()` で採りました。

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

作業用の `repro` の中に、TSESTree でパースした結果をそのまま JSON で出すスクリプトを置きます。

```js
// estree.cjs
const { parse } = require("@typescript-eslint/typescript-estree");

const sources = [
  "type A = null;",
  "type C = true;",
  "type F = `abc`;",
  "a?.b!",
  "a?.b!.c",
  "(a?.b)!.c",
];
for (const src of sources) {
  console.log(`===== ${src}`);
  console.log(JSON.stringify(parse(src).body[0], null, 2));
}
```

TSESTree 側は、これを実行します。

```bash
node estree.cjs
```

oxc 側は、入力を1つずつファイルに書いて、`parser` サンプルに `--estree` を付けて流します。

```bash
cd ../oxc
for src in 'type A = null;' 'type C = true;' 'type F = `abc`;' 'a?.b!' 'a?.b!.c' '(a?.b)!.c'; do
  printf '%s\n' "$src" > /tmp/x.ts
  echo "===== $src"
  cargo run -q -p oxc_parser --example parser -- /tmp/x.ts --estree
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
     tsc                  TSESTree                       oxc
  公式の実装            変換レイヤー                  Rust製の再実装
  パーサー +            tscのASTを受け取って           自前の手書きパーサー
  チェッカー            ESTree形式に組み替える          型の解決はしない
  （型を解決する）       （ESLintのために）             出力の形は TSESTree に寄せる
```

左端が tsc、つまり Microsoft が配っている公式の実装です。tsc が内部で使っている AST は、`ts.createSourceFile` などのコンパイラ API で `ts.Node` の木として取り出せます。この記事ではこれを TypeScript AST と呼びます。

TypeScript AST は、ESTree の木と比べるとかなり読みにくい木みたいです (シンプルに JSON にダンプしたりするのが難しい)。Claude に tsc 6.0.3 で `type A = null;` の `LiteralType` のノードを1つ覗いてもらうと、こうなっていました。

```text
kind = 202  pos = 8  end = 13  getStart() = 9
自前のキー: pos, end, kind, id, flags, modifierFlagsCache, transformFlags, parent, original, emitNode, literal
```

- ノードの種類は `kind` に数値で入っていて、名前は `ts.SyntaxKind` で引き直さないと分かりません
- `pos` は、直前の空白まで含んだ位置です (`=` の後ろの空白の位置8から始まる)。トークン本体の始まり (9) は `getStart()` で別に求めます。oxc の出力では、ここの `start` は9でした
- `parent` で親を指しているので木が循環していて、`JSON.stringify` に渡すとエラーになります
- `flags` や `transformFlags`、`emitNode` のように、型チェックや JavaScript への変換・出力で使う欄が、ノード自身に付いています

これは、作られた目的の違いだと考えると納得がいきます。TypeScript AST は、tsc というコンパイラが自分で使うための内部の構造です。親をたどったり、フラグで状態を持たせたり、エディタで書き換えた部分だけ作り直したり (`ts.updateSourceFile`) するのに都合よく作られていて、外から読みやすいことは優先されていません。一方の ESTree は、[README](https://github.com/estree/estree) によると、Firefox の SpiderMonkey が出していた形式が「JavaScript のソースを扱うツールの共通語 (lingua franca)」として広まったもので、今は ESLint・Acorn・Babel の開発者が運営するコミュニティの標準です。いろいろなツールが同じ木を読むための形なので、ノードの種類も `"type": "TSNullKeyword"` のように名前で書かれています。

真ん中の TSESTree は、自前のパーサーを持っていません。tsc を呼んで AST を作らせて、それを ESTree 形式に変換します。ESLint のエコシステムは ESTree の上に乗っているので、そのままでは食べられないからです。

Claude に 8.26.1 の中身を確認してもらうと、`dist/parser.js` の `parse()` の本体はこの2段でした。

```text
/**
 * Create a ts.SourceFile directly, no ts.Program is needed for a simple parse
 */
const ast = (0, createSourceFile_1.createSourceFile)(parseSettings);
/**
 * Convert the TypeScript AST to an ESTree-compatible one
 */
const { astMaps, estree } = (0, ast_converter_1.astConverter)(ast, parseSettings, shouldPreserveNodeMaps);
```

1段目の `createSourceFile` は、ソースを文字列で渡したときは中で `ts.createSourceFile` を呼んで、TypeScript AST を作ります。2段目の `astConverter` が、それを TSESTree の形に組み替える段です。組み替えの本体の `dist/convert.js` には、`case SyntaxKind.LiteralType:` のように、TypeScript AST のノードの種類ごとに「TSESTree ではこのノードにする」という分岐が並んでいます。あとで見る null の扱いも、この分岐の1つです。

もう1つ大事なのは、`astConverter` が変換後の木 (`estree`) と一緒に `astMaps` を返していることです。中身は `esTreeNodeToTSNodeMap` と `tsNodeToESTreeNodeMap` の2つで、2つの木のノードを互いに対応づける表です。つまり変換したあとも、元の TypeScript AST は捨てていません。

この対応表が効いてくるのが型情報です。ESLint のルールが読むのは TSESTree の木ですが、「この変数の型は何か」が知りたくなったら、対応表で TypeScript AST のノードに戻って、tsc の型チェッカーに聞けます。ルールに渡す型の取り出し口 (`dist/createParserServices.js`) は、こうなっていました。

```js
getSymbolAtLocation: node => checker.getSymbolAtLocation(astMaps.esTreeNodeToTSNodeMap.get(node)),
getTypeAtLocation: node => checker.getTypeAtLocation(astMaps.esTreeNodeToTSNodeMap.get(node)),
```

受け取った TSESTree のノード (`node`) を `esTreeNodeToTSNodeMap` で TypeScript AST のノードに引き直して、tsc の `checker` に渡しています。typescript-eslint の、型情報を使うルールは、この取り出し口や対応表を通して tsc に型を聞いています。

右端が今回の主役です。oxc は TSESTree のような変換役ではなく、自前の再帰下降パーサーで最初から AST を組み立てます。それでいて、出てくる木の形は真ん中の出力に合わせてある。つまり TypeScript AST と同じ形を作ってから直すのではなく、作る時点で違う形にしている。変換の段を持たないので、TSESTree のように対応表を通って tsc の型情報に戻る、という道もありません。

その「作る時点で違う」が一番はっきり出るのが、次の1行です。

## 実例1: null 型だけ、箱に入っていない

型エイリアスを1つ書きます。

```ts
type A = null;
```

これを oxc のパーサーに `--estree` を付けて流した出力から、`Program` の外枠だけを外したものがこちらです。

```json
{
  "type": "TSTypeAliasDeclaration",
  "id": {
    "type": "Identifier",
    "decorators": [],
    "name": "A",
    "optional": false,
    "typeAnnotation": null,
    "start": 5,
    "end": 6
  },
  "typeParameters": null,
  "typeAnnotation": {
    "type": "TSNullKeyword",
    "start": 9,
    "end": 13
  },
  "declare": false,
  "start": 0,
  "end": 14
}
```

型注釈の `typeAnnotation` には、`TSNullKeyword` のノードが1個あるだけです。ところが同じ書き方で `type C = true;` を流すと、こう変わります。

```json
{
  "type": "TSTypeAliasDeclaration",
  "id": {
    "type": "Identifier",
    "decorators": [],
    "name": "C",
    "optional": false,
    "typeAnnotation": null,
    "start": 5,
    "end": 6
  },
  "typeParameters": null,
  "typeAnnotation": {
    "type": "TSLiteralType",
    "literal": {
      "type": "Literal",
      "value": true,
      "raw": "true",
      "start": 9,
      "end": 13
    },
    "start": 9,
    "end": 13
  },
  "declare": false,
  "start": 0,
  "end": 14
}
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

使う入力は `a?.b!` と `a?.b!.c` の2つです。

### oxc と TSESTree は同じ形

まず oxc です。`a?.b!` を `--estree` で流した出力から、`Program` と `ExpressionStatement` の外枠だけを外したものがこちらです。

```json
{
  "type": "ChainExpression",
  "expression": {
    "type": "TSNonNullExpression",
    "expression": {
      "type": "MemberExpression",
      "object": {
        "type": "Identifier",
        "decorators": [],
        "name": "a",
        "optional": false,
        "typeAnnotation": null,
        "start": 0,
        "end": 1
      },
      "property": {
        "type": "Identifier",
        "decorators": [],
        "name": "b",
        "optional": false,
        "typeAnnotation": null,
        "start": 3,
        "end": 4
      },
      "optional": true,
      "computed": false,
      "start": 0,
      "end": 4
    },
    "start": 0,
    "end": 5
  },
  "start": 0,
  "end": 5
}
```

外側から `ChainExpression`、`TSNonNullExpression`、`MemberExpression` の順に入れ子になっています。`?.` は、`MemberExpression` の `"optional": true` で表されています。

TSESTree の出力も同じ形でした。違いは、位置 (`start` と `end`) と識別子の `"typeAnnotation": null` を、oxc は出して TSESTree は出さない (後者はキーごと無い) という2点だけです。ノードの種類と入れ子は一致していて、`a?.b!.c` でも同じでした。

ひとつだけ見た目が割れるのは、`(a?.b)!.c` のように括弧を付けたときです。oxc だけ、括弧が `ParenthesizedExpression` というノードとして残ります。とはいえ、これは差というより設定の話でした。パーサーには `preserve_parens` というオプションがあって、ドキュメントコメント自身が非標準だと断ったうえで既定値をオンにしています。ESTree の仕様に括弧のノードは無いので、切れば消えます。

#### 補足: `ChainExpression` と `"optional": true` の役割

この補足は、Claude に調べてもらった内容です (実行結果、仕様の該当箇所と引用を含みます)。

`?.` を表すのに、なぜノードが2つ出てくるのか。`?.` の動きを見ると分かります。Node.js で実行した結果です。

```js
const a = undefined;

a?.b.c; // undefined
(a?.b).c; // TypeError: Cannot read properties of undefined (reading 'c')
```

`a?.b.c` は、`a` が `undefined` だと分かった時点で、そのあとの `.b` も `.c` も評価せずに、式全体が `undefined` になります (short-circuiting)。一方 `(a?.b).c` は、括弧の中の `a?.b` が `undefined` になったあと、括弧の外の `.c` は普通に評価されるので、`undefined` のプロパティを読もうとしてエラーになります。

つまり `?.` には、「どこで値を確かめるか」と「値が無かったら、どこまでまとめて飛ばすか」の2つの情報があります。

ECMAScript の仕様では、これが文法に表れています。[13.3.9 Optional Chains](https://tc39.es/ecma262/2025/multipage/ecmascript-language-expressions.html#sec-optional-chains) の `OptionalChain` は、`?. IdentifierName` で始まり、後ろに `. IdentifierName` や `[ Expression ]`、`Arguments` を続けられる形で定義されています。`a?.b.c` の `?.b.c` は、全体で1つの `OptionalChain` です。そして評価の手順 (13.3.9.1) には、`?.` の手前の値が `undefined` か `null` なら、`OptionalChain` を評価せずに `undefined` を返す、と書かれています。括弧で囲った `(a?.b)` はそこで1つの式として閉じるので、後ろの `.c` はチェーンに入りません。

ESTree は、この2つの情報を別々のノードに持たせています。[仕様 (es2020.md)](https://github.com/estree/estree/blob/875bf70440a8870c4a663865a7a41300cf1add55/es2020.md#chainexpression) の `ChainExpression` の説明にはこうあります。

> If the `callee|object` property is evaluated to nullish and the `optional` property is `true`, then the node and ancestor nodes are skipped until the closest `ChainExpression` node, and the result of the `ChainExpression` node becomes `undefined`.

`"optional": true` が付いたノードで、手前の値 (`object` や `callee`) が null か undefined だったら、そこから一番近い `ChainExpression` までの祖先をまとめて飛ばし、`ChainExpression` の結果を `undefined` にする、という意味です。`"optional": true` が「どこで確かめるか」、`ChainExpression` が「どこまで飛ばすか」にあたります。同じ仕様には、[`obj?.aaa.bbb`](https://github.com/estree/estree/blob/875bf70440a8870c4a663865a7a41300cf1add55/es2020.md?plain=1#L89-L103) と [`(obj?.aaa).bbb`](https://github.com/estree/estree/blob/875bf70440a8870c4a663865a7a41300cf1add55/es2020.md?plain=1#L158-L172) の木を並べた例も載っています。

これで上の木も読めます。`a?.b!` では、`TSNonNullExpression` が `ChainExpression` の内側にあるので、`!` もチェーンの一部として、飛ばす範囲に入っています。

### TypeScript AST には ChainExpression が無い

ここは Claude に tsc 6.0.3 で確認してもらった結果です。

TypeScript AST は、作りがまるごと違います。そもそも `ChainExpression` に当たるノードを持っていません。`SyntaxKind` の中から Chain を含む名前を探すと0件でした。代わりに `NodeFlags.OptionalChain` (値は64) というビットがあり、チェーンに属するノードそれぞれに立ちます。

TypeScript AST のノードは親を指していて循環するので、JSON のようにはそのまま出せません。そこで `ts.createSourceFile` で作った木を `ts.forEachChild` でたどり、ノードの種類 (`ts.SyntaxKind` の名前)、識別子の名前、`OptionalChain` が立っているかだけを出してもらいました。`a?.b!` はこうなります。

```
NonNullExpression
  PropertyAccessExpression  flags: OptionalChain
    Identifier "a"
    QuestionDotToken
    Identifier "b"
```

一番外側の `NonNullExpression` にはフラグが立っていません。`!` はチェーンの外側にいる、という扱いです。oxc と TSESTree では、一番外側が `ChainExpression` で、`TSNonNullExpression` はその内側でした。入れ子の順番が逆になっています。

入力が `a?.b!.c` だと、こうなります。

```
PropertyAccessExpression  flags: OptionalChain
  NonNullExpression  flags: OptionalChain
    PropertyAccessExpression  flags: OptionalChain
      Identifier "a"
      QuestionDotToken
      Identifier "b"
  Identifier "c"
```

今度は3つとも立っています。`!` がチェーンの途中にあれば、チェーンの一部になる。TypeScript AST は `!` の位置でそこを区別しますが、oxc と TSESTree は区別せず、`?.` を含む式の全体を `ChainExpression` で包んで、`TSNonNullExpression` はいつもその内側に入れます。

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

メンバーアクセスと呼び出しが並んでいるのは、ECMAScript のオプショナルチェーンとして当然です。3つめの腕だけが TS 固有で、しかもこれが無いと `a?.b!` の `TSNonNullExpression` が `ChainExpression` の外に出てしまいます。TypeScript AST と同じ形になってしまう、と言ってもいい。

後置の記号を読む腕より、この腕のほうが「誰に合わせているのか」をよく語っている気がします。パースそのものには要らない腕だからです。

## AST は1つで、JS と TS が混ざっている

ここまで `TSNullKeyword` や `TSLiteralType` のような TS 専用のノードを見てきましたが、oxc には TS 用の木と JS 用の木が別々にあるわけではありません。1本の木に両方のノードが混ざって生えています。

分かりやすいのがテンプレートリテラル型です。

```ts
type F = `abc`;
```

埋め込みが無いので、これはただの文字列リテラル型です。oxc の出力 (`Program` の外枠を外したもの) はこうなります。

```json
{
  "type": "TSTypeAliasDeclaration",
  "id": {
    "type": "Identifier",
    "decorators": [],
    "name": "F",
    "optional": false,
    "typeAnnotation": null,
    "start": 5,
    "end": 6
  },
  "typeParameters": null,
  "typeAnnotation": {
    "type": "TSLiteralType",
    "literal": {
      "type": "TemplateLiteral",
      "quasis": [
        {
          "type": "TemplateElement",
          "value": {
            "raw": "abc",
            "cooked": "abc"
          },
          "tail": true,
          "start": 9,
          "end": 14
        }
      ],
      "expressions": [],
      "start": 9,
      "end": 14
    },
    "start": 9,
    "end": 14
  },
  "declare": false,
  "start": 0,
  "end": 15
}
```

型のノードの中に、式のノードが直接入っています。しかもこの `TemplateLiteral` は、JavaScript のコードに出てくるテンプレートリテラルと同じ型です。

TSESTree の出力も同じで、`TSLiteralType` の中に `TemplateLiteral` が入ります。TypeScript AST (Claude に tsc 6.0.3 で確認してもらったもの) は `LiteralType` の中に `NoSubstitutionTemplateLiteral` が入る形で、箱と中身の名前が違うだけで、型の中に式のノードが入る点は同じです。

型定義のほうを見ても同じです。`oxc_ast` の `TSLiteralType` (`ast/ts.rs:215`) の `literal` フィールドの型は `TSLiteral` (`ast/ts.rs:226`) という列挙で、その選択肢に `TemplateLiteral` がいます。定義されている場所は `ast/js.rs:419`、つまり JavaScript 側のファイルです。逆向きもあって、変数宣言などが持つ `type_annotation` は TS 側のノードを指します。ファイルは分かれていても、型としては相互に乗り入れている。

ここが、実例1の見え方を変えます。oxc には、TSESTree のように TypeScript AST を ESTree 形式に直す段が存在しません。`--estree` という出力は、この1本の木をそのまま書き出したものです。だから形を合わせたければ、後から直すのではなく、作るときに合わせるしかない。null の判定がパーサーの match 式の腕に書いてあるのは、そこしか書く場所が無いからでもあります。

## まとめ

- oxc が出す AST の名前と形は TSESTree (typescript-eslint の ast-spec) に寄せてある。ただし TS ノードのフィールドの並び順は tsc に倣う、と `oxc_ast` のドキュメントコメントに書いてある
- null 型の木は TypeScript AST だけ違う。4.0から `LiteralType` で包むようになり、TSESTree はそれを剥がして昔の形を保ち、oxc は剥がした後の形を最初から作る
- 後置の `!` と `?.` の組み合わせも、括弧のノードを残すかどうかを除けば、oxc と TSESTree は一致した。TypeScript AST は `ChainExpression` を持たず、ノードにフラグを立てて表す
- oxc の AST は1本で、TS のノードの中に JS のノードが直接入る。変換の段が無いぶん、互換性への配慮がパーサーの match 式の腕として埋まっている

「tsc と同じものを Rust で速く作り直した」という話ではなく、「合わせる相手を選んだ」という話でした。どちらに合わせるかで木の形が変わるので、oxc の出力を読んでいて TypeScript AST と違うところに出会ったら、まず TSESTree 側を見ると答えがあることが多いです。

次回は、`1 + 1 as number / 2` という1行にまつわる事件です。`as` の優先順位が、7.0で意図的に変えられた話をします。

なお、この記事で自分で実際に読んだのは oxc のパーサーだけです。tsc と TSESTree の中身や、仕様の該当箇所は Claude に確認してもらったものなので、間違っていたら指摘してもらえると助かります。

---

_最終更新: 2026年10月03日_
