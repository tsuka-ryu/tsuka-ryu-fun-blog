---
title: oxcのTypeScriptパーサーを読む 第3回 型引数つき呼び出しがASTになるまで
description: たった1行の入力がパーサーの4ファイルを横断する様子を、実際に採ったトレースで先頭から追います。投機パースが成功する側と、巻き戻って比較演算になる側を並べました。
date: 2026-09-26
tags: ["コンパイラ", "パーサー", "oxc", "TypeScript", "oxc-ts-parser"]
draft: true
---

## 今回読むファイル

読んだのは oxc の rev `1aa5ec11ce` です。行番号はすべてこのリビジョンのもので、ズレたときに探せるように関数名とセットで書きます。今回おもに開くのはこのあたりです。

```text
crates/oxc_parser/src/js/expression.rs   1,799行   式のはしご。JSとTSの境界はここ
crates/oxc_parser/src/ts/types.rs        1,690行   型引数の投機パース
crates/oxc_parser/src/cursor.rs            638行   checkpoint / rewind / lookahead
crates/oxc_parser/src/lexer/typescript.rs   53行   山括弧の再字句解析。全部読めます
crates/oxc_parser/src/js/statement.rs      932行   文の入口。トレースの出発点
crates/oxc_parser/src/js/arrow.rs          410行   今回は空振りする側として登場
```

## 今回の題材

前回はリポジトリの地図を広げて、TypeScript専用のパーサーというものは存在しないという話をしました。今回はまた細い道に戻ります。同じ形なのに結果が違う2行を、先頭から歩かせてみます。

```ts
f<T>(x);
```

```ts
a < b > c;
```

字句解析を終えた時点の姿は、驚くほど似ています。実際に oxc から吐かせたトークン列がこちらです。

```
// f<T>(x);
  0..1   Ident            "f"
  1..2   LAngle           "<"
  2..3   Ident            "T"
  3..4   RAngle           ">"
  4..5   LParen           "("
  5..6   Ident            "x"
  6..7   RParen           ")"
  7..8   Semicolon        ";"

// a < b > c;
  0..1   Ident            "a"
  2..3   LAngle           "<"
  4..5   Ident            "b"
  6..7   RAngle           ">"
  8..9   Ident            "c"
  9..10  Semicolon        ";"
```

識別子、開き山括弧、そこからもうひとつ名前、そして閉じるほう。ここまで完全に同じ並びです。違いは5番目に来るものが `(` か識別子かという一点だけ。

なのに出てくる木は別物です。上は型引数つきの呼び出し (CallExpression の `typeArguments` に `T` がぶら下がる)、下は比較演算を2回やった二重の BinaryExpression、つまり `(a < b) > c` になります。第0回で1文だけ書いて放置した話の、種明かしにあたります。

面白いのは、この2つが分岐点まで完全に同じ道を通ることです。同じ関数を同じ順に呼び、同じ場所で checkpoint を取り、同じ型パーサーを走らせ、最後の1回の判定だけで運命が分かれます。以下、その道を先頭から歩きます。

## トレースは実際に走らせて採った

以降で引用する呼び出し順は、想像ではなく実測です。oxc の `crates/oxc_parser/src` にある `parse_*` や `is_start_of*` といった関数297個の入口に一時的に出力を仕込み、採取してから revert しました。あわせて `cursor.rs` の checkpoint と rewind、そして re-lex の発火も記録しています。

読んだ oxc は rev `1aa5ec11ce` です。行番号はすべてこのリビジョン基準で、関数名とセットで書きます。

## 先頭12行で、4つのファイルをまたぐ

これが `f<T>(x);` のトレースの冒頭です。字下げは呼び出しの深さ、角括弧の中はその関数に入った時点の現在トークンとソース上の位置を表します。

```
parse_directives_and_statements  [Ident @0]
  [checkpoint] at 0
  parse_statement_list_item  [Ident @0]
    parse_expression_or_labeled_statement  [Ident @0]
      parse_assignment_expression_or_higher  [Ident @0]
        try_parse_parenthesized_arrow_function_expression  [Ident @0]
          is_parenthesized_arrow_function_expression  [Ident @0]
        try_parse_async_simple_arrow_function_expression  [Ident @0]
        parse_binary_expression_or_higher  [Ident @0]
          parse_lhs_expression_or_higher  [Ident @0]
            parse_primary_expression  [Ident @0]
            parse_member_expression_rest  [LAngle @1]
              parse_type_arguments_in_expression  [LAngle @1]
```

