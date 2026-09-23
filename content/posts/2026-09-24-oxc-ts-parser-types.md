---
title: oxcのTypeScriptパーサーを読む 第1回 型はどう読まれるか
description: type A = string | number; がoxcでどう読まれるかを実際に追う
date: 2026-09-24
tags: ["コンパイラ", "パーサー", "oxc", "TypeScript"]
---

## 今回読むファイル

読んだのは oxc の rev `1aa5ec11ce` です。行番号はすべてこのリビジョンのもので、ズレたときに探せるように関数名とセットで書きます。今回おもに開くのはこのあたりです。

```text
crates/oxc_parser/src/ts/types.rs        1,690行   型の再帰下降。今回の主戦場
crates/oxc_parser/src/ts/statement.rs      962行   型エイリアスの宣言。型の世界の入口
crates/oxc_parser/src/js/statement.rs      932行   文の分岐。型の宣言へ渡す側
```

## 今回の題材

前回は連載全体の見取り図を出しただけで終わったので、今回から実物を読んでいきます。

題材はこれです。

```ts
type A = string | number;
```

先にオチを書いておきます。型の文法を読む部分は、教科書に出てくるそのままの再帰下降です。優先順位の段ごとに関数が1つあって、上の段が下の段を呼ぶ。本当にそれだけ。面白いのは、優先順位を書いた表がどこにも無いことです。どの関数がどの関数を呼ぶか、それ自体が優先順位になっています。

今回出てくる関数は、ほぼ全部が `ts/types.rs` に入っています。型の文法はだいたいこの1ファイルで完結します。

## 型の入口

まず、そこに辿り着くまでの道から。文を1つ読むたびに通るのはこの経路です。

```text
parse_program                          lib.rs
└ parse_directives_and_statements      js/statement.rs:33    文を1つずつ読むループ
  └ parse_statement_list_item          js/statement.rs:131   現在のトークンで文の種類を分岐
    └ parse_ts_declaration_statement   ts/statement.rs:612   修飾子を食べる
      └ parse_declaration              ts/statement.rs:640   もう一度、種類で分岐
        └ parse_ts_type_alias_declaration   ts/statement.rs:128
```

分岐が2回あるのが目を引きます。1回目の `parse_statement_list_item` はこうなっています。

```rust
// js/statement.rs:131 parse_statement_list_item
match self.cur_kind() {
    // ... if / for / return など、JS の文の腕がひととおり並んだあと
    Kind::Interface | Kind::Type | Kind::Module | Kind::Namespace
    | Kind::Declare | Kind::Enum
    | Kind::Private | Kind::Protected | Kind::Public
    | Kind::Abstract | Kind::Accessor | Kind::Static | Kind::Readonly | Kind::Global
        if self.is_ts && self.at_start_of_ts_declaration() =>
    {
        self.parse_ts_declaration_statement(self.cur_start(), stmt_ctx)
    }
    _ => self.parse_expression_or_labeled_statement(),
}
```

14種類が1本の腕にまとまっていて、宣言の頭（`type` `interface` `enum`）と修飾子（`declare` `public` `readonly`）が同居しています。なのでこの時点では「TSの宣言が始まるらしい」までしか分かりません。腕が呼んでいる `parse_ts_declaration_statement` も、名前のわりに種類を決めず、やるのは修飾子を食べ尽くすことだけです。食べ終わってから、2回目の `parse_declaration` でようやく本体の種類が決まります。

その腕にはガードが付いていて、それが `at_start_of_ts_declaration`（`ts/statement.rs:863`）です。`type` はJSの予約語ではないので変数名に使えます。`type = 1;` と書けばただの代入で、実際そう読まれます。

```rust
// ts/statement.rs:863 at_start_of_ts_declaration
match self.cur_kind() {
    // ...
    // `interface I`  `type T = …`（キーワード + 同じ行の、束縛できる識別子）
    Kind::Interface | Kind::Type => {
        let next = self.lexer.peek_token();
        next.kind().is_binding_identifier() && !next.is_on_new_line()
    }
    // ...
}
```

そして `parse_ts_type_alias_declaration`（`ts/statement.rs:128`）が、174行で `parse_ts_type()` を呼びます。ここが型の世界の入口です。

## 降下のはしご

ここから下は、優先順位の段がそのまま関数の並びになっています。上から順に並べるとこうです。

