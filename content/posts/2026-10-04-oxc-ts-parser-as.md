---
title: oxcのTypeScriptパーサーを読む 第5回 1 + 1 as number / 2 事件
description: 型を消すと値が変わってしまう1行をきっかけに、TypeScript 7.0は as の後ろに強い演算子を続ける書き方をエラーにしました。その判定がoxcのパーサーのどこに入ったのかと、エラーがなぜ「セミコロンが無い」という形で出るのかを読みます。
date: 2026-10-04
tags: ["コンパイラ", "パーサー", "oxc", "TypeScript", "oxc-ts-parser"]
draft: true
---

この記事では、`1 + 1 as number / 2` という1行が TypeScript 7.0 でエラーになった経緯と、同じ変更を取り込んだ oxc のパーサーのコードを読みます。

## 今回読むファイル

読んだのは oxc の rev `1aa5ec11ce` です。行番号はすべてこのリビジョンのもので、ズレたときに探せるように関数名とセットで書きます。今回おもに開くのはこのあたりです。

```text
crates/oxc_parser/src/js/expression.rs    1,799行   二項演算のループと as の腕
crates/oxc_parser/src/js/operator.rs        130行   演算子ごとの優先順位の表
crates/oxc_syntax/src/precedence.rs          86行   優先順位の定義
crates/oxc_parser/src/cursor.rs             638行   セミコロンの自動挿入
crates/oxc_parser/src/js/declaration.rs     241行   変数宣言の終わり
```

oxc の結果は、次の「下準備」の手順で手元でも同じものが出せます。TypeScript 本体 (tsc 5.9.3 / 6.0.3 / 7.0.2 と、7.1 の開発版) を動かした結果、Go 版の tsc のソース、issue と PR の経緯、事前知識の節の TypeScript 側の説明は、Claude に確認してもらったものです。

## 下準備: oxc に式を流す

Rust のツールチェーンが入っていれば動きます。まず oxc を記事と同じリビジョンで取ってきます。履歴まで丸ごと clone すると時間がかかるので、このコミットだけを `--depth 1` で浅く取ります (コミットを指定して取るので、SHA は省略せずに書きます)。

```bash
git init oxc
git -C oxc fetch --depth 1 https://github.com/oxc-project/oxc.git 1aa5ec11ce0dcbb0da7799e777c2492211908fbb
git -C oxc checkout FETCH_HEAD
```

入力を1つずつファイルに書いて、AST をダンプする `parser` サンプルに流します。パースが通ったかどうかとエラーだけを見るときは、オプションを付けません。

```bash
cd oxc
for src in '1 + 1 as number / 2;' 'const n = 1 + 1 as number / 2;' '1 * 1 as number + 2;' '2 ** 3 as number ** 2;'; do
  printf '%s\n' "$src" > /tmp/x.ts
  echo "===== $src"
  cargo run -q -p oxc_parser --example parser -- /tmp/x.ts
done
```

木の形を見るときは、最後に `--estree` を付けます。

```bash
printf '%s\n' '1 * 1 as number + 2;' > /tmp/x.ts
cargo run -q -p oxc_parser --example parser -- /tmp/x.ts --estree
```

本文に出てくる oxc の結果は、どれもこのやり方で出したものです。

## 事前知識

### `as` は、型を消せば JavaScript に戻る

TypeScript の `as` は、型アサーションの構文です。`x as number` と書くと、「`x` を `number` 型として扱ってほしい」とコンパイラに伝えます。実行時には何もしないので、tsc が JavaScript を出力するときは `as number` の部分を取り除くだけです。

この取り除く作業を、もっと素朴にやる道具があります。型の部分を同じ文字数の空白に置き換えて、残りをそのまま JavaScript として実行する方式です。行と列の位置がずれないので、ソースマップが要りません。たとえば ts-blank-space がこの方式です。

tsc 側には、こうした素朴な型の除去で困る構文をエラーにする `erasableSyntaxOnly` というオプションがあります。`enum` のように、型を消すだけでは JavaScript にならない構文を禁止するものです。