12行しかないのに、住所は4つのファイルにまたがります。

| 行  | 関数                                                     | 置き場所                     |
| --- | -------------------------------------------------------- | ---------------------------- |
| 1   | parse_directives_and_statements                          | js/statement.rs:33           |
| 3   | parse_statement_list_item                                | js/statement.rs:131          |
| 4   | parse_expression_or_labeled_statement                    | js/statement.rs:251          |
| 5   | parse_assignment_expression_or_higher                    | js/expression.rs:1479        |
| 6-8 | アロー関数を試す2つ                                      | js/arrow.rs                  |
| 9   | parse_binary_expression_or_higher                        | js/expression.rs:1304        |
| 10  | parse_lhs_expression_or_higher                           | js/expression.rs:748         |
| 11  | parse_primary_expression と parse_member_expression_rest | js/expression.rs:228 と :859 |
| 12  | parse_type_arguments_in_expression                       | ts/types.rs:914              |

最初の11行は全部 `js/` の下です。TypeScript 固有の処理に入るのは12行目、`ts/types.rs` を呼んだところが最初になります。型注釈もジェネリクスの宣言も無い1行ですが、`<` が1つあるだけで型のパーサーが起動します。

ちなみにトレースの一番上に `parse_program` (`lib.rs:817`) が出ていないのは、仕込みを `js/` と `ts/` と `jsx/` にしか入れなかったからです。実際の入口はそこで、最初のトークンを読んでハッシュバンを確認したあと、本体の文の列へ降りていきます。

1行目に出ている `[checkpoint] at 0` も今回の主役ではありません。これは unambiguous モードのときに文ごとに取る定型の取り置きで、トップレベルの `await` を識別子として読んでしまった場合に読み直せるようにするためのものです。山括弧の曖昧性とは無関係なので、以降は無視します。

6行目から8行目のアロー関数の試行も、今回は空振りです。`is_parenthesized_arrow_function_expression` (`js/arrow.rs:58`) は現在トークンで振り分ける `match` になっていて、`(` と `<` と `async` 以外は最後の腕で即座に偽を返します。先頭が識別子の `f` なので、checkpoint すら取らずに帰ってきます。トレースにその記録が出ていないのが証拠です。

## 境界は、後置を読むループの中の腕

JS 側と TS 側の継ぎ目は、11行目の `parse_member_expression_rest` (`js/expression.rs:859`) です。読み終えた左辺のうしろに続くものを、`loop` で1段ずつ積んでいく関数になっています。

```rust
let mut lhs = lhs;
loop {
    match self.cur_kind() {
        Kind::Dot         => { /* a.b */ }
        Kind::QuestionDot => { /* a?.b */ }
        Kind::LBrack      => { /* a[0] */ }
        テンプレートの開始 => { /* タグ付きテンプレート */ }
        Kind::Bang if self.is_ts && !self.cur_token().is_on_new_line() => { /* a! */ }
        Kind::LAngle | Kind::ShiftLeft if self.is_ts => { /* ここ */ }
        _ => return lhs,
    }
}
```

順番はこうです。`a.b[0]!` を読ませると、まず `a` の外側に `a.b` ができ、そのうえに `a.b[0]` が乗り、最後に非 null 表明が全体をくるみます。左から右へ積み上げていく形です。第0回に「TypeScript が JavaScript の式パーサーへ食い込んでいる」と書きましたが、その一番わかりやすい形がこれだと思います。もとからある後置 (ドット、角括弧、オプショナルチェーン、タグ付きテンプレート) と、TypeScript でしか使えない後置 (`!` と山括弧) が、ひとつの `match` に並んでいます。

拡張子が `.ts` ではなく `.js` のときは `self.is_ts` が偽になるので、山括弧の腕には入りません。そのまま `_ => return lhs` に落ちて、山括弧は上位の二項演算のはしごが比較として処理します。ひとつのパーサーで両方を賄う仕掛けが、ガード1つで実現されているわけです。

