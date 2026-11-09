---
title: 「健全性」とTypeScript ── TAPL8章を添えて
description: 健全性とは何か。「進行」と「保存」という定義から出発して、TypeScriptが健全性をどこで手放しているのか、TypeScriptチームがなぜそれを直さないのかを読んでみました。
date: 2026-11-09
tags: ["TypeScript", "型システム", "健全性", "TAPL", "コンパイラ"]
---

先にひとこと。TAPL の第8章と Effective TypeScript の項目7は自分で読みましたが、issue やコードの確認、例の実行は Claude にやってもらった部分が多いです。間違いがあるかもしれません。

## きっかけ

最近、TypeScript をネイティブコードにコンパイルする試みを見かけます。たとえば [scriptc](https://github.com/vercel-labs/scriptc) や、Bun の `bun build --compile --aot` です。そういう話題だと「型が健全でないと困る」という話をよく目にするのですが、健全性という言葉が雰囲気でしかわかっていなかったので勉強してみました。

知りたかったのは、次の2つです。

1. 健全性とは何か
2. TypeScript は、健全性をどう扱っているのか

まず1つ目からいきます。

## 健全性の定義

健全性の定義は、『型システム入門』(TAPL、Pierce 著)の第8章に載っていました。真偽値と自然数だけの小さな言語を使って、定義を組み立てていく章です。

```text
t ::= true | false | if t then t else t     (真偽値)
    | 0 | succ t | pred t | iszero t         (数)
```

### 評価規則と「行き詰まり」

この言語には、項を1歩ずつ書き換える評価規則があります。`t → t'` は「`t` が1歩進んで `t'` になる」と読みます。`if` の規則は3つです。

```text
(E-IfTrue)   if true then t₂ else t₃  →  t₂

(E-IfFalse)  if false then t₂ else t₃  →  t₃

               t₁ → t₁'
(E-If)  ─────────────────────────────────────────────
        if t₁ then t₂ else t₃  →  if t₁' then t₂ else t₃
```

E-If は、条件がまだ値になっていないときに、条件の部分だけを1歩進める規則です。たとえば、こんなふうに進みます。

```text
if (iszero 0) then 0 else (pred 0)
  → if true then 0 else (pred 0)     … E-If (条件を進めた)
  → 0                                … E-IfTrue
```

`0` は値なので、ここで止まります。

じゃあ、止まるのは値のときだけかというと、そうでもないんですよね。`pred false` や `if 0 then 0 else 0` は、どの評価規則も当てはまりません。値でもないのに先へ進めないので、これを**行き詰まり状態**と呼びます。意味のないプログラムに当たるものです。

### 型付け規則

実行する前に「この項は行き詰まらない」と言えるようにしたい、というのが型の動機です。そこで、項を `Nat` と `Bool` に分類します。`t : T` は「項 `t` は型 `T` を持つ」という意味で、型付け規則から導出できたときにだけ成り立ちます。`if` の規則はこうです。

```text
t₁ : Bool    t₂ : T    t₃ : T
──────────────────────────────  (T-If)
   if t₁ then t₂ else t₃ : T
```

条件は `Bool` で、`then` と `else` は同じ型 `T` でなければいけません。これを満たさない項には型が付きません。この言語での「型エラー」は、規則から導出できない、という意味でした。

### 進行と保存

ここまで準備して、やっと定義です。TAPL は、型システムが安全(健全)であることを、次の2つの定理で定義します(8.3 節)。

| 定理                    | 内容                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| **進行** (progress)     | `t : T` なら、`t` は値であるか、1歩進める (`t → t'` となる `t'` がある) |
| **保存** (preservation) | `t : T` かつ `t → t'` なら、`t' : T`                                    |

ざっくり言うと、進行は「型が付いた項は行き詰まらない」、保存は「1歩進んでも、同じ型が付いたまま」です。この2つを繰り返し使えば、型が付いた項は、評価のどの時点でも行き詰まらないことが言えます。保存のおかげで、進行で見つかった次の項に、また進行を使えるわけですね。

読んでいて勘違いしそうだったところを2つ書いておきます。

- 進行が言っているのは、次の1歩があることだけです。値にたどり着くかどうかは別の話(この言語なら、評価が必ず終わるという正規化性)で、進行は何も言っていません。
- 保存で書き換わるのは**項**で、型ではありません。型が変わらない、と言っています。

### 証明のなかで型が効くところ

証明は、`t : T` の導出に関する帰納法です。`if` の場合を見ると、型がどこで効いているのかが分かりやすいです。

進行の `if` の場合は、帰納法の仮定から、条件 `t₁` は値であるか、進めます。進めるなら、E-If で `if` 全体も進みます。値なら、`t₁ : Bool` が効いてきます。`Bool` 型の値は `true` か `false` しかない、という補題(標準形補題)があるので、E-IfTrue か E-IfFalse が使えます。もし `t₁` が `0` のような値だったら、どちらの規則も使えず行き詰まりますが、型が付いていることで、その場合が消えています。

保存の `if` の場合は、進み方が3通りあります。E-IfTrue なら `t' = t₂` で、前提の `t₂ : T` がそのまま結論になります。E-If なら、条件が進んだ後の `if` に型を付け直す必要があって、帰納法の仮定から条件の型は保たれ、`t₂ : T` と `t₃ : T` は変わらないので、T-If をもう一度使えます。この規則が `then` と `else` に同じ型 `T` を要求していたのは、どっちで進んでも型が `T` のままになるため、だったんですね。

「型が付く」の条件と、「進める」「保つ」の証明が、うまく噛み合ってるんですねえ。

## 型を「値の集合」として読む

ここまでは型理論の側の話でした。TypeScript の側の見方は、Effective TypeScript の項目7で教えてもらいました。

> 型を値の集合(ドメイン)として考える

| TypeScript                               | 集合               |
| ---------------------------------------- | ------------------ |
| `never`                                  | 空集合             |
| リテラル型                               | 1要素の集合        |
| 値が `T` に代入可能                      | 値 ∈ T             |
| `T1` が `T2` に代入可能、`T1 extends T2` | T1 ⊆ T2 (部分集合) |
| ユニオン型                               | 和集合             |
| インターセクション型 (`&`)               | 積集合             |
| `unknown`                                | 全体集合           |

代入エラーも、この見方だと読み解けます。`'C'` を `'A' | 'B'` に代入できないのは、`{'C'}` が `{'A', 'B'}` の部分集合ではないからです。

気をつけたいのが `extends` で、「拡張」という言葉は、プロパティが増えるという構造の見方から来ています。集合の見方では、逆に狭くなります。`Vector3D`(`x`、`y`、`z` を持つ)は、`Vector1D`(`x` だけ)より条件が多いので、値の集合は小さくなるんですね。`A extends B` は「`A` は `B` の部分集合」と読み替えたほうが、混乱しません。

この見方だと、三項演算子の違いも説明しやすいです。TypeScript は、`then` と `else` が同じ型でなくても通して、2つの型のユニオンにします(`b ? 0 : "a"` は `0 | "a"`)。TAPL の T-If だと型なしなので、そのままは当てはまりません。でも、これが原因で不健全になるわけではなさそうです。値は `0` か `"a"` のどちらかなので `0 | "a"` に収まっていますし、1歩進んで `0` になっても、`0` は `0 | "a"` の部分集合です。保存を「同じ型」から「型が付いたまま(小さくなってもよい)」に緩めれば成り立ちそうで、TAPL の脚注にも、部分型を持つ体系では評価の途中で型が小さくなることがある、と書いてありました。このあと見る穴も、どれも `if` の規則の話ではありません。

## TypeScriptはどこで手放しているのか

ここまでで1つ目の問いは一通り見たので、2つ目に進みます。実際の TypeScript はどうなっているでしょうか。以下のコードは、`strict` を有効にして、Claude に tsrs(Rust 製の TypeScript 移植版)で検査してもらいました。

### 例1: 配列の共変

```ts
class Animal {}
class Hen extends Animal {}
class Fox extends Animal {}

function addFoxOrHen(animals: Animal[]) {
  animals.push(Math.random() > 0.5 ? new Fox() : new Hen());
}

const henhouse: Hen[] = [new Hen()];
addFoxOrHen(henhouse); // エラーなし
```

`Hen[]` を `Animal[]` として渡せてしまいます。でも関数の中では `Fox` を `push` できるので、`Hen[]` と型が付いた配列に `Fox` が入ります。値が `Hen[]` のドメインの外に出ているので、保存が崩れている例だと読めます。

### 例2: インデックスアクセス

```ts
type IdToName = { [id: string]: string };
const ids: IdToName = { "007": "James Bond" };
const agent = ids["008"]; // 型は string、実行時の値は undefined
agent.length; // エラーなし。実行時は TypeError
```

`agent` の型は `string` ですが、値は `undefined` です。`string` 型の値は文字列、という約束(標準形補題に当たるもの)が崩れて、`agent.length` で行き詰まります。進行も壊れていますね。

`noUncheckedIndexedAccess` を有効にすると、`ids["008"]` の型が `string | undefined` になって、`agent.length` がエラーになりました(実際に確認してもらいました)。

### 例3: 型アサーション

```ts
function logNumber(x: number) {
  console.log(x.toFixed(1));
}
const hour = new Date().getHours() || null; // number | null
logNumber(hour as number); // エラーなし。null なら実行時エラー
```

`as` は、実行時の検査なしに、型だけを書き換えます。TAPL 風に言うなら、下向きのキャストに実行時チェックがない形です。

### 逆に、拒否される例

Effective TypeScript の訳者補記に、「もし `[number, number, number]` を `[number, number]` に代入できたら」という例があります。

```ts
const triple: [number, number, number] = [1, 2, 3];
const double: [number, number] = triple; // 拒否される
```

tsrs はこの代入をエラーにしました(`Source has 3 element(s) but target allows only 2.`)。許してしまうと、型と実行時の値が食い違うからです。部分集合でない代入は許さない、という規則が、ここではちゃんと効いています。

例1〜3は、どれも Effective TypeScript の「健全性の罠」に載っている穴です。

## なぜ直さないのか

穴があるなら直せばいいのに、と思ってしまいますが、TypeScript チームは、この点についてはっきり答えていました。2016年に立った issue [#9825](https://github.com/microsoft/TypeScript/issues/9825)「Type-checking unsoundness: standardize treatment of such issues among TypeScript team/community?」です。

### 三角形

TypeScript チームの Ryan Cavanaugh が [こう書いています](https://github.com/microsoft/TypeScript/issues/9825#issuecomment-234115900)。

> 100% soundness is _not_ a design goal. Soundness, usability, and complexity form a trade-off triangle. There's no such thing as a sound, simple, useful type system.

例は、さっきの例1の `Animal[]` と同じです。解き方は3通りあるそうです。

| 解き方                   | 内容                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 単純、使える、不健全     | 今の TypeScript                                                                                                                                                             |
| 単純、健全、使えない     | サブタイプによる置換をすべて拒否する。`Node#addChild` が `Node` 以外を受けなくなる                                                                                          |
| 健全、使える、単純でない | ミュータブルかどうかの概念と、共変・反変の注釈を持つ(C++ の `const`、C# の `in` / `out`)。`const` 正しさは感染するので、すべての `.d.ts` が変更の有無を正しく書く必要がある |

### JSの実行時の性質

もう1つの理由は、[JS の実行時の挙動](https://github.com/microsoft/TypeScript/issues/9825#issuecomment-306272034)です。getter は呼ぶたびに違う値を返せるし、`valueOf` や `toString` は何でもできるので、`x + y` の型が非決定的になりうるし、`delete` の副作用は型で書き表しにくいし、配列は疎になれます。Ryan は、既存の JS の構文の上に完全に健全な型システムを作ることを「fool's errand」(愚かな試み)と呼んでいます。なかなか強い言葉ですね。

### 健全性は代用指標

[別のコメント](https://github.com/microsoft/TypeScript/issues/9825#issuecomment-350921122)には、こう書かれています。

> Provable soundness is a _proxy measure_ for that effort.

型システムは、正しいプログラムを書くための道具で、証明できる健全性は、その代用指標にすぎない、という考え方です。JSON を読む時点で型キャストが要りますし、キャストを許すなら、最終的な健全性は、プログラマがキャストを正しく書くかどうかに左右されます。だから、できる最善は、表現力を足して、起こりうる誤りを捕まえることだ、と言っています。TypeScript と Flow を比べた論文で、後者の少し厳しい健全性のおかげだけで見つかったバグはなかった、という話も出てきますが、この論文は私は確認していません。

### 実測で決めた

同じくチームの mhegazy は、[設計の決め方](https://github.com/microsoft/TypeScript/issues/9825#issuecomment-233843817)についてこう書いています。ある変更を実装して、実際のコードベースで試して、報告されたエラーのうち本物のバグが何割かを見る。厳密な科学ではないけれど、「純粋に良いと思った変更の多くが、実コードで試すとそうではなかった」とのことです。型システムの振る舞いを変えるフラグを避けてきた理由も書いてあって、オプション疲れと、言語が「モード」で分裂するのを避けるためだそうです。

ただし、Ryan は同じ issue で「デフォルトの立場は soundness over completeness でもある」とも書いています(`number | string` に `substr` を呼ばせたりはしない)。不健全なところは、意図的に選んだ、限られた箇所だということみたいです。

### 今も同じ立場

この立場は、今も変わっていないようです。

- 2024年の [#57783](https://github.com/microsoft/TypeScript/issues/57783) は、メソッドにも `strictFunctionTypes` を効かせるオプションの提案でした。Ryan は、そのオプションを入れると配列が不変になって、`const arr: number[] = [];` すら書けなくなると答えています(右辺が `never[]` になるため)。コアの lib も壊れるそうです。
- 2026年4月の [typescript-go#3576](https://github.com/microsoft/typescript-go/issues/3576) は、可変な配列を不変にするオプションの提案でした。Ryan は、不変な配列は大量の問題を持っていて、実装がなかったから見送ってきたのではなく、過去に何度も検討したと答えています。

## まとめ

最初の2つの問いに戻ります。

**1. 健全性とは何か。** 型システムが、型の付いたすべての項について、進行と保存を満たすことです。型が付いたプログラムは、実行時に行き詰まらず(進行)、1歩進んでも同じ型が付いたままである(保存)。

**2. TypeScript は、健全性をどう扱っているのか。** 保証していません。配列の共変、インデックスアクセス、型アサーションなどの穴があって、チームはそれを意図した設計だと言っています。代わりに目指しているのは、「起こりうる誤りの多くを、表現力のある型で捕まえること」で、証明は目的ではないようです。

あと、穴はチェッカーの中だけにあるとは限りません。`.d.ts` が実際の挙動を正しく表していなければ、チェッカーが正しくても、型と実行時の値は食い違います。これはチェッカーの外の穴ですね。

## 参考

- Benjamin C. Pierce 『型システム入門 ― プログラミング言語と型の理論』(TAPL)第8章
- Dan Vanderkam 『Effective TypeScript』項目7「型を値の集合として考える」
- [microsoft/TypeScript#9825](https://github.com/microsoft/TypeScript/issues/9825)
- [microsoft/TypeScript#57783](https://github.com/microsoft/TypeScript/issues/57783)
- [microsoft/typescript-go#3576](https://github.com/microsoft/typescript-go/issues/3576)