### 二項演算子の優先順位と Pratt パーサー

たとえば `1 + 2 * 3` が `1 + (2 * 3)` になるのは、`*` が `+` より強く結合するからです。この結合の強さを、演算子の優先順位と呼びます。

oxc は、二項演算子をこの優先順位の表で読む、Pratt パーサーと呼ばれる方式を使っています。この方式では、演算子ごとの結合の強さ (binding power) を数値で持ち、1つのループと再帰だけで、すべての二項演算子を読み分けます。考え方は「右辺を読んでいる途中で、今の演算子より弱い演算子が来たら、そこで止まって呼び出し元に返す」です。

oxc の優先順位の表は `js/operator.rs` にあります。

```rust
static PRECEDENCE_TABLE: [Option<Precedence>; 256] = {
    let mut table = [None; 256];
    table[Kind::Question2 as usize] = Some(Precedence::NullishCoalescing);
    table[Kind::Pipe2 as usize] = Some(Precedence::LogicalOr);
    table[Kind::Amp2 as usize] = Some(Precedence::LogicalAnd);
    table[Kind::Pipe as usize] = Some(Precedence::BitwiseOr);
    table[Kind::Caret as usize] = Some(Precedence::BitwiseXor);
    table[Kind::Amp as usize] = Some(Precedence::BitwiseAnd);
    table[Kind::Eq2 as usize] = Some(Precedence::Equals);
    table[Kind::Eq3 as usize] = Some(Precedence::Equals);
    table[Kind::Neq as usize] = Some(Precedence::Equals);
    table[Kind::Neq2 as usize] = Some(Precedence::Equals);
    table[Kind::LAngle as usize] = Some(Precedence::Compare);
    table[Kind::RAngle as usize] = Some(Precedence::Compare);
    table[Kind::LtEq as usize] = Some(Precedence::Compare);
    table[Kind::GtEq as usize] = Some(Precedence::Compare);
    table[Kind::Instanceof as usize] = Some(Precedence::Compare);
    table[Kind::In as usize] = Some(Precedence::Compare);
    table[Kind::ShiftLeft as usize] = Some(Precedence::Shift);
    table[Kind::ShiftRight as usize] = Some(Precedence::Shift);
    table[Kind::ShiftRight3 as usize] = Some(Precedence::Shift);
    table[Kind::Plus as usize] = Some(Precedence::Add);
    table[Kind::Minus as usize] = Some(Precedence::Add);
    table[Kind::Star as usize] = Some(Precedence::Multiply);
    table[Kind::Slash as usize] = Some(Precedence::Multiply);
    table[Kind::Percent as usize] = Some(Precedence::Multiply);
    table[Kind::Star2 as usize] = Some(Precedence::Exponentiation);
    table[Kind::As as usize] = Some(Precedence::Compare);
    table[Kind::Satisfies as usize] = Some(Precedence::Compare);
    table
};
```

最後の2行が TypeScript の分です。`as` と `satisfies` は、`<` や `instanceof` と同じ `Compare` (比較) の段に置かれています。`Precedence` の定義 (`precedence.rs`) では `Compare` が13、`Add` (`+` と `-`) が15、`Multiply` (`*` `/` `%`) が16で、数字が大きいほど強く結合します。つまり `as` は `+` よりも `*` よりも弱い。Go 版の tsc でも、`as` と `satisfies` は `<` などの関係演算子と同じ段でした (Claude に確認してもらいました)。

## 事件: 型を消すと値が変わる

ここから先の経緯は、Claude に issue と PR を確認してもらった内容です。