問題の腕の中身はこうです。

```rust
Kind::LAngle | Kind::ShiftLeft if self.is_ts => {
    if let Some(arguments) = self.parse_type_arguments_in_expression() {
        lhs = Expression::new_ts_instantiation_expression(
            self.end_span(lhs_start), lhs, arguments, self,
        );
    } else {
        self.lexer.rewrite_last_collected_token(self.token);
        return lhs;
    }
}
```

うまくいけば `TSInstantiationExpression` で包み、だめなら左辺をそのまま返します。失敗したときに山括弧は消費されないままなので、呼び出し元が比較演算子として読み直せます。`else` の側にある `rewrite_last_collected_token` は後で出てきます。

## 投機の中身

いよいよ `parse_type_arguments_in_expression` (`ts/types.rs:914`) です。ここだけで、トレースに残っているイベント行が全部説明できます。実物の出力では角括弧で始まる行に印が付いていて、これが checkpoint と rewind と再字句解析の発火を表します。

```
parse_type_arguments_in_expression  [LAngle @1]
  [checkpoint] at 1
  [re_lex L] at 1
  parse_ts_type  [Ident @2]
    ...
    parse_type_reference  [Ident @2]
      parse_ts_type_name  [Ident @2]
      parse_type_arguments_of_type_reference  [RAngle @3]
        [re_lex L] at 3
  [re_lex R] at 3
  can_follow_type_arguments_in_expr  [LParen @4]
```

関数は大きく5段です。順に見ていきます。

### 入る前に帰る道がある

最初にあるのは、現在トークンが `<` でも `<<` でもなければ即座に `None` を返す門番です。checkpoint を取るより手前に置かれているのがポイントで、ソースのコメントにも `a?.(` や `a?.b` のような普通の経路で、取っては巻き戻すという往復を払わずに済ませるため、と書いてあります。

トレースで `[checkpoint]` が山括弧の位置でしか出ないのは、この門番のおかげです。パーサーは後置を読むたびにこの関数を通りますが、ほとんどの場合はここで帰ります。

同じコメントには `<=` と `<<=` を弾く理由も書いてあります。先頭の1文字を割って型引数として読もうとすると、残りが `=` から始まる型になってしまう。ところが型の文法に `=` で始まる規則はないので、投機しても必ず失敗する。だから最初から試さない、という論法です。

### checkpoint が保存するもの

ここで `self.checkpoint()` (`cursor.rs:309`) を取ります。保存するのはレキサーの位置と、現在トークンと、直前トークンの終端と、エラーの件数と、致命的エラーの有無だけです。

うれしいのは、すでに arena に確保した AST ノードを巻き戻さないことです。投機に失敗しても、その間に作った木は放置されるだけで、誰からも参照されなくなります。bump allocator なので個別に解放する手段がそもそも無く、必要もない。投機パースの失敗が安いのは、この割り切りのおかげです。

ついでに整理しておくと、第0回で挙げた道具のうち先読みは、独立した機構ではありません。`lookahead` (`cursor.rs:340`) は checkpoint を取ってクロージャを走らせ、結果に関わらず無条件に rewind するだけの薄い皮です。投機パースとの違いは、成功しても巻き戻すかどうかだけ、ということになります。

### re-lex は今回の入力では空振りする

続いて `re_lex_ts_l_angle` (`cursor.rs:277`) を呼びます。トレースの `[re_lex L] at 1` がこれです。

ここは注意して読む必要がありました。イベントは関数の入口に仕込んであるので、実際に字句解析をやり直したかどうかとは無関係に出ます。中身を見ると、現在トークンが `ShiftLeft` か `LtEq` のときは2文字ぶん、`ShiftLeftEq` では3文字ぶん戻してレキサーに読み直させますが、もともと単独の `<` だった場合は `kind == Kind::LAngle` を返すだけで何もしません。

今回の入力はどちらも単独なので、ここは確認だけして素通りします。本当に割れるのは `f<<T>() => T>(x);` のような入れ子のときで、レキサーが最長一致で `<<` を作ってしまったのをパーサーが割り直させます。