```
parse_ts_type                          ts/types.rs:15   conditional (extends ... ? ... : ...)
 └ parse_union_type_or_higher          ts/types.rs:245  縦棒
   └ parse_intersection_type_or_higher ts/types.rs:241  アンパサンド
     └ parse_type_operator_or_higher   ts/types.rs:282  前置の keyof / unique / readonly / infer
       └ parse_postfix_type_or_higher  ts/types.rs:358  後置の配列とインデックスアクセス
         └ parse_non_array_type        ts/types.rs:411  プライマリ型の大分配器
```

段ごとに見ていきます。

### 一番上は conditional を担当している

はしごの先頭にいる `parse_ts_type` は、中身が30行しかありません。内容をコメントで追記しています。

```rust
// ts/types.rs:15
pub(crate) fn parse_ts_type(&mut self) -> TSType<'a> {
    // 1. 関数型とコンストラクタ型は、はしごを丸ごとバイパスする
    //    判定は < と new なら即決、abstract は次を1つ覗くだけ、( のときだけ投機パース
    if self.is_start_of_function_type_or_constructor_type() {
        return self.parse_function_or_constructor_type();
    }
    // 2. 1つ下の段を呼ぶ。はしごの定型部はこの1行だけ
    let ty = self.parse_union_type_or_higher();
    // 3. extends が続いていたら conditional 型として組み立てる
    if !self.ctx.has_disallow_conditional_types()
        && !self.cur_token().is_on_new_line()
        && self.eat(Kind::Extends)
    {
        let extends_type = self.context_add(DisallowConditionalTypes, Self::parse_ts_type);
        self.expect(Kind::Question);
        let true_type = self.context_remove(DisallowConditionalTypes, Self::parse_ts_type);
        self.expect_conditional_alternative(question_span);
        let false_type = self.context_remove(DisallowConditionalTypes, Self::parse_ts_type);
        return TSType::new_ts_conditional_type(/* ... */);
    }
    ty
}
```

ここで分かるのが、conditionalがunionより上にいるということです。つまり `A | B extends C ? X : Y` は `(A | B) extends C ? X : Y` と読まれます。合併型のほうが先に読み終わっていて、その結果がまるごと左辺になるからですね。優先順位の表がどこにもないのに、関数の呼び出し順がそのまま優先順位になっている。ここが今回の記事の肝です。

なお conditional は、はしごのどの段にもぶら下がっていません。`parse_ts_type` が自分で `extends` の有無を見て、自分で3つの枝を読みます。はしごの外にいる特別扱いです。

結合の向きも、ここに書いてあるとおりになります。偽側の枝がまた一番上を呼ぶので（33行）、`T extends A ? X : T extends B ? Y : Z` は放っておいても右結合になる。右結合だと宣言している場所はどこにもなくて、再帰の向きがそのまま結合の向きです。

もう1つ、条件の2行目（22行）には改行の判定が入っています。conditionalの `extends` の手前に改行があったら、そもそも条件型として読まない、というガードです。TSでは予約語もメンバー名に使えるので、セミコロン無しで行が終わった直後に `extends` で始まる行が来ると、conditionalの開始なのか次のメンバーの名前なのか決まらなくなる。改行が来たらメンバー名の側に倒す、というASI的な裁定になっています。

代償として、conditionalの `extends` を行頭に折り返す書き方ができません。フォーマッタをかけたときに `T extends` が必ず同じ行に残るのは、整形の好みではなく文法上の制約だったわけですね。

### 中置の2段は同じ関数

unionとintersectionは、構造が完全に同じです。違うのは区切り記号と、1つ下がどの段かという2点だけ。なので本体は `parse_union_type_or_intersection_type`（252行）の1つにまとめられていて、その2点を引数で受け取ります。

```rust
fn parse_intersection_type_or_higher(&mut self) -> TSType<'a> {
    self.parse_union_type_or_intersection_type(Kind::Amp, Self::parse_type_operator_or_higher)
}

fn parse_union_type_or_higher(&mut self) -> TSType<'a> {
    self.parse_union_type_or_intersection_type(
        Kind::Pipe,
        Self::parse_intersection_type_or_higher,
    )
}
```

中身が無くて、引数を変えて同じ本体を呼ぶだけ。`Self::parse_type_operator_or_higher` はメソッドを関数値として渡す書き方です。受け取る側はこうなっています。

