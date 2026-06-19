---
title: Resilient Parsingについてのメモ
description: Resilient Parsingについてメモします
date: 2026-06-19
tags: ["コンパイラ", "パーサー", "oxc"]
---

今回はResilient Parsingについてのメモです。matkladは偉大。

詳細の実装より概念的なところを記録しておきたい気持ちです。

## Resilient Parsingとは

Resilient Parsingとは「構文エラーがあっても、エラーを収集したり木構造を頑張ってパースする技」だと思いました。

アカデミックな分野ではエラーリカバリという概念？で微妙に違うっぽいです[要出典]。Crafting Interpretersでも`panic mode`や`synchronization`みたいに飛ばし読みして復帰する技術はありますが、そこを一歩越えて、壊れた箇所は壊れてるとマークしつつ、木構造は維持するイメージみたいでした。

Resilient Parsingの概念については、matklad氏の[Resilient LL Parsing Tutorial](https://matklad.github.io/2023/05/21/resilient-ll-parsing-tutorial.html)が主要な参照元になるようです。自分の能力不足でOpusに質問してやっとちょっと意味がわかったかなという感じでした。

matklad氏の記事を読んだ後に、opusの指示のもとoxcのコードベースに近い[Resilient parsingを実装](https://github.com/tsuka-ryu/compiler-workshop-rust/pull/7)したのですが、やってることが結構違いました。

ここではその違いについて見ていきたいと思います。

ただ、すでに[Opusが書いてくれた解説](https://github.com/tsuka-ryu/compiler-workshop-rust/blob/main/docs/parse-resilient.md)もあります。

## matklad版

### Resilient Parsingの例

最初に例です。以下のように不完全な式の定義が並んでいる場合でも、rust-analyzerのようなツールではなるべく壊れていないASTが欲しいです。

```rust
fn f1(x: i32,                  // 閉じ忘れ
fn f2(x: i32,, z: i32) {}      // カンマ重複
fn f3() {}
```

Resilient Parsingで実装すると、以下のような構造にパースされます。

```rust
File
  Fn
    'fn'
    'f1'
    ParamList
      '('
      (Param 'x' ':' (TypeExpr 'i32') ',')
      error: expected RParen // RParenがないことを報告している（実際は木のノードではなく別建ての診断リストに積まれる）
  Fn // 一つ前のFnに閉じ忘れがあっても、ちゃんとFn定義としてパースが開始されてる
    'fn'
    'f2'
    ParamList
      '('
      (Param 'x' ':' (TypeExpr 'i32') ',')
      ErrorTree
        error: expected parameter // カンマが重複していても、それ以降の引数もちゃんとパースされる
        ','
      (Param 'z' ':' (TypeExpr 'i32'))
      ')'
    (Block '{' '}')
  Fn
    'fn'
    'f3'
    (ParamList '(' ')')
    (Block '{' '}')
```

Resilient Parsingはいくつかのアイディアの組み合わせです。

- パースを試みるとき、最低１トークンは消費する（たとえエラー報告でも）
- 平坦なイベント列、ホモジニアスな木、の２段階でパースする
- 再帰下降パーサーはただのネストしたループ構造であり、パース時の処理は三択で表現される

### 最低１トークンは消費する

ここは強調されていたので重要な気がする。

パーサーあるあるは、無限ループに陥ってしまうことらしいですが、Resilient Parsingは最低１トークンは消費するのでその心配がない、というかそうならないように設計された概念な気がしました。

### 平坦なイベント列、ホモジニアスな木、の２段階でパースする

#### 平坦なイベント列

まずはイベントの定義。

```rust
// イベント列の定義
enum Event {
  Open { kind: TreeKind },
  Close,
  Advance,
}

struct Parser {
  tokens: Vec<Token>,
  pos: usize,
  fuel: Cell<u32>,
  events: Vec<Event>, // これ
}
```

先ほどの例で言うと、パースする前に平坦なイベント列に変換されます。

ここではわかりやすく階層構造で表現してますが、実体はVecにpushされたトークンの集合です。
`Open` / `Close`でトークンを囲み、現在のトークン（`fn`や`(`や`x`など）は葉として`Advance`と色付けされます。

```rust
Open(File)
  Open(Fn)                       ← f1
    Advance  fn
    Advance  f1
    Open(ParamList)
      Advance  (
      Open(Param)
        Advance  x
        Advance  :
        Open(TypeExpr)
          Advance  i32
        Close                    // TypeExpr
        Advance  ,
      Close                      // Param
      //── loop: 次は `fn`(=f2) → 回復集合にヒット → break
      //── expect(`)`) : 診断だけ出してイベントなし・前進なし
    Close                        // ParamList   ← `)` を欠いたまま閉じる
    // ── arrow なし / block なし
  Close                          // Fn
  // ...以下略
```

この構造の何が嬉しいかというと、Vec上の`Open`の位置さえわかればあとで簡単に書き換えたり追加したりできるという点です。

matkladの記事中で書かれている例がわかりやすいです。`f(1)(2) `をパースする場合、`Open`は`(f(1))(2)`の左結合でパースしないといけないですが、`f(1)`まで読んだ時点では`(f(1))`と自分自身を囲む`Open`を作ることはできません。

もし木構造であれば、`f(1)(2)`まで読み終えてから木構造全体を作り直す必要がありそうです。

平坦なイベント列であれば、「これは左結合だ」と気づいたタイミングで、Vecの特定の位置に`Open`を差し込めば、構造として成立します。matkladの実装ではこれを`open_before()`というメソッドで行っています（直前の`Close`の前に`Open`を遡って挿入する）。

また、壊れた構文を発見したときも、トークンを読んでエラーだと気づいたあとに`Open(Error) / Advance / Close`だ、ということがわかります。そのため、読み始めるタイミングでは`Open(???)`で、最後まで読んでから正解を埋め込めるというのが嬉しいです。

#### ホモジニアスな木

ホモジニアス（均質）な木とは、すべてのノードが「種類タグ＋子のVec」という構造のことです。子に何が何個来ても同じように扱います。

```rust
// ホモジニアス — ノードは1種類だけ:
enum TreeKind {        // 種類は「タグ」でしかない
    File, Fn, ParamList, Param, TypeExpr,
    ExprCall, ExprName, ExprLiteral, ErrorTree, ...
}

enum Child {
    Token(Token),      // 葉（リーフ）
    Tree(Tree),        // 枝
}

struct Tree {
    kind: TreeKind,    // ← 種類はここ。型ではなくデータ
    children: Vec<Child>,
}
```

この利点は「最低１トークン消費する」を実現しやすい点です。Errorがあっても、ErrorTreeとして素直に表現してトークンを消費することが可能です。

#### ２段階でパースする

２段階でパースすることで、イベント列は単純にVecにpushしていき、イベント列をインプットに木に畳み込むだけ、というシンプルな分業が可能になります。エラーがあっても扱いが簡単です。

どちらの実装も複雑なアルゴリズムも必要ありません。

### パース時の処理は三択で表現される

matkladの記事を読んでいてわりと感動したのが、パース時の処理が三択で表現される部分です。

一般的に、パーサ（構文解析）の処理は、次のような入れ子構造のループとして機能します。

```rust
loop { // 関数のリストを解析する
  loop { // 関数内のステートメント（文）のリストを解析する
    loop { // 式のリストを解析する
    }
  }
}
```

- 要素のパースを試みる: 正常系。param や stmt や arg を呼ぶ。
- 予期しないトークンをスキップする: `advance_with_error` で1個食べて続行(f2 の余分なカンマ)。
- ループを抜けて親に回復を委ねる: break(f2 で fn を見たとき)。

f2を例にとると、以下のようなコードです。

```rust
const PARAM_LIST_RECOVERY: &[TokenKind] = &[Arrow, LCurly, FnKeyword];
fn param_list(p: &mut Parser) {
  assert!(p.at(LParen));
  let m = p.open();
  p.expect(LParen);
  while !p.at(RParen) && !p.eof() {
    if p.at(Name) {
      param(p); // 仮引数、型注釈、カンマをセットで消費する
    } else {
      if p.at_any(PARAM_LIST_RECOVERY) { // ① {fn, '{'} を見つけちゃった
        break;
      }
      p.advance_with_error("expected parameter"); // ② トークン消費を続ける
    }
  }
  p.expect(RParen);
  p.close(m, ParamList);
}
```

1. `f2(x: i32,, z: i32)`の引数リストをパースするときに、次の`fn`キーワードなどが出てきてしまったということは、すでに次の関数のパースが始まってしまっていることになります。このままパースすると大半が壊れた木になってしまいます。そのため、いまの関数をパースするloopからは`break`で脱出します
2. 想定外の値があっても、Errorとして消費します

### matklad版のまとめ

主要な概念については多分書けた気がします。よくできてて感動しますね。

## oxc版

oxc版といっても、Opusがそういっていただけでまだ自分でコードを読んでないので正しいかわかりません。ただ、matkladのResilient Parsingとはだいぶ違うものみたいです。概念に共通点があるだけのようですね。

こちらは`typed AST`を直接組みながら2層のエラーで回復する方式です。実装としては、いままで`panic!`で処理していた部分で`expect()`して、エラーを突っ込んでいく感じです。例を見てみましょう。

本来は末尾に`;`が必要な`"const x = 5"`をパースした場合、以下のようなASTになります。

```rust
ParserReturn {
    statements: [
        ConstDeclaration {
            name: "x",
            type_annotation: None,
            init: Number {
                value: 5,
                },
            },
        },
    ],
    errors: [
        ParseError {
            message: "expected ';'",
        },
    ],
    panicked: false,
}
```

あるいは、不完全な構文`"const x = ;"`をパースした場合、以下のようなASTになります。

```rust
ParserReturn {
    statements: [],
    errors: [
        ParseError {
            message: "unexpected token in expression: Semicolon",
            span: Span {
                start: 10,
                end: 11,
            },
        },
    ],
    panicked: true,
}
```

この中で出てくる`errors`や`panicked`が2層のエラー回復部分です。

### errors と panicked

それぞれ役割が違います。

- errors: 回復可能なエラーを発見した場合は、この配列にpushして続行、木は残る
- panicked: 最上位で木構造を捨て、fatal_errorを報告

### Dummyでスタックを巻き戻す

fatalが起きたとき、「Expressionを返す関数なのに値が作れない」ため困ります。oxcは`Result`や`?`でのエラー伝播を使用せず、`Dummy::dummy()`を捨て値として返す。これでコードがシンプルになります。

### Resilient Parsingなのか？

panickedで木を捨ててしまうので、matkladが言う「Resilient parsing means recovering as much syntactic structure from erroneous code as possible.（レジリエントな構文解析とは、エラーを含むコードから、可能な限り多くの構文構造を復元することを意味します。）」とはちょっと違いそうですね。

errorsに詰めていく部分はresilient的な感じでしょうか。

というか、そもそもoxcでは`Resilient`という言葉は使われてないですね（笑）。Opus君、どうなっとんねん（？）

## まとめ

Resilient Parsing、おもしろかったです。

matklad氏のResilient Parsingはrust-analyzerが念頭にあるのでなるべく部分木を残す方向ですが、oxcは静的解析時に強制終了してもそんなに困らないんですよね。なので、それぞれ目的に合った実装になっていると言う感じでしょうか。

oxcのコードがちょっとずつ読めるような気がしてきました。次回はアリーナアロケータ（ボスキャラ）を勉強しようと思います。

---

_最終更新: 2026年6月19日_
