---
title: Pratt Parserについてのメモ
description: Pratt Parserについてメモします
date: 2026-06-07
tags: ["コンパイラ", "パーサー", "oxc"]
---

こんにちは。6月になりました。暑かったり寒かったりで、季節が不明ですね。

今回はPratt Parserについてメモをしておきたいと思います。毎回ふんわりと理解して、ふんわり忘れるため…

自分でした実装（というかほとんどClaudeに書いてもらった）としては、[typescript版](https://github.com/tsuka-ryu/toy-pratt-parser)と[rust版](https://github.com/tsuka-ryu/compiler-workshop-rust/pull/6)があります。

ちゃんとした情報を知りたい方は、[Simple but Powerful Pratt Parsing](https://matklad.github.io/2020/04/13/simple-but-powerful-pratt-parsing.html)を読んでください。この記事以上の情報はここにはありません。

## Pratt Parserとは

ざっくり自分の理解を書くと、「再帰下降パーサーで優先順位ごとに関数を分けなくても、結合力（binding power）を使えば loop + 再帰でフラットに構文解析できちゃうよ」ということだと思います。

別に再帰下降パーサーを使わなくなるわけではなく、組み合わせて使うこともあるようです。複数の演算子などがある場合に、結合力を定義してあげればうまくいく、というのが嬉しさっぽいですね。

## Pratt Parserについての参考文献

他にもあると思いますが、自分が眺めた参考文献を列挙しておきます。

- [matklad - Simple but Powerful Pratt Parsing](https://matklad.github.io/2020/04/13/simple-but-powerful-pratt-parsing.html): とにかくこれを読めばよし
- [MoonBit Pearls Vol.01：Implementing a Pratt Parser in MoonBit](https://www.moonbitlang.com/pearls/pratt-parse): 一番最初のブログがこれなんだ〜（小並感）
- [Top-Down operator precedence (Pratt) parsing](https://eli.thegreenplace.net/2010/01/02/top-down-operator-precedence-parsing): 比較的短め

以下では、実際に使われています。

- [acorn/src/expression.js](https://github.com/acornjs/acorn/blob/master/acorn/src/expression.js): Pratt とほぼ同型の優先順位パーサー（operator precedence parser）を使っています
- [oxc_parser/src/js/expression.rs](https://github.com/oxc-project/oxc/blob/388af9d7d577424292931eede19ed5c9dd053194/crates/oxc_parser/src/js/expression.rs#L1228): 二項演算子の解析に使っています

なので、再帰下降 ＋ Prattがわかればだいぶ良さそうです。

## Pratt Parserについて覚えておきたいこと

[rust版](https://github.com/tsuka-ryu/compiler-workshop-rust/pull/6)を例に、コアのアイディアだけ自分が思い出せるように書いておこうと思います。コードとしては以下です。

`a + b * c`と`a * b + c`をそれぞれちゃんとパースできるか、というのが今回見たい例です。（元のコードと違って、三項演算子に関係する部分は削除してます。）

```rust
// 結合力の定義
fn infix_bp(&self, tok: &Token) -> Option<(u8, u8)> {
    match tok {
        Token::Ternary => Some((2, 1)),
        Token::Plus => Some((3, 4)),
        Token::Multiply => Some((5, 6)),
        _ => None,
    }
}

// 二項演算子をパースして、式のASTを返す関数
fn parse_expr_bp(&mut self, min_bp: u8) -> Expression {
    // PART 1
    let mut lhs = self.parse_atom();

    // PART 2
    loop {
        // PART 3
        let (lbp, rbp) = match self.infix_bp(self.peek()) {
            Some(bp) => bp,
            None => break,
        };

        // PART 4
        if lbp < min_bp {
            break;
        }

        // PART 5
        let op_tok = self.advance();

        let rhs = self.parse_expr_bp(rbp);
        let op = match op_tok {
            Token::Plus => BinaryOp::Add,
            Token::Multiply => BinaryOp::Multiply,
            other => unreachable!("infix_bp が Some を返したのに対応してない: {other:?}"),
        };
        lhs = Expression::Binary {
            left: Box::new(lhs),
            op,
            right: Box::new(rhs),
        };
    }

    // PART 6
    lhs
}
```

ざっくり6つのPARTに分かれます。

1. 左辺（left-hand side）には`a`などのatomを代入します。2つ目で`break`になった場合、この値を最後の6つ目で返します。
2. loop部分、`break`しない場合、後続のPART 3〜5を繰り返します。
3. `peek()`して次の演算子を読み、その結合力を受け取ります。もし、結合力を定義していないもの（`;`など）だったら`break`します。
4. prattの核の部分。左結合力と`min_bp`を比べて、`lbp < min_bp`なら`break`、そうでなければ次の5つ目に進みます。`min_bp`は最初は`0`で、後述の5つ目で`+`のときであれば右結合力の`4`を、`*`であれば`6`を渡します。再帰呼び出しされた側では、見つけた演算子の左結合力と渡された`min_bp`の比較で、`break`するか次の手順に進むかが決まる！
5. 演算子を消費し、右辺を`parse_expr_bp(rbp)`で再帰的にパースして、式のASTを`lhs`に代入する部分。
6. `lhs`を返す

なので、`+` vs `*` は、以下のような勝敗（？）になります。各オペランドの左右に隣の演算子の結合力を書いて、大きい方がそのオペランドを取り込む、と考えるとわかりやすいです。

`a + b * c`の場合:

```
a   +   b   *   c
  3   4
          5   6
```

`b`の左右は`4`(=`+`のrbp)と`5`(=`*`のlbp)。`5 > 4`で`*`の勝ち → `a + (b * c)`

`a * b + c`の場合:

```
a   *   b   +   c
  5   6
          3   4
```

`b`の左右は`6`(=`*`のrbp)と`3`(=`+`のlbp)。`6 > 3`で`*`の勝ち → `(a * b) + c`

すごいね！

## 結合力の流儀

### matkladの流儀

matkladでは左右の結合力に差をつけて定義することで結合性を表現していました。`+`の`(3, 4)`のように右結合力を大きくすると、`a + b + c`は左結合で`(a + b) + c`になります（再帰側の`min_bp = 4`に対して次の`+`の左結合力`3`が負けて`break`するため）。逆に、三項演算子の`(2, 1)`のように左結合力を大きくすると右結合になります。一般化すると、

- `lbp < rbp` → 左結合（普通の算術演算子など）
- `lbp > rbp` → 右結合（三項演算子、`**`、代入など）

ただ、この記事を書きながらClaudeに教わったのですが、別の流儀もあるようです。

### oxcの流儀

oxcでは、左結合か右結合かを事前に定義しています。

```rust
impl Precedence {
    pub fn is_right_associative(self) -> bool {
        matches!(self, Self::Exponentiation | Self::Conditional | Self::Assign)
    }

    pub fn is_left_associative(self) -> bool {
        matches!(
            self,
            Self::Lowest
                | Self::Comma
                | Self::Spread
                | Self::Yield
                | Self::NullishCoalescing
                | Self::LogicalOr
                | Self::LogicalAnd
                | Self::BitwiseOr
                | Self::BitwiseXor
                | Self::BitwiseAnd
                | Self::Equals
                | Self::Compare
                | Self::Shift
                | Self::Add
                | Self::Multiply
                | Self::Prefix
                | Self::Postfix
                | Self::New
                | Self::Call
                | Self::Member
        )
    }
    // ...etc
}
```

また、優先度はペアではなく、一つの数字で表現されています。

```rust
pub enum Precedence {
    Lowest = 0, // matkladでは初期値として 0 を直接代入しているが、oxcは最下位を enum の variant として明示することで型安全にしている
    Comma = 1,
    Spread = 2,
    Yield = 3,
    Assign = 4,
    Conditional = 5,
    NullishCoalescing = 6,
    LogicalOr = 7,
    LogicalAnd = 8,
    BitwiseOr = 9,
    BitwiseXor = 10,
    BitwiseAnd = 11,
    Equals = 12,
    Compare = 13,
    Shift = 14,
    Add = 15,
    Multiply = 16,
    Exponentiation = 17,
    Prefix = 18,
    Postfix = 19,
    New = 20,
    Call = 21,
    Member = 22,
}
```

上記の左右結合の定義と優先度を組み合わせることで、PART 4の`break`の箇所が以下のようになっています。

```rust
let stop = if left_precedence.is_right_associative() {
    left_precedence < min_precedence
} else {
    left_precedence <= min_precedence
};

if stop {
    break;
}
```

[oxcのコメント](https://github.com/oxc-project/oxc/blob/d16f456ce93fcdadd2cf926afd1b68a6a84a31f8/crates/oxc_syntax/src/precedence.rs#L5-L15)にある通り、ECMAの仕様から導出した順番として定義したかったようです。

```rust
/// Operator Precedence
/// 演算子の優先順位
///
/// The following values are meaningful relative position, not their individual values.
/// 以下の値は、それぞれの数値そのものではなく、相対的な位置関係に意味があります。
///
/// The relative positions are derived from the ECMA Spec by following the grammar bottom up, starting from the "Comma Operator".
/// この相対的な位置関係は、ECMA仕様の文法を「カンマ演算子」を起点にボトムアップで辿ることで導かれています。
///
/// Note: This differs from the operator precedence table
/// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_Precedence#table>
/// but the relative positions are the same, as both are derived from the ECMA specification.
/// 注: これはMDNの演算子優先順位表とは異なりますが、どちらもECMA仕様から導かれているため、相対的な位置関係は同じです。
///
/// The values are the same as
/// [esbuild](https://github.com/evanw/esbuild/blob/78f89e41d5e8a7088f4820351c6305cc339f8820/internal/js_ast/js_ast.go#L28)
/// この値はesbuildと同じです。
```

いい話だなあ（？）

## まとめ

アルゴリズムとデータ構造に慣れ親しんでない自分からすると、Pratt Parserのようなコードはすぐ意味を見失ってしまうので、記事にしてみました。ついでにoxcの中もちょっとだけ覗けたので良かったですね。有意義な日曜日になりました。

Opus4.8が何でも知ってるので、コンパイラの勉強が捗ります。助かる。コンパイラ周りでまた記事にしたくなったら書こうと思います。それでは。

---

_最終更新: 2026年6月7日_
