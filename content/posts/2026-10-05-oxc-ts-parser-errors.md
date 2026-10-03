---
title: oxcのTypeScriptパーサーを読む 第6回 そのエラー、誰が出してるの?
description: 間違ったTypeScriptを書いたとき、そのエラーを出すのはパーサーか、セマンティック解析か、型チェッカーか。同じエラーコードがoxcとtscで別の段から出てくる様子を、3つの入力で確かめます。
date: 2026-10-05
tags: ["コンパイラ", "パーサー", "oxc", "TypeScript", "oxc-ts-parser"]
draft: true
---

この記事では、間違った TypeScript を書いたときにそのエラーを出しているのが oxc のパーサーなのか、セマンティック解析 (`oxc_semantic`) なのか、それとも tsc の型チェッカーにしか出せないのかを、3つの入力で確かめます。

## 今回読むファイル

読んだのは oxc の rev `1aa5ec11ce` です。行番号はすべてこのリビジョンのもので、ズレたときに探せるように関数名とセットで書きます。今回おもに開くのはこのあたりです。

```text
crates/oxc_parser/src/ts/types.rs               1,690行   型のパーサー。タプル型の並び順の検査
crates/oxc_semantic/src/checker/typescript.rs     343行   セマンティック解析のTS向けの検査
crates/oxc_semantic/src/builder.rs              2,956行   セマンティック解析の本体。検査を呼ぶ場所
tasks/coverage/src/typescript/constants.rs        646行   互換性テストの除外リスト
```