割り直しを担うのは `lexer/typescript.rs` で、ファイル全体が53行しかありません。しかも関数は2つだけで、行数の大半はコメントです。読むと、左と右で後始末が非対称な理由が書いてあります。

| 向き | 状況                                                                        | 後始末                                                                                       |
| ---- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 左   | 複合トークンは checkpoint より前に収集済みのトークン列へ push されている    | 収集列の末尾を単独の山括弧で上書きし、投機が失敗したら呼び出し元が元の複合トークンを書き戻す |
| 右   | 閉じる側は最初から1文字ずつ切られていて、複合トークンは投機の最中に作られる | rewind の truncate が勝手に消すので、コードは不要                                            |

さっきの `parse_member_expression_rest` の `else` にあった `rewrite_last_collected_token` が、表の上段でいう書き戻しです。checkpoint の境界より手前を書き換えた者が失敗時の後始末を負う、という取り決めが、レキサーとパーサーのコメントで相互参照されながら文書化されています。

なお、閉じる側が1文字ずつなのは頻度の賭けだと思います。入れ子のジェネリクスを閉じる `>>` は日常的に書かれますが、`f<<T>` のような開き方は珍しい。よく出るほうを後から結合する設計にしておけば、巻き戻しのコードが1箇所減ります。

### 型を読む

門番を抜けたら、あとは素直に型引数のリストを読みます。`<` を食べて、カンマ区切りで `parse_ts_type` を呼ぶだけです。

トレースではここから型パーサーのはしごが顔を出します。ユニオン、インターセクション、型演算子、後置、配列でない型、型参照、という順に降りていって、`T` を読んで戻ってきます。

途中の `parse_type_arguments_of_type_reference` (`ts/types.rs:887`) で `[re_lex L] at 3` が出ているのは、`T` 自身がジェネリックかもしれないので山括弧が続くか確かめた跡です。実際の現在トークンは閉じる側なので、`re_lex_ts_l_angle` は偽を返して何もせずに帰ります。こちらも空振りでした。

### 最後の一手は、次のトークンを見るだけ

型を読み終えたら閉じる側の処理です。まず `re_lex_right_angle` (`cursor.rs:264`) を呼んで `>=` になっていないか確かめます。なっていたら即 rewind します。コメントに `a < b> = c` は妥当だが `a < b >= c` は BinaryExpression だ、とあって、ここで分けています。

そのあと `re_lex_ts_r_angle` (`cursor.rs:293`) で `>>` や `>>>` から1つぶんを切り出し、閉じる山括弧を食べます。そして最後に来るのが、この関数の心臓部です。

```rust
if self.fatal_error.is_some() || !self.can_follow_type_arguments_in_expr() {
    self.rewind(checkpoint);
    return None;
}
```

呼ばれている `can_follow_type_arguments_in_expr` (`ts/types.rs:955`) は、閉じたあとの1トークンを見るだけの判定です。

```rust
// ts/types.rs:955 can_follow_type_arguments_in_expr
fn can_follow_type_arguments_in_expr(&mut self) -> bool {
    match self.cur_kind() {
        Kind::LParen | Kind::NoSubstitutionTemplate | Kind::TemplateHead => true,
        Kind::LAngle | Kind::RAngle | Kind::Plus | Kind::Minus => false,
        _ => {
            self.cur_token().is_on_new_line()
                || self.is_binary_operator()
                || !self.is_start_of_expression()
        }
    }
}
```

`_` の腕を裏返すと、直後に式が始まってしまうときだけ却下する、と読めます。`;` や `)` や `,` は式を開始しないので採用されます。つまり `f<T>;` は、丸括弧が続かなくても `TSInstantiationExpression` として通ります。

今回の `f<T>(x);` は1行目に当たります。閉じたあとが `(` なので、その場で確定です。トレースの `can_follow_type_arguments_in_expr [LParen @4]` の直後に rewind が無いのは、そういうことです。

## 巻き戻る側

ではもう1本の入力です。同じ関数の入口まで、トレースはさっきと完全に一致します。checkpoint を取り、左の確認をし、型のはしごを降りて `b` を型として読み、右の確認をして、判定に到達します。