```rust
// ts/types.rs:252
fn parse_union_type_or_intersection_type<F>(&mut self, kind: Kind, parse_constituent_type: F) -> TSType<'a>
where
    F: Fn(&mut Self) -> TSType<'a>,
{
    let has_leading_operator = self.eat(kind);      // 先頭の区切り記号があれば食べる
    let mut ty = parse_constituent_type(self);      // 1つ下の段
    if self.at(kind) || has_leading_operator {
        let mut types = ArenaVec::from_value_in(ty, self);
        while self.eat(kind) {                      // 区切りを食べては次の要素を読む
            types.push(parse_constituent_type(self));
        }
        ty = match kind {
            Kind::Pipe => TSType::new_ts_union_type(span, types, self),
            Kind::Amp => TSType::new_ts_intersection_type(span, types, self),
            _ => unreachable!(),
        };
    }
    ty                                              // 区切りが無ければ、包まずそのまま返る
}
```

境界が `F: Fn(&mut Self) -> TSType<'a>` なので、ジェネリクスとして単相化されます。関数ポインタ経由の間接呼び出しにはなりません。

さっき「次にどの関数を呼ぶかがそのまま優先順位だ」と書きましたが、この2段はその配線を引数として外から差し込んでいる形になります。はしごの段そのものを、値として渡している。

### 前置の段と後置の段

前置演算子を受け持つのが `parse_type_operator_or_higher`（282行）です。`keyof` / `unique` / `readonly` / `infer` の4つを、先頭トークンを見るだけで振り分けます。左端に演算子が来る形なので、先読みも投機も要りません。

実体の `parse_type_operator`（295行）は、演算子を1つ食べたあと自分自身を再帰呼び出しします（299行）。なので `keyof` を重ねて書いた型も自然に通ります。前置演算子の段の定石ですね。

後置を受け持つのは `parse_postfix_type_or_higher`（358行）で、こちらはループです。

```rust
// ts/types.rs:358
fn parse_postfix_type_or_higher(&mut self) -> TSType<'a> {
    let mut ty = self.parse_non_array_type();        // 1つ下から型を1個もらう
    while !self.cur_token().is_on_new_line() {       // 後置は同じ行にしか付かない
        match self.cur_kind() {
            Kind::Bang => { /* T! で包む */ }
            Kind::Question => {
                // 次が型の始まりなら、これは conditional の `?` なので手を出さない
                if self.lookahead(|p| { p.bump_any(); p.is_start_of_type(false) }) {
                    return ty;
                }
                /* T? で包む */
            }
            Kind::LBrack => {
                self.bump_any();
                if self.is_start_of_type(false) {
                    let index_type = self.parse_ts_type();   // T[K]
                    self.expect(Kind::RBrack);
                    ty = /* indexed access */;
                } else {
                    self.expect(Kind::RBrack);               // T[]
                    ty = /* array */;
                }
            }
            _ => return ty,
        }
    }
    ty
}
```

ループの条件が地味に効いていて、後置の記号は必ず同じ行になければ拾われません。

`?` の腕には1トークンの先読みが入っています。`?` の次が型の始まりなら、後置の記号ではなく conditional の `?` だと判断して、その場で返してしまう。後置の `?` はJSDoc由来の書き方なので、TSの本流である conditional のほうに優先権があります。

`[` の腕も見どころで、開き括弧を食べたあと次が型の始まりかどうかで、添字アクセスと配列型に分かれます。同じ入口を通っていて、`[` の次の1トークンだけで決まる。ループなので `string[][]` のような入れ子も、2周するだけで自然に扱えます。

### 一番下は大きな match

はしごの底、`parse_non_array_type`（411行）まで降りると、あとは現在のトークンで分配するだけの大きな match です。腕はちょうど17本あって、キーワード型、リテラル型、`{`、`[`、`(`、`import`、`typeof`、`asserts`、テンプレート型と並び、どれにも当たらなければ `parse_type_reference`（822行）に行きます。

この match の腕の一覧は、そのまま「型が始まれるトークンの一覧」として読めます。逆に、ここに無いトークンから型は始まらない。

たとえば `<` の腕がありません。これは「`<` で始まる型は関数型しかない」ことの裏返しで、そういう型ははしごに降りてくる前に、16行の分岐で拾われています。

### はしごは一直線ではない

ここまで一本道のように書きましたが、実際はもう少しグラフに近い形をしています。プライマリ型の中には、別の型が埋まっているものがあるからです。

たとえば括弧型を読む `parse_parenthesized_type`（1106行）は、括弧の中身を読むのに `parse_ts_type` を呼びます。つまり一番上に戻る。インデックスアクセスも同じで、`[` を食べた後の添字部分で同じ関数を呼んでいます（392行）。タプルの要素、テンプレート型の穴、型引数の中身も同様です。