2026年6月2日、Rob Palmer さんが TypeScript に [microsoft/TypeScript#63527](https://github.com/microsoft/TypeScript/issues/63527)「`erasableSyntaxOnly` should error on unerasable `as`/`satisfies`」を立てました。中身は次の1行です。

```text
console.log(1 + 1 as number / 2);
```

tsc はこれを `console.log((1 + 1) / 2);` と出力します。値は1です。ところが `as number` を空白に置き換えると `1 + 1           / 2` になり、JavaScript としては `1 + (1 / 2)`、値は1.5です。それなのに `erasableSyntaxOnly` を付けた tsc 6.0.3 がエラーを出さない、という報告でした。

もとは qnighy さんが ts-blank-space に報告した問題 ([bloomberg/ts-blank-space#62](https://github.com/bloomberg/ts-blank-space/issues/62)) で、issue の本文には、先にエラーを出すよう直したものとして ts-blank-space、SWC、Amaro (Node.js の TypeScript 対応に使われているパッケージ) が挙がっています。

Claude に tsc 5.9.3 と 6.0.3 で試してもらうと、どちらも `erasableSyntaxOnly` を付けてもエラーは出ず、出力は `(1 + 1) / 2` でした。

コメント欄には、`as` の優先順位はもっと高いと思っていた、どこに書いてあるのか探したが見つからなかった、という反応が並びます。TypeScript チームの Ryan Cavanaugh さんも、チームで話し合った結果の[まとめ](https://github.com/microsoft/TypeScript/issues/63527#issuecomment-4606483396)にこう書いていました。

> We shipped _what_ precedence??

## なぜ `/ 2` は `1 + 1` 全体にかかるのか

優先順位の表で、`as` が弱いことは確かめました。ただ、低いというだけなら、`/ 2` は `number` の側にくっつきそうにも見えます。`1 + 1 < 3 / 2` が `(1 + 1) < (3 / 2)` になるように。そうならない理由は、oxc のコードを読むとはっきりします。

### 二項演算のループ

二項演算を読む本体は `parse_binary_expression_rest` (`js/expression.rs:1322`) です。冒頭はこうなっています (ループの途中から先は省略しています)。

```rust
/// Section 13.6 - 13.13 Binary Expression
fn parse_binary_expression_rest(
    &mut self,
    lhs_start: u32,
    lhs: Expression<'a>,
    lhs_parenthesized: bool,
    min_precedence: Precedence,
) -> Expression<'a> {
    // Pratt Parsing Algorithm
    // <https://matklad.github.io/2020/04/13/simple-but-powerful-pratt-parsing.html>
    let mut lhs = lhs;
    // Precedence of the operator that produced the running left-hand operand, used to detect
    // `as`/`satisfies` assertions that cannot be erased. `None` until a binary/logical operator
    // has been consumed in this loop, matching TypeScript where the initial operand (from unary
    // parsing) is never a binary expression.
    let mut last_operand_precedence: Option<Precedence> = None;
    loop {
        // re-lex for `>=` `>>` `>>>`
        // This is needed for jsx `<div>=</div>` case
        let kind = self.re_lex_right_angle();

        let Some(left_precedence) = kind_to_precedence(kind) else { break };

        let stop = if left_precedence.is_right_associative() {
            left_precedence < min_precedence
        } else {
            left_precedence <= min_precedence
        };

        if stop {
            break;
        }
```

コメントにあるとおり、Pratt パーサーです。引数の `min_precedence` は、呼び出し元がいま右辺を読んでいる演算子の強さです。ループの頭で次のトークンの優先順位 `left_precedence` を表から引き、それが `min_precedence` 以下なら (右結合の演算子なら未満なら) `break` して、ここまでの左辺を呼び出し元に返します。途中で宣言している `last_operand_precedence` は、2026年6月に足された変数です。あとの節で読みます。

普通の二項演算子なら、ループの後半でこう読みます (`js/expression.rs:1393`)。

```rust
self.bump_any(); // bump operator
let rhs_start = self.cur_start();
let rhs = self.parse_binary_expression_or_higher(left_precedence);
```

演算子を食べて、右辺を再帰で読みます。再帰には今の演算子の強さが渡るので、それより強い演算子は右辺の中に取り込まれます。`1 + 1 < 3 / 2` の `/ 2` が `3` の側に付くのは、この再帰が飲み込むからです。

### `as` の腕は、右辺を型として読む

一方で `as` と `satisfies` は、同じループの中で別の腕に入ります (`js/expression.rs:1361`)。

```rust
if matches!(kind, Kind::As | Kind::Satisfies) {
    if self.cur_token().is_on_new_line() {
        break;
    }
    self.bump_any();
    let type_annotation = self.parse_ts_type();
    let span = self.end_span(lhs_start);
    lhs = if kind == Kind::As {
        if !self.is_ts {
            self.error(diagnostics::as_in_ts(span));
        }
        Expression::new_ts_as_expression(span, lhs, type_annotation, self)
    } else {
        if !self.is_ts {
            self.error(diagnostics::satisfies_in_ts(span));
        }
        Expression::new_ts_satisfies_expression(span, lhs, type_annotation, self)
    };
    // When we have `a ## b as T` or `a ## b satisfies T`, where `##` is some binary
    // operator, stop parsing on any following operator with higher precedence than `##`
    // because continuing would make it impossible to erase the `as` or `satisfies`
    // without changing the meaning of the expression.
    // See <https://github.com/microsoft/TypeScript/issues/63527>.
    if let Some(last_precedence) = last_operand_precedence
        && let Some(next_precedence) = kind_to_precedence(self.re_lex_right_angle())
        && next_precedence > last_precedence
    {
        break;
    }
    continue;
}
```

右辺を読むのが `parse_binary_expression_or_higher` の再帰ではなく、型のパーサーの入口 `parse_ts_type` (`ts/types.rs:15`) です。`as` の右側は式ではなく型だからです。読み終えたら左辺をまるごと `TSAsExpression` で包み、`continue` で同じループの頭に戻ります。最後の `if` が2026年6月に足された部分なので、いったん無いものとして読みます。

この `if` が無かったころの動きで、`1 + 1 as number / 2` を追うとこうなります。文の中の式を読むときは、代入式を読む `parse_assignment_expression_or_higher` が、`parse_binary_expression_or_higher` に一番弱い `Comma` を渡して読み始めます (`js/expression.rs:1522`)。

1. 最初の `1` を読み、ループで `+` を見る。`Add` は `Comma` より強いので食べて、右辺を `parse_binary_expression_or_higher(Add)` で読む
2. 右辺の再帰は `1` を読んだあと `as` を見る。`Compare` は `Add` 以下なので `break` して、`1` だけを返す。外側の左辺は `1 + 1` になる
3. 外側のループの頭で `as` を見る。`Compare` は `Comma` より強いので `as` の腕に入る。`number` を型として読み、左辺を `(1 + 1) as number` で包む
4. 型のパーサーは `/` を読まないので、`number` で帰ってくる。`continue` でループの頭に戻って `/` を見る。`Multiply` は `Comma` より強いので食べて右辺の `2` を読み、左辺の `(1 + 1) as number` 全体を `/` の左に置く

効いているのは4です。普通の演算子なら右辺の再帰が `/ 2` を飲み込むところですが、`as` の右辺は型なので、飲み込む再帰がありません。行き場を失った `/` は外側のループが拾い、そのときの左辺は `as` で包んだ全体です。

Claude に tsc 6.0.3 で、同じ行の TypeScript AST (tsc の内部で使われている AST) を出してもらうと、この形になっていました。TypeScript AST はノードが親を指していて JSON にできないので、`ts.createSourceFile` で作った木を `ts.forEachChild` でたどり、ノードの種類 (`ts.SyntaxKind` の名前) を出したものです。数値リテラルの値と、二項演算子の記号も添えています。

```text
BinaryExpression /
  AsExpression
    BinaryExpression +
      NumericLiteral 1
      PlusToken
      NumericLiteral 1
    NumberKeyword
  SlashToken
  NumericLiteral 2
```

tsc が `(1 + 1) / 2` と括弧を補って出力するのは、この木の形を JavaScript で保つためです。空白で消す方式は木ではなく文字列を扱うので、括弧が付かず、別の木になります。

oxc でも、今でも通る入力で同じ形が見られます。`1 * 1 as number + 2` を `--estree` で流した出力から、`Program` と `ExpressionStatement` の外枠を外したものです。

```json
{
  "type": "BinaryExpression",
  "left": {
    "type": "TSAsExpression",
    "expression": {
      "type": "BinaryExpression",
      "left": {
        "type": "Literal",
        "value": 1,
        "raw": "1",
        "start": 0,
        "end": 1
      },
      "operator": "*",
      "right": {
        "type": "Literal",
        "value": 1,
        "raw": "1",
        "start": 4,
        "end": 5
      },
      "start": 0,
      "end": 5
    },
    "typeAnnotation": {
      "type": "TSNumberKeyword",
      "start": 9,
      "end": 15
    },
    "start": 0,
    "end": 15
  },
  "operator": "+",
  "right": {
    "type": "Literal",
    "value": 2,
    "raw": "2",
    "start": 18,
    "end": 19
  },
  "start": 0,
  "end": 19
}
```

こちらは `as number` を消して `1 * 1 + 2` にしても同じ木になるので、問題になりません。`1 + 1 as number / 2` との違いは、`as` の手前の演算子と後ろの演算子の、どちらが強いかだけです。

## TypeScript チームの結論: 優先順位は変えずにエラーにする

ここも Claude に issue と PR を確認してもらった内容です。

Ryan Cavanaugh さんのまとめには、さっきの1行のあとにこう続きます。

> See if we can get away with parsing this as `1 + 1 as (number / 2)` to get a type expression parsing error, or apply the same logic that `??` has with certain binary operands, e.g. `1 || 2 ?? 3` is an error so maybe `1 + 1 as T` can be an error? Worth running top1000 on with Strada and seeing if we can just take a break here in 7.0. It'd have to be an error instead of just a pure precedence change since we don't want to change runtime behavior emit

案は2つ挙がっています。`1 + 1 as (number / 2)` と読んで型のパースエラーにする案と、`1 || 2 ?? 3` を括弧なしで書くとエラーになるのと同じように、混ぜ方そのものをエラーにする案です。続けて、人気リポジトリの上位1000個に対して Strada で試し、7.0 で壊してしまえるか確かめよう、とも書いてあります。これは JS 版の tsc の呼び名で、Go 版の tsc の [`CHANGES.md`](https://github.com/microsoft/TypeScript/blob/f29aeb9f825d96feea27841f3f7342dbf0df68a8/tsc/CHANGES.md#L1) でも、JS 版を Strada、Go 版を Corsa と呼んでいます。

引用の最後の文が、方針の中心です。ランタイムの動作 (出力される JavaScript) を変えたくないので、優先順位を変えるのではなく、エラーにしなければならない。優先順位を変えると、今まで `(1 + 1) / 2` の意味だったコードが、黙って `1 + 1 / 2` の意味に変わってしまいます。エラーにすれば、書き手が括弧を付けて意味を選び直すまで、出力は生まれません。

翌日、Anders Hejlsberg さんが[コメント](https://github.com/microsoft/TypeScript/issues/63527#issuecomment-4615276410)で規則を言葉にしました。冒頭と最後の段落を引きます (間の例と説明は省いています)。

> The only operators that can meaningfully follow an `xxx as T` or `xxx satisfies T` operation in an expression are operators with lower or same precedence as relational operators (which is the classification of `as` and `satisfies`).

> I'm going to put up a PR that stops parsing when an unexpected operator is encountered. I would be very surprised if that breaks anything in the real world.

訳すと、`as T` のあとに意味のある形で続けられるのは、関係演算子と同じか弱い演算子だけだ。それより強い演算子が続いたら、そこでパースを止める。現実のコードで壊れるものがあったらとても驚く、と。

その PR が [microsoft/typescript-go#4192](https://github.com/microsoft/typescript-go/pull/4192)「Stop parsing constructs that make it impossible to erase `as`/`satisfies`」で、Go 版の tsc (typescript-go) に入りました。

実際の判定は、Anders さんの言葉より少し緩く作られています。比べる相手は `as` 自身の強さではなく、`as` の手前で左辺を作った演算子の強さです。だから `1 * 1 as number + 2` は、`+` が関係演算子より強くても通ります。`as` を消したときに意味が変わるかどうか、だけを見ているわけです。

Go 版は、2026年6月18日に npm に出た `typescript@7.0.1-rc` から `typescript` パッケージの7.0として配られています。Claude に `const n = 1 + 1 as number / 2;` を3つのバージョンで試してもらった結果がこちらです。`erasableSyntaxOnly` は付けていません。

| tsc   | 結果                                                     |
| ----- | -------------------------------------------------------- |
| 5.9.3 | エラーなし。`const n = (1 + 1) / 2;` を出力              |
| 6.0.3 | エラーなし。出力は同じ                                   |
| 7.0.2 | `error TS1005: ',' expected.` で、`/` の位置を指している |

7.0 では、オプションに関係なく構文エラーです。`erasableSyntaxOnly` を使う人だけの話ではなくなり、6.0 まで通っていたコードが7.0 では通らない。これが、7.0 で意図的に入った breaking change です。

## oxc は翌日に追いかけた

oxc に同じ変更が入ったのは [oxc-project/oxc#22986](https://github.com/oxc-project/oxc/pull/22986)「fix(parser): disallow unerasable `as`/`satisfies` assertions」です。作者は oxc の中心的な開発者の Boshen さんで、本文の1行目は「Port of microsoft/typescript-go#4192」。時刻は UTC です (Claude に `gh` で確認してもらいました)。

| 日時             | できごと                                                 |
| ---------------- | -------------------------------------------------------- |
| 2026-06-02 11:30 | TypeScript#63527 が立つ                                  |
| 2026-06-03 18:49 | typescript-go#4192 が出る                                |
| 2026-06-04 21:14 | typescript-go#4192 がマージされる                        |
| 2026-06-05 12:38 | oxc#22986 が出る                                         |
| 2026-06-05 13:15 | oxc#22986 がマージされる                                 |
| 2026-06-08       | oxc v0.135.0 のリリース (変更履歴に #22986 が載っている) |
| 2026-06-18       | npm に typescript 7.0.1-rc が出る                        |

Go 版のマージから oxc のマージまで、約16時間です。変更は10ファイルですが、パーサー本体は `js/expression.rs` に17行足しただけで、残りはテストとスナップショットでした。

### 足された17行

足されたのは、さっき読んだコードの2か所と、もう1か所です。

1つ目は、さっきの抜粋にあったループの前の宣言で、`last_operand_precedence` は「いまの左辺を作った二項演算子の優先順位」を覚えておく変数です。最初は `None` です。

2つ目は、普通の二項演算子の腕の最後にある代入 `last_operand_precedence = Some(left_precedence);` (`js/expression.rs:1441`) です。左辺を `BinaryExpression` か `LogicalExpression` で包み直すたびに、その演算子の強さを覚えます。`as` の腕はこの変数を書き換えません。

3つ目が、`as` の腕の最後の `if` です。上のコメントの訳はこうです。

> 何かの二項演算子 `##` について、`a ## b as T` や `a ## b satisfies T` のとき、`##` より優先順位の高い演算子が後ろに続いたら、そこでパースを止める。続けると、式の意味を変えずに `as` や `satisfies` を消すことができなくなるから。

今のコードで `1 + 1 as number / 2` を追うとこうなります。

| 時点                   | 見ているトークン | 左辺                | `last_operand_precedence` |
| ---------------------- | ---------------- | ------------------- | ------------------------- |
| ループの前             | なし             | `1`                 | `None`                    |
| `+` の腕を抜けたところ | `as`             | `1 + 1`             | `Some(Add)`               |
| `as` の腕の `if`       | `/`              | `(1 + 1) as number` | `Some(Add)` のまま        |

最後の行で、後ろの `/` (`Multiply`) が覚えておいた `Add` より強いので、`break` します。

入力が `1 * 1 as number + 2` なら、覚えているのは `Multiply` で、後ろの `+` (`Add`) は強くないので、そのまま続けます。`1 as number * 2` は、`as` の手前で二項演算子を食べていないので `None` のままで、判定そのものをしません。

また、`as` の腕が変数を書き換えないことにも意味があります。`1 + 1 as any as number * 2` のように `as` を重ねても、比べる相手は最初の `+` のままなので、ここでも止まります。

Go 版の tsc は、変数に優先順位ではなく左辺のノードそのもの (`lastOperand`) を覚えておき、それが二項式なら演算子の優先順位を、そうでなければ一番強い値 (`OperatorPrecedenceHighest`) を比べる相手にしています (Claude に確認してもらいました)。一番強い値と比べれば何も止まらないので、oxc の `None` と同じ働きです。

## エラーは、セミコロンの自動挿入が出す

では、`break` したあとどこでエラーになるのか。足された17行は `break` するだけで、エラーは出しません。`break` すると、`/ 2` を読まないまま `(1 + 1) as number` が返るだけです。PR の本文にも、強い演算子を宙に浮かせて、パースエラーとして表に出す、と書いてあります。

式を読み終えて文の側に戻ると、文の終わりを確かめる `asi` (`cursor.rs:143`) が呼ばれます。式の文なら `parse_expression_statement` (`js/statement.rs:309`)、`const` の宣言なら `parse_variable_declaration` (`js/declaration.rs:79`) が呼び出し元です。

```rust
/// [Automatic Semicolon Insertion](https://tc39.es/ecma262/#sec-automatic-semicolon-insertion)
/// # Errors
pub(crate) fn asi(&mut self) {
    if self.eat(Kind::Semicolon) || self.can_insert_semicolon() {
        /* no op */
    } else {
        // ASI failure is a syntax error (cold). Build the diagnostic out of line so the
        // ~232-byte `OxcDiagnostic` buffer does not inflate `asi`'s stack frame on the
        // common (valid) path.
        cold_branch(|| {
            let span = Span::empty(self.prev_token_end);
            let error = diagnostics::auto_semicolon_insertion(span);
            self.set_fatal_error(error);
        });
    }
}
```

ASI (Automatic Semicolon Insertion) は、JavaScript の、セミコロンを省略できる仕組みです。`;` があれば食べ、無くても `can_insert_semicolon` (`cursor.rs:159`) が `}`、ファイルの終わり、改行のどれかを見つければ、セミコロンがあったものとして扱います。残っている `/` はどれにも当たらないので、エラーになります。

```text
===== const n = 1 + 1 as number / 2;

  x Expected a semicolon or an implicit semicolon after a statement, but found
  | none
   ,----
 1 | const n = 1 + 1 as number / 2;
   :                          ^
   `----
  help: Try inserting a semicolon here
```

これが、`.ts` のファイルで `const n = 1 + 1 as number / 2;` を書いたときに oxc が出すエラーです。「文のあとにセミコロンが無い」という、`as` とは関係なさそうなメッセージになるのは、このためです。キャレットが `/` ではなく `number` の直後を指しているのも、エラーの位置を `Span::empty(self.prev_token_end)`、つまり直前のトークンの終わりに置いているからです。

Claude に確認してもらうと、tsc 7.0.2 も同じ作りで、`const` の文では `',' expected.`、式の文 (`1 + 1 as number / 2;`) では `';' expected.` という、一般的な構文エラーが出ました。

## 直し方は、括弧で意味を選ぶ

エラーになった1行は、`(1 + 1) / 2` と `1 + (1 / 2)` のどちらのつもりで書いたのかが、字面からは決まりません。括弧を付けてどちらかを選べば通ります。

| 書きたい意味  | 書き方                  | oxc  | tsc 6.0.3 の出力 |
| ------------- | ----------------------- | ---- | ---------------- |
| `(1 + 1) / 2` | `(1 + 1) as number / 2` | 通る | `(1 + 1) / 2;`   |
| `(1 + 1) / 2` | `(1 + 1 as number) / 2` | 通る | `(1 + 1) / 2;`   |
| `1 + (1 / 2)` | `1 + (1 as number) / 2` | 通る | `1 + 1 / 2;`     |

tsc 6.0.3 の出力は、Claude に `erasableSyntaxOnly` を付けて確かめてもらったもので、エラーは出ませんでした。どれも、型を空白で消した文字列と tsc の出力が同じ意味になります。

1行目が通るのは、`(1 + 1)` が括弧付きの1つの式として、単項式の位置で読まれるからです。ループの中で二項演算子を食べていないので、`last_operand_precedence` は `None` のままで、判定がされません。今までの tsc と同じ意味を保ちたいなら、この書き方に直せば済みます。

## まだ追いついていない1件

この規則には、あとから見つかった穴が1つあります。`**` (べき乗) は右結合なので、同じ強さどうしでも `as` を消すと組み方が変わります。

```text
const asValue = 2 ** 3 as number ** 2;
```

tsc はこれを `(2 ** 3) ** 2` (64) と出力しますが、`as number` を空白で消すと `2 ** (3 ** 2)` (512) になります。2026年7月20日に magic-akari さんが [microsoft/TypeScript#63661](https://github.com/microsoft/TypeScript/issues/63661) で報告し (7.0.2 で確認したとあります)、同じ人の [microsoft/typescript-go#4676](https://github.com/microsoft/typescript-go/pull/4676) が8月14日にマージされています。

今の Go 版では、「強いかどうか」の比較が [`shouldConsumeBinaryOperator`](https://github.com/microsoft/TypeScript/blob/f29aeb9f825d96feea27841f3f7342dbf0df68a8/tsc/internal/parser/parser.go#L4633-L4640) という関数に切り出されていました (Claude に確認してもらいました)。

```go
// shouldConsumeBinaryOperator reports whether an operator binds before the operator represented by currentPrecedence.
// At equal precedence, only the right-associative exponentiation operator binds first.
func shouldConsumeBinaryOperator(operator ast.Kind, operatorPrecedence ast.OperatorPrecedence, currentPrecedence ast.OperatorPrecedence) bool {
	if operatorPrecedence > currentPrecedence {
		return true
	}
	return operatorPrecedence == currentPrecedence && operator == ast.KindAsteriskAsteriskToken
}
```

同じ強さでも `**` なら止める、という1行が足されています。Claude に試してもらうと、7.0.2 はこの行を通し、7.1 の開発版 (`7.1.0-dev.20261002.1`) は `',' expected.` でエラーにしました。

oxc のほうは、`as` の腕の判定が `next_precedence > last_precedence` のままです。この rev で流すと、`2 ** 3 as number ** 2;` は通りました。対応する PR は、oxc のリポジトリでは見つけられませんでした。

## まとめ

- `as` と `satisfies` は、`<` と同じ比較の段の、弱い演算子として表に載っている
- `as` の右辺は式ではなく型なので、後ろに強い演算子が来ても右辺に取り込めない。その演算子は外側のループが拾い、`as` で包んだ左辺全体にかかる
- そのせいで、型を空白で消すと意味が変わる式が書けた。TypeScript チームは優先順位を変えず、7.0 でこの形を構文エラーにすると決めた。出力される JavaScript の意味を黙って変えないためで、6.0 まで通っていたコードが通らなくなるのは承知の上だった
- oxc は Go 版の PR を約16時間後に移植した。判定は `as` の腕の最後の `if` 1つで、専用のエラーは出さない。`break` で残った演算子が、セミコロンの自動挿入でエラーになる
- `**` を挟むケースは、Go 版では8月に塞がれたが、この rev の oxc ではまだ通る

次回は「そのエラー、誰が出してるの?」です。同じ間違いでも、エラーを出すのがパーサーなのか、セマンティック解析なのか、型チェッカーなのかで、oxc と tsc の住み分けが違います。

なお、この記事で自分で実際に読んだのは oxc のパーサーだけです。tsc の中身と動作、issue と PR の経緯は Claude に確認してもらったものなので、間違っていたら指摘してもらえると助かります。