```
              parse_type_arguments_in_expression  [LAngle @2]
                [checkpoint] at 2
                [re_lex L] at 2
                parse_ts_type  [Ident @4]
                  ...
                [re_lex R] at 6
                can_follow_type_arguments_in_expr  [Ident @8]
                  is_start_of_expression  [Ident @8]
                    is_start_of_left_hand_side_expression  [Ident @8]
                [rewind] from 8 back to 2
```

判定に入った時点の現在トークンが、さっきは `(` で、今度は識別子の `c` です。さっきの表でいう3行目に落ち、`is_start_of_expression` (`ts/types.rs:1657`) を呼びます。この関数は最後の腕で `kind.is_ts_identifier(...)` を見るので、識別子に対して真を返します。式が始まってしまうので却下、というわけです。

意外だったのは、投機の最中に `c` が一度もパースされないことです。読んだのは `b` までで、`c` は判定のためにチラ見されただけ。山括弧の中身のパース自体は成功しています。`b` という名前の型があるかもしれないので、それは当然なのですが、失敗の原因が中身ではなく直後の1トークンにあるというのは、言われるまで気づきませんでした。

そして `[rewind] from 8 back to 2` です。位置8まで進んだ状態から、山括弧のところまで戻ります。ここで捨てられるのは、型として読んだ `b` の木と、読み進めたカーソルです。木のほうは arena に置き去りにされます。

帰ってきた `parse_member_expression_rest` は左辺の `a` をそのまま返し、二項演算のはしご `parse_binary_expression_rest` (`js/expression.rs:1322`) が山括弧を比較演算子として読み直します。

```
          parse_binary_expression_rest  [LAngle @2]
            parse_binary_expression_or_higher  [Ident @4]
              ...
            parse_binary_expression_or_higher  [Ident @8]
              ...
```

結果として `b` は2回パースされます。1回目は型として、2回目は式として。同じ文字を2度読むのが、曖昧性の代金です。

できあがる木は `(a < b) > c` で、比較を2回やったことになります。JavaScript として読んだときと同じ形に着地した、と言い換えてもいいと思います。

## 成功した側は、一瞬だけ別のノードになる

最後にひとつ、AST を見比べていて気づいた細かい話を。

投機が成功したとき、`parse_member_expression_rest` が作るのは `TSInstantiationExpression` です。ところが最終的な木にそのノードは出てきません。ダンプを見ると、CallExpression の `typeArguments` に型引数が直接ぶら下がっています。

種明かしは `parse_call_expression_rest` (`js/expression.rs:1091`) にありました。丸括弧を見つけたときに、左辺が `TSInstantiationExpression` なら中身を取り出して型引数を自分のほうへ付け替えています。包んだそばから開けているわけです。

包む側と開ける側が別の関数なのは、`f<T>` のあとに丸括弧が来るとは限らないからでしょう。来なければ包んだままが正解で、来たときだけ呼び出しの一部として畳み直す。関数を分けておけば、後置を積むループはそのことを知らなくて済みます。

## まとめ

1行の入力を追うだけで、ずいぶん多くのものが出てきました。

- TypeScript の処理に入る入口は、式のはしごの一番下にある後置のループでした。JavaScript の後置と同じ `match` に、TypeScript 固有の腕が2本並んでいます
- 投機パースの単位は思ったより大きく、型引数のリスト全体を読み切ってから成否を決めます。判定材料は閉じたあとの1トークンだけです
- 巻き戻しが安いのは arena のおかげで、失敗した木は解放されずに放置されます
- 字句解析のやり直しは、今回の2つの入力ではどちらも空振りでした。トレースに名前が出ていても仕事をしているとは限らない、というのは自分が引っかかったところです

そして、見た目の似た2行が最後の1判定で分かれるという構図そのものが、この言語の設計を物語っている気がします。山括弧を型引数に使うと決めた時点で、比較演算との衝突は避けられませんでした。Rust がターボフィッシュ (`::<>`) という独特の記法を採っているのは、まさにこの衝突を起こさないためです。似せる道を選んだ代償が、ここまで見てきた仕掛けの全部、ということになります。

次回は、このパーサーが吐く AST の形が誰の仕様に合わせて作られているのかを見ます。同じ `null` 型でも、木の形が本家とoxcで違う理由を追います。