なので読み方としては、はしごを降りてプライマリを1個読む、その中に型が埋まっていたら一番上からやり直す、の繰り返しになります。結果として、どんな型もかならず15行と411行の2つを通る。この2か所さえ押さえておけば道に迷わない、というのが実際に読んでみての感触です。

## 実際に追ってみる

ここまでが地図です。実際に `type A = string | number;` を流してみます。

トークン列は `type` / `A` / `=` / `string` / `|` / `number` / `;` ですね。`=` の後から追いかけます。

1. 入口の15行に入る。現在のトークンは `string` なので、関数型の判定（86行）は `<` でも `new` でも `abstract` でも `(` でもなく即 false。はしごに降ります
2. `parse_union_type_or_higher`（245行）が `Kind::Pipe` を持って本体（252行）を呼ぶ
3. 261行で先頭の区切り記号を食べようとするが無いので、フラグは false のまま
4. 263行で1つ下を呼ぶ。intersection（241行）、type_operator（282行）と素通りして、postfix（358行）へ
5. 360行で `parse_non_array_type`（411行）を呼ぶ。match がキーワード型の腕に当たる。ここで次のトークンが `.` かどうかだけ覗いて（425行）、名前空間の頭として使われていないことを確認してから `parse_keyword_type`（508行）へ。TSStringKeyword が1個できます
6. 後置の段のループに戻る。現在のトークンは `|` で、どの腕にも当たらないのでそのまま返す。type_operatorもintersectionも、自分の演算子ではないのでそのまま返す
7. union の264行に戻ってくる。いま `|` にいるので、ここで初めてリストを作る。266行からの while で、区切り記号を食べては次の要素を読むのを繰り返す
8. `number` について 4 から 6 が再演され、TSNumberKeyword ができる
9. 274行で TSUnionType が組み上がる

実際の出力がこれです。

```json
{
  "type": "TSUnionType",
  "types": [
    { "type": "TSStringKeyword", "start": 9, "end": 15 },
    { "type": "TSNumberKeyword", "start": 18, "end": 24 }
  ],
  "start": 9,
  "end": 24
}
```

ついでに範囲も見ておくと、ユニオンのノードは9から24で、`string` の先頭から `number` の末尾まで。セミコロンは含まれていません。外側の型エイリアス宣言のほうは0から25でそれを包んでいて、ノードの範囲がきれいに入れ子になっているのが分かります。

### 段を降りても中間ノードは積もらない

いま5段降りたわけですが、できあがった木は2段しかありません。264行の条件が効いていて、区切り記号が1個も無ければ包むのをやめ、下から受け取った型をそのまま返すからです（279行）。

確かめてみます。

```ts
type A = string;
```

これの typeAnnotation は TSStringKeyword が直に来ます。union も intersection も前置も後置も全部通過しているのに、痕跡が残らない。段の数だけ無駄なノードが積み上がるような作りにはなっていません。

ついでに、この条件にはもう1つ枝があります。261行で先頭の区切り記号を食べたときのフラグで、これが立っていると後続に区切りが無くても包みます。

```text
type A = | string;
```

これは要素が1つだけの TSUnionType になりました。ユニオンを縦に並べて書くときの、先頭の縦棒ですね。書いた人が「これはユニオンです」と表明しているので、そのとおりの木にする、という扱いになっています。

## まとめ

- 型エイリアスの右辺は `parse_ts_type`（`ts/types.rs:15`）から始まり、5段のはしごを降りて `parse_non_array_type`（411行）に着く
- 優先順位の表はどこにも無く、どの関数がどの関数を呼ぶかがそのまま優先順位になっている。前置の段が後置の段を呼んでいるので、後置のほうが先に読み終わる
- 段を通過しても、自分の演算子が出てこなければノードは作らない。`type A = string;` の結果は TSStringKeyword が1個だけ
- 条件型が右結合になるのも同じ理屈で、偽側の枝が一番上を呼び直しているだけ

今回は「素直な型は素直に読まれる」という話だけで終わりました。次回はその逆をやります。`f<T>(x);` という1行を先頭から通しで追って、先読みと投機パースとre-lexが全部出てくるところを見ていきます。型の側から入ったぶん今回は静かなものでしたが、次はレキサーまで巻き込んだ話になります。

この記事で流した入力とASTのダンプは[リポジトリ](https://github.com/tsuka-ryu/compiler-workshop-rust)の `demos/oxc-step1/` に置いてあります。自分で走らせたいときは、oxc側で次のコマンドです。

```bash
cargo run -q -p oxc_parser --example parser -- foo.ts --estree
```