自分で読んだのは1つ目のパーサーだけです。2つ目から4つ目の `oxc_semantic` と `tasks/coverage` の中身は、Claude に確認してもらいました。比較に使う tsc 6.0.3 の実行結果と、Go 版の tsc のソース ([microsoft/TypeScript](https://github.com/microsoft/TypeScript/tree/f29aeb9f825d96feea27841f3f7342dbf0df68a8/tsc) の rev `f29aeb9f` の `tsc/` 以下) も、Claude に確認してもらったものです。

## 事前知識: パーサー、セマンティック解析、型チェッカー

コンパイラがソースコードを検査するとき、仕事はおおまかに3段に分かれます。

1. パーサーは、ソースの文字列を読んで AST (抽象構文木) を作ります。文法に合わない書き方は、ここでエラーにします
2. セマンティック解析は、できた AST を歩いて、スコープ (名前が見える範囲) とシンボル (宣言された名前) の表を作ります。「この `x` はどの宣言を指すか」を決める段です。木の中の位置関係を見れば分かる検査も、ここでできます
3. 型チェッカーは、型を解決して検査します。型エイリアスの中身を展開したり、代入できるかを調べたりする段です

tsc では、この3段にそれぞれパーサー (parser)、バインダー (binder)、チェッカー (checker) という名前が付いています。たとえば同じブロックで `let x` を2回宣言したときのエラー (TS2451) は、バインダーが出します (Claude に確認してもらいました)。

oxc では、パーサーが `oxc_parser`、セマンティック解析が `oxc_semantic` という別々のクレートです。型チェッカーにあたる段は持っていません。`oxc_type_checker` というクレートはありますが、[冒頭のドキュメントコメント](https://github.com/oxc-project/oxc/blob/1aa5ec11ce0dcbb0da7799e777c2492211908fbb/crates/oxc_type_checker/src/lib.rs#L1-L6)に「It does _not_ type check anything yet.」とあって、今はまだ足場だけです (Claude に確認してもらいました)。

もう1つ、TS1265 のような番号について。これはエラーメッセージ1つ1つに振られている番号で、tsc の [`diagnosticMessages.json`](https://github.com/microsoft/TypeScript/blob/f29aeb9f825d96feea27841f3f7342dbf0df68a8/tsc/internal/diagnostics/diagnosticMessages.json#L858-L861) に、メッセージの文と組で定義されています (Go 版の tsc のもの)。

```json
"A rest element cannot follow another rest element.": {
    "category": "Error",
    "code": 1265
},
```

oxc もこの番号を流用していて、tsc と同じエラーには同じ番号を付けて出します。パーサーの `diagnostics.rs:28` にあるヘルパーがこれです。

```rust
fn ts_error<M>(code: &'static str, message: M) -> OxcDiagnostic
where
    M: Into<Cow<'static, str>>,
{
    OxcDiagnostic::error(message).with_error_code("TS", code)
}
```

番号が同じなので、同じ入力を tsc と oxc に食わせて、どちらが同じエラーを出すか、出すならどの段から出すかを比べられます。

## tsc でどの段が出したかを見分ける

tsc の CLI はエラーを出した段を表示しないので、Claude に tsc 6.0.3 のコンパイラ API で次のスクリプトを書いて走らせてもらいました。

```js
// who.cjs
const ts = require("typescript");

for (const file of process.argv.slice(2)) {
  const program = ts.createProgram([file], { noEmit: true });
  const sourceFile = program.getSourceFile(file);
  const syntactic = program.getSyntacticDiagnostics(sourceFile);
  const semantic = program.getSemanticDiagnostics(sourceFile);
  console.log(`===== ${file}`);
  for (const d of syntactic) {
    console.log(`parser  TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  }
  for (const d of semantic) {
    const stage = sourceFile.bindDiagnostics.includes(d) ? "binder " : "checker";
    console.log(`${stage} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  }
}
```

パーサーのエラーは `getSyntacticDiagnostics` が返します。`getSemanticDiagnostics` はバインダーとチェッカーのエラーをまとめて返すので、ソースファイルの `bindDiagnostics` に入っているものをバインダー、残りをチェッカーとして出し分けています。

## 下準備: oxc のパーサーとセマンティック解析を手元で走らせる

oxc 側の結果は、次の手順で手元でも同じものが出せます。Rust のツールチェーンが入っていれば動きます。

まず oxc を記事と同じリビジョンで取ってきます。履歴まで丸ごと clone すると時間がかかるので、このコミットだけを `--depth 1` で浅く取ります。

```bash
git init oxc
git -C oxc fetch --depth 1 https://github.com/oxc-project/oxc.git 1aa5ec11ce0dcbb0da7799e777c2492211908fbb
git -C oxc checkout FETCH_HEAD
```

次に、入力を4つのファイルに書いて、パーサーのサンプルとセマンティック解析のサンプルの両方に流します。

```bash
cd oxc
printf '%s\n' 'type A = [...string[], ...number[]];' > /tmp/rest.ts
printf '%s\n' 'type A = [...string[], ...number[]];' 'let x = ;' > /tmp/rest-and-syntax.ts
printf '%s\n' 'type S = string[];' 'type A = [...S, ...S];' > /tmp/alias.ts
printf '%s\n' 'type C<T> = keyof infer U;' > /tmp/infer.ts
for f in rest rest-and-syntax alias infer; do
  echo "===== $f parser"
  cargo run -q -p oxc_parser --example parser -- /tmp/$f.ts
  echo "===== $f semantic"
  cargo run -q -p oxc_semantic --example semantic -- /tmp/$f.ts
done
```

2つのサンプルは、出力の作法が違います。パーサーのサンプル (`crates/oxc_parser/examples/parser.rs`) は、エラーがあればそれを並べて最後に `Parsed with Errors.`、無ければ `Parsed Successfully.` と出します。セマンティック解析のサンプル (`crates/oxc_semantic/examples/semantic.rs`) は、まずパースして、パーサーがエラーを出したら `Parsing failed:` に続けてそれを出して終わります。パースが通ったときだけセマンティック解析に進み、そこでエラーが出れば `Semantic analysis failed:` に続けて出し、出なければ何も表示しません。

## 結果の一覧

先に結果を並べておきます。

| 入力                                          | 番号   | tsc 6.0.3 で出す段 | oxc で出す段       |
| --------------------------------------------- | ------ | ------------------ | ------------------ |
| `type A = [...string[], ...number[]];`        | TS1265 | チェッカー         | パーサー           |
| `type S = string[];` `type A = [...S, ...S];` | TS1265 | チェッカー         | どこも出さない     |
| `type C<T> = keyof infer U;`                  | TS1338 | チェッカー         | セマンティック解析 |

tsc の列はどれもチェッカーです。一方の oxc の列は、パーサー、どこも出さない、セマンティック解析と、3行ともばらばらです。以下、1行ずつ見ていきます。

## 実例1: タプルの rest が2つ並ぶ

タプル型で、`...` の付いた rest 要素を2つ続けて書きます。

```ts
type A = [...string[], ...number[]];
```

rest 要素はタプルの中に1つしか置けないので、これはエラーです。oxc のパーサーのサンプルに流すと、こう出ます。

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

パーサーの段でもう TS1265 が出ています。

tsc の結果は、Claude に先ほどのスクリプトで確かめてもらうとこうでした。

```text
===== rest.ts
checker TS1265 A rest element cannot follow another rest element.
```

同じ番号、同じメッセージですが、tsc ではチェッカーが出しています。

### oxc のパーサーは、書かれた見た目で判定する

oxc の検査は、タプル型を読む `parse_tuple_type` (`ts/types.rs:967`) の中にあります。要素を1つ読むたびに呼ばれるクロージャの、rest 要素を数える部分がこちらです (クロージャの外側と、このあとに続く省略可能な要素の並び順の検査は省きました)。

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

rest 要素として数えるのは、`...` の後ろが `X[]` という形の配列型 (`TSArrayType`) か、`Array` という名前の型参照のときだけです。2つ目が来た時点で、1つ目の位置 (`seen_rest_span`) と2つ目の位置をラベルにしてエラーを積みます。

冒頭のコメントにあるとおり、`...T` のような型パラメータは数えません。コメントによると、中身の分からない型は展開されうるから、という理由です。

ここで使っている `me.error` は、エラーを1件ためるだけでパースは止めません。AST は最後まで作られます。

### tsc のチェッカーは、型を解決してから数える

tsc 側は、Claude に Go 版の tsc の [`checkTupleType`](https://github.com/microsoft/TypeScript/blob/f29aeb9f825d96feea27841f3f7342dbf0df68a8/tsc/internal/checker/checker.go#L3279-L3300) (`checker.go:3279`) を見てもらいました。冒頭のループがこうです (ループの後ろは省きました)。

```go
func (c *Checker) checkTupleType(node *ast.Node) {
	seenOptionalElement := false
	seenRestElement := false
	elements := node.Elements()
	for _, e := range elements {
		flags := c.getTupleElementFlags(e)
		if flags&ElementFlagsVariadic != 0 {
			t := c.getTypeFromTypeNode(e.Type())
			if !c.isArrayLikeType(t) {
				c.error(e, diagnostics.A_rest_element_type_must_be_an_array_type)
				break
			}
			if c.isArrayType(t) || isTupleType(t) && t.TargetTupleType().combinedFlags&ElementFlagsRest != 0 {
				flags |= ElementFlagsRest
			}
		}
		if flags&ElementFlagsRest != 0 {
			if seenRestElement {
				c.grammarErrorOnNode(e, diagnostics.A_rest_element_cannot_follow_another_rest_element)
				break
			}
			seenRestElement = true
```

ループは、`...` の付いた要素を見つけると、`getTypeFromTypeNode` でその型を解決し、解決した結果が配列型か、rest 要素を含むタプル型のときに限って、数に入れます。数え方の骨組みは oxc と同じで、違うのは「配列かどうか」を書かれた見た目で決めるか、型を解決して決めるかです。

型を解決するのはチェッカーの仕事なので、tsc ではこの検査がチェッカーにあります。oxc はパーサーの手の届く範囲、つまり見た目で近似して、パーサーで出しています。

### 構文エラーと同居させると、tsc は黙る

エラーを出す段が違うと、ほかのエラーと一緒になったときの振る舞いも変わります。さっきの1行の下に、別の構文エラーを足してみます。

```text
type A = [...string[], ...number[]];
let x = ;
```

oxc のパーサーは、両方を出します。

```text
  x TS(1265): A rest element cannot follow another rest element.
   ,-[1:11]
 1 | type A = [...string[], ...number[]];
   :           ^^^^^|^^^^^  ^^^^^|^^^^^
   :                |            `-- Second rest element here
   :                `-- First seen here
 2 | let x = ;
   `----


  x Unexpected token
   ,-[2:9]
 1 | type A = [...string[], ...number[]];
 2 | let x = ;
   :         ^
   `----

Parsed with Errors.
```

tsc は、パーサーのエラーだけになりました (Claude に確認してもらいました)。

```text
===== rest-and-syntax.ts
parser  TS1109 Expression expected.
```

TS1265 が消えたのは、チェッカーがこのエラーを `grammarErrorOnNode` で出しているからです。Go 版の tsc の [`grammarchecks.go:38`](https://github.com/microsoft/TypeScript/blob/f29aeb9f825d96feea27841f3f7342dbf0df68a8/tsc/internal/checker/grammarchecks.go#L38-L45) を見てもらうと、こうなっていました。

```go
func (c *Checker) grammarErrorOnNode(node *ast.Node, message *diagnostics.Message, args ...any) bool {
	sourceFile := ast.GetSourceFileOfNode(node)
	if !c.hasParseDiagnostics(sourceFile) {
		c.error(node, message, args...)
		return true
	}
	return false
}
```

同じファイルにパーサーのエラーが1件でもあれば、出さずに帰ります。Go 版の tsc は、チェッカーの中に文法の検査 (grammar check) を集めたこの2,237行のファイルを持っていて、そこで `grammarErrorOnNode` を通して出すエラーは、パースが通ったファイルにだけ出る、という扱いです。

## 実例2: エイリアスを挟むと、oxc ではどこも出さない

実例1の `string[]` に名前を付けて、エイリアス経由で書きます。

```ts
type S = string[];
type A = [...S, ...S];
```

エイリアスの `S` の中身は配列なので、tsc にとってはさっきと同じエラーです (Claude に確認してもらいました)。

```text
===== alias.ts
checker TS1265 A rest element cannot follow another rest element.
```

oxc のパーサーのサンプルは、これを通します。

```text
Parsed Successfully.
```

セマンティック解析のサンプルも、何も表示しません。

理由はさっきのパーサーのコードにそのまま書いてあります。`...S` の `S` は型参照ですが、名前が `Array` ではないので、rest として数えられません。`S` が `string[]` だと知るには型エイリアスを解決しなければならず、それは型チェッカーの仕事です。oxc のセマンティック解析も型は解決しないので、ここで拾う段がありません。

### oxc の互換性テストでの数字

こういう取りこぼしがどのくらいあるかは、oxc のリポジトリにある互換性テストの集計から読めます。tsc 自身のテストケースを oxc に流して、結果をスナップショットに残しているものです。その [`tasks/coverage/snapshots/parser_typescript.snap`](https://github.com/oxc-project/oxc/blob/1aa5ec11ce0dcbb0da7799e777c2492211908fbb/tasks/coverage/snapshots/parser_typescript.snap#L3-L6) の先頭はこうなっていました。

```text
parser_typescript Summary:
AST Parsed     : 9783/9783 (100.00%)
Positive Passed: 9783/9783 (100.00%)
Negative Passed: 1649/2636 (62.56%)
```

Positive は正しいコードをエラーなく通せたか、Negative はエラーになるべきコードで何らかのエラーを出せたかです。正しいコードは全部通し、エラーになるべきコードは6割強で出せている、という数字です。

この集計の中身は Claude に確認してもらいました。Negative の分母の 2636 は、tsc のエラーを出すテストの全部ではありません。型推論の結果が要るテストやコンパイラオプションに依存するテストは、除外リスト (`tasks/coverage/src/typescript/constants.rs`) で最初から外してあります。また、この集計はパーサーの後ろでセマンティック解析も走らせていて、セマンティック解析のエラーも数に入っています。

同じファイルの [`constants.rs:46`](https://github.com/oxc-project/oxc/blob/1aa5ec11ce0dcbb0da7799e777c2492211908fbb/tasks/coverage/src/typescript/constants.rs#L46-L49) には、今回の話そのものの注意書きがありました。

```rust
// - The same error code may be emitted from different TSC components
//   - Sometimes detectable at parse time, sometimes revealed by type inference results
//   - When OXC has limited support for these, we cannot ignore it by error code alone
//     - We have to ignore by file path, then manually add some parts separately to `misc` cases
```

同じエラーコードでも tsc の別々の部品から出ることがあり、パースの時点で分かる場合も、型推論の結果で初めて分かる場合もある。だからエラーコードだけでは除外できず、ファイル単位で除外している、という内容です。TS1265 はまさにその例で、`...string[]` ならパースの時点で分かり、`...S` なら型を解決して初めて分かります。

oxc の周りで `[...S, ...S]` を拾えるとしたら、リンターの oxlint の型情報を使うモードです。[ドキュメント](https://github.com/oxc-project/website/blob/82f564eca3a04b10ba400115b84876d3af4cff51/src/docs/guide/usage/linter/type-aware.md)によると、このモードは別の実行ファイルの tsgolint が担当していて、これが Go 版の tsc でプログラムを組み立てます。さらに `--type-check` を付けると、型チェッカーのエラーもリントの結果と一緒に出せるとあります。CLI の [`--type-check` の説明](https://github.com/oxc-project/oxc/blob/1aa5ec11ce0dcbb0da7799e777c2492211908fbb/apps/oxlint/src/command/lint.rs#L57-L59)は「Enable experimental type checking (includes TypeScript compiler diagnostics)」で、まだ実験的な扱いです (ここは Claude に確認してもらったもので、実際には走らせていません)。

## 実例3: `keyof infer U` は、oxc ではセマンティック解析が出す

最後は `infer` です。`infer U` は条件型 (`T extends X ? A : B`) の `extends` の右側でだけ使える書き方で、それ以外の場所に書くとエラー TS1338 になります。

```text
type C<T> = keyof infer U;
```

oxc のパーサーのサンプルは、これを通します。

```text
Parsed Successfully.
```

パーサーの中で `infer` を読むのは、`keyof` などの型演算子を読む `parse_type_operator_or_higher` (`ts/types.rs:282`) です。

```rust
fn parse_type_operator_or_higher(&mut self) -> TSType<'a> {
    match self.cur_kind() {
        Kind::KeyOf => self.parse_type_operator(TSTypeOperatorOperator::Keyof),
        Kind::Unique => self.parse_type_operator(TSTypeOperatorOperator::Unique),
        Kind::Readonly => self.parse_type_operator(TSTypeOperatorOperator::Readonly),
        Kind::Infer => self.parse_infer_type(),
        _ => self.context_remove(
            Context::DisallowConditionalTypes,
            Self::parse_postfix_type_or_higher,
        ),
    }
}
```

この `infer` の腕 (`Kind::Infer`) は、今どこにいるかを見ずに `parse_infer_type` を呼びます。`keyof` の後ろでも、条件型の外でも、型演算子が書ける場所なら `infer` は読めてしまいます。

セマンティック解析のサンプルに流すと、ここでエラーになります。

```text
Semantic analysis failed:


  x TS(1338): 'infer' declarations are only permitted in the 'extends' clause
  | of a conditional type.
   ,----
 1 | type C<T> = keyof infer U;
   :                   ^^^^^^^
   `----
```

tsc では、これもチェッカーでした (Claude に確認してもらいました)。

```text
===== infer.ts
checker TS1338 'infer' declarations are only permitted in the 'extends' clause of a conditional type.
```

### 祖先をさかのぼる検査は、tsc と oxc でほぼ同じ形

ここから先の `oxc_semantic` と Go 版の tsc のコードは、Claude に確認してもらったものです。

oxc の検査は [`check_ts_infer_type`](https://github.com/oxc-project/oxc/blob/1aa5ec11ce0dcbb0da7799e777c2492211908fbb/crates/oxc_semantic/src/checker/typescript.rs#L74-L84) (`checker/typescript.rs:74`) です。

```rust
pub fn check_ts_infer_type<'a>(infer_type: &TSInferType<'a>, ctx: &SemanticBuilder<'a>) {
    let is_in_conditional_extends_clause = ctx.ancestry().ancestor_kinds().any(|kind| {
        kind.as_ts_conditional_type().is_some_and(|conditional| {
            conditional.extends_type.span().contains_inclusive(infer_type.span)
        })
    });

    if !is_in_conditional_extends_clause {
        ctx.error(diagnostics::infer_declaration_only_permitted_in_extends_clause(infer_type.span));
    }
}
```

この関数は、`infer` のノードから祖先を1つずつさかのぼって、条件型があり、しかも `infer` がその `extends` の右側の範囲に入っているかを調べます。祖先に条件型がいるだけでは足りず、`? A : B` の側にいるかもしれないので、範囲まで確かめています。

Go 版の tsc の [`checkInferType`](https://github.com/microsoft/TypeScript/blob/f29aeb9f825d96feea27841f3f7342dbf0df68a8/tsc/internal/checker/checker.go#L3334-L3339) (`checker.go:3334`) の冒頭はこうです (後ろは省きました)。

```go
func (c *Checker) checkInferType(node *ast.Node) {
	if ast.FindAncestor(node, func(n *ast.Node) bool {
		return n.Parent != nil && n.Parent.Kind == ast.KindConditionalType && n.Parent.AsConditionalTypeNode().ExtendsType == n
	}) == nil {
		c.grammarErrorOnNode(node, diagnostics.X_infer_declarations_are_only_permitted_in_the_extends_clause_of_a_conditional_type)
	}
```

こちらも祖先をさかのぼり、親が条件型で、自分がその `ExtendsType` である祖先を探しています。oxc は範囲の包含で、tsc は親子のつながりで判定していますが、やっていることは同じです。どちらも型を解決していません。木の形だけで決まる検査なので、型チェッカーを持たない oxc でも同じものが書けます。

tsc はこれをチェッカーに置き、oxc はセマンティック解析に置きました。その検査は、セマンティック解析が木を歩いてノードを抜けるときに呼ばれます。`builder.rs:866` の `leave_node` です。

```rust
/// Both this function and `checker::check` must be inlined. Each `visit_*` method calls
/// `leave_node` with a statically known `AstKind`, so inlining allows the compiler to
/// constant-fold `checker::check`'s match, eliminating all non-matching arms.
#[expect(
    clippy::inline_always,
    reason = "enables compile-time match elimination in checker::check"
)]
#[inline(always)]
fn leave_node(&mut self, kind: AstKind<'a>) {
    if self.check_syntax_error {
        checker::check(kind, self);
    }
    self.pop_ast_node();
}
```

スコープとシンボルの表を作るために、どうせ木を1周するので、そのついでに検査しているわけです。

### この検査は、頼まないと走らない

上の `leave_node` の `if` にあるとおり、この検査は `check_syntax_error` が立っているときだけ走ります。それを立てる `with_check_syntax_error` (`builder.rs:219`) のドキュメントコメントはこうです。

```rust
/// Enable/disable additional syntax checks.
///
/// Set this to `true` to enable additional syntax checks. Without these,
/// there is no guarantee that the parsed program follows the ECMAScript
/// spec.
///
/// By default, this is `false`.
#[must_use]
pub fn with_check_syntax_error(mut self, yes: bool) -> Self {
    self.check_syntax_error = yes;
    self
}
```

これを有効にしないと、パースした結果が ECMAScript の仕様に従っている保証は無い、と書いてあります。既定値はオフです。セマンティック解析のサンプルが使っている `SemanticBuilder::new_compiler()` は、これをオンにする設定でした。

つまり oxc では、`oxc_parser` が通したことは「文法として正しい」ことを意味しません。今回の TS1338 は、パーサーとセマンティック解析の両方を、検査をオンにして通したときに初めて出ます。

## まとめ

- 同じ TS1265 が、tsc ではチェッカーから、oxc ではパーサーから出ていた。「配列かどうか」を書かれた見た目で近似し、型を解決しないぶん手前の段で出している
- 見た目で近似するので、`type S = string[]` のようなエイリアスを挟むと oxc はどの段でも出さない。型を解決しないと分からないエラーは、手の届く範囲の外にある
- TS1338 (`infer` の位置) は、tsc ではチェッカー、oxc ではセマンティック解析が、どちらも祖先をさかのぼる同じ形の検査で出していた。型の要らない検査なので、型チェッカーを持たなくても同じことができる
- エラーの番号は tsc と oxc で共通だが、番号を見ても、どの段が出したかは分からない

どの段がエラーを出すかは、判定に何の情報が要るかで決まっているように見えます。木の中の位置関係で分かる TS1338 は、型チェッカーを持たない oxc でも、tsc と同じ検査をセマンティック解析で出せる。型を解決して初めて分かる TS1265 は、見た目で分かる範囲だけをパーサーで近似して、残りは出さない。tsc は、この2つをどちらもチェッカーで出していました。

次回は「tscの移植の、引き算と足し算」です。oxc が移さずに捨てたものと、逆に移植元には無い近道を、パーサーのコードの中から拾っていきます。

なお、この記事で自分で実際に読んだのは oxc のパーサーだけです。`oxc_semantic` と tsc の中身、テストの集計は Claude に確認してもらったものなので、間違っていたら指摘してもらえると助かります。
