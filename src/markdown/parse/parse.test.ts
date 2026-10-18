// 単体テストは Node（vitest.config.ts）と、ブラウザ（vrt/vitest.parse.config.ts）の両方で動かす。
// parse.test.ts は、どちらでも動くように Node 専用の API を使わない。

import { parseDocument, parseMarkdown } from "#markdown/parse/index.js";
import { describe, expect, test } from "vitest";

import type { MdastNode } from "#markdown/types.js";

/** AST を 1 行の S 式にして、期待値を書きやすくする。位置は含めない。 */
function sexp(node: MdastNode): string {
  switch (node.type) {
    case "text":
      return JSON.stringify(node.value);
    case "inlineCode":
      return `code(${JSON.stringify(node.value)})`;
    case "code":
      return `fence(${node.lang ?? ""}${node.meta ? ` ${node.meta}` : ""}:${JSON.stringify(node.value)})`;
    case "thematicBreak":
      return "hr";
    case "break":
      return "br";
    case "image":
      return `img(${node.url},${JSON.stringify(node.alt ?? "")}${node.title ? `,${JSON.stringify(node.title)}` : ""})`;
    case "link":
      return `a(${node.url}${node.title ? `,${JSON.stringify(node.title)}` : ""}: ${node.children.map(sexp).join(" ")})`;
    case "heading":
      return `h${node.depth}(${node.children.map(sexp).join(" ")})`;
    case "list":
      return `${node.ordered ? `ol${node.start ?? 1}` : "ul"}(${node.children.map(sexp).join(" ")})`;
    case "table":
      return `table[${(node.align ?? []).map((a) => a ?? "-").join(",")}](${node.children.map(sexp).join(" ")})`;
    default:
      return `${shortName(node.type)}(${"children" in node ? node.children.map(sexp).join(" ") : ""})`;
  }
}

const SHORT: Record<string, string> = {
  root: "root",
  paragraph: "p",
  emphasis: "em",
  strong: "strong",
  blockquote: "quote",
  listItem: "li",
  tableRow: "tr",
  tableCell: "td",
};
const shortName = (type: string) => SHORT[type] ?? type;

/** 本文を解析して、root の子を S 式にして返す。 */
function md(source: string): string {
  const ast = parseMarkdown(source).ast;
  return "children" in ast ? ast.children.map(sexp).join(" ") : "";
}

const errors = (source: string) =>
  parseMarkdown(source)
    .diagnostics.filter((d) => d.severity === "error")
    .map((d) => d.ruleId);
const warnings = (source: string) =>
  parseMarkdown(source)
    .diagnostics.filter((d) => d.severity === "warning")
    .map((d) => d.ruleId);

describe("インライン", () => {
  test("強調と太字", () => {
    expect(md("a *b* c")).toBe('p("a " em("b") " c")');
    expect(md("a **b** c")).toBe('p("a " strong("b") " c")');
    expect(md("a ***b*** c")).toBe('p("a " em(strong("b")) " c")');
    expect(md("*a **b** c*")).toBe('p(em("a " strong("b") " c"))');
  });

  test("単語の途中の _ は強調にしない（snake_case の識別子）", () => {
    expect(md("oxc_parser と parse_call_expression_rest")).toBe(
      'p("oxc_parser と parse_call_expression_rest")',
    );
    expect(md("_a_ と a_b_c")).toBe('p(em("a") " と a_b_c")');
  });

  test("閉じられない記号は、そのまま文字にする", () => {
    expect(md("a * b")).toBe('p("a * b")');
    expect(md("**a")).toBe('p("**a")');
    expect(md("*a")).toBe('p("*a")');
  });

  test("日本語の中の強調", () => {
    expect(md("これは**大事**です")).toBe('p("これは" strong("大事") "です")');
  });

  test("インラインコード", () => {
    expect(md("a `b` c")).toBe('p("a " code("b") " c")');
    expect(md("``a ` b``")).toBe('p(code("a ` b"))');
    expect(md("` ``` `")).toBe('p(code("```"))');
    expect(md("`` }c` ``")).toBe('p(code("}c`"))');
    expect(md("`a\nb`")).toBe('p(code("a b"))');
    expect(md("`未完")).toBe('p("`未完")');
  });

  test("コードの中は解釈しない", () => {
    expect(md("`*a* [b](c) <d>`")).toBe('p(code("*a* [b](c) <d>"))');
  });

  test("リンクと画像", () => {
    expect(md("[a](https://x.y)")).toBe('p(a(https://x.y: "a"))');
    expect(md('[a](/p "title")')).toBe('p(a(/p,"title": "a"))');
    expect(md("[a *b*](/p)")).toBe('p(a(/p: "a " em("b")))');
    expect(md("[a](/p(q))")).toBe('p(a(/p(q): "a"))');
    expect(md("[a](<my page.md>)")).toBe('p(a(my page.md: "a"))');
    expect(md("![alt *x*](/a.png)")).toBe('p(img(/a.png,"alt x"))');
    expect(md("![](/a.png)")).toBe('p(img(/a.png,""))');
  });

  test("リンクに見えないものは文字にする", () => {
    expect(md("[a] (b)")).toBe('p("[a] (b)")');
    expect(md("配列 [T] の型")).toBe('p("配列 [T] の型")');
  });

  test("リンクの中にリンクは作らない", () => {
    expect(md("[a [b](c) d](e)")).toBe('p("[a " a(c: "b") " d](e)")');
  });

  test("<url> の自動リンク", () => {
    expect(md("<https://example.com/a?b=1>")).toBe(
      'p(a(https://example.com/a?b=1: "https://example.com/a?b=1"))',
    );
    expect(md("a < b と c > d")).toBe('p("a < b と c > d")');
  });

  test("エスケープ", () => {
    expect(md("\\*a\\* と \\[b\\]")).toBe('p("*a* と [b]")');
    expect(md("a\\b")).toBe('p("a\\\\b")');
  });

  test("改行: ソフトは \\n、ハードは break", () => {
    expect(md("a\nb")).toBe('p("a\\nb")');
    expect(md("a  \nb")).toBe('p("a" br "b")');
    expect(md("a\\\nb")).toBe('p("a" br "b")');
  });
});

describe("ブロック", () => {
  test("見出し", () => {
    expect(md("## a *b*")).toBe('h2("a " em("b"))');
    expect(md("### a ###")).toBe('h3("a")');
    expect(md("#a")).toBe('p("#a")');
    expect(md("####### a")).toBe('p("####### a")');
    expect(md("##")).toBe("h2()");
  });

  test("段落は空行で区切る", () => {
    expect(md("a\nb\n\nc")).toBe('p("a\\nb") p("c")');
  });

  test("段落は、見出し・フェンス・引用・水平線で打ち切られる", () => {
    expect(md("a\n# h")).toBe('p("a") h1("h")');
    expect(md("a\n```\nx\n```")).toBe('p("a") fence(:"x\\n")');
    expect(md("a\n> q")).toBe('p("a") quote(p("q"))');
    expect(md("a\n***")).toBe('p("a") hr');
  });

  test("水平線", () => {
    expect(md("a\n\n---\n\nb")).toBe('p("a") hr p("b")');
    expect(md("***")).toBe("hr");
    expect(md("* * *")).toBe("hr");
  });

  test("引用", () => {
    expect(md("> a\n> b")).toBe('quote(p("a\\nb"))');
    expect(md("> a\nb")).toBe('quote(p("a\\nb"))');
    expect(md("> a\n\nb")).toBe('quote(p("a")) p("b")');
    expect(md("> # h\n> text")).toBe('quote(h1("h") p("text"))');
    expect(md("> > nested")).toBe('quote(quote(p("nested")))');
  });

  test("箇条書き", () => {
    expect(md("- a\n- b")).toBe('ul(li(p("a")) li(p("b")))');
    expect(md("* a\n+ b")).toBe('ul(li(p("a"))) ul(li(p("b")))');
  });

  test("番号付きリスト", () => {
    expect(md("1. a\n2. b")).toBe('ol1(li(p("a")) li(p("b")))');
    expect(md("3. a\n4. b")).toBe('ol3(li(p("a")) li(p("b")))');
    expect(md("1) a\n2) b")).toBe('ol1(li(p("a")) li(p("b")))');
  });

  test("ネストしたリスト", () => {
    expect(md("- a\n  - b\n  - c\n- d")).toBe(
      'ul(li(p("a") ul(li(p("b")) li(p("c")))) li(p("d")))',
    );
    expect(md("1. a\n   - b\n2. c")).toBe('ol1(li(p("a") ul(li(p("b")))) li(p("c")))');
  });

  test("項目の中の複数の段落とコード", () => {
    expect(md("- a\n\n  b\n- c")).toBe('ul(li(p("a") p("b")) li(p("c")))');
    expect(md("- a\n  ```ts\n  x\n  ```")).toBe('ul(li(p("a") fence(ts:"x\\n")))');
  });

  test("空行を挟んでも、同じ種類のリストは続く", () => {
    expect(md("- a\n\n- b")).toBe('ul(li(p("a")) li(p("b")))');
  });

  test("リストの遅延継続", () => {
    expect(md("- a\nb")).toBe('ul(li(p("a\\nb")))');
  });

  test("リストが段落を割り込む条件", () => {
    expect(md("a\n- b")).toBe('p("a") ul(li(p("b")))');
    expect(md("a\n2. b")).toBe('p("a\\n2. b")');
    expect(md("a\n1. b")).toBe('p("a") ol1(li(p("b")))');
  });

  test("フェンスコード", () => {
    expect(md("```ts\nconst a = 1;\n```")).toBe('fence(ts:"const a = 1;\\n")');
    expect(md('```tsx title="app/x.tsx"\nx\n```')).toBe('fence(tsx title="app/x.tsx":"x\\n")');
    expect(md("```\nplain\n```")).toBe('fence(:"plain\\n")');
    expect(md("~~~\nx\n~~~")).toBe('fence(:"x\\n")');
    expect(md("````md\n```\ninner\n```\n````")).toBe('fence(md:"```\\ninner\\n```\\n")');
    expect(md("```\n\n\n```")).toBe('fence(:"\\n\\n")');
    expect(md("```\n```")).toBe('fence(:"")');
  });

  test("フェンスの中は何も解釈しない", () => {
    expect(md("```\n# h\n- a\n> q\n```")).toBe('fence(:"# h\\n- a\\n> q\\n")');
  });

  test("閉じられないフェンスは、文末までをコードにして警告する", () => {
    expect(md("```\nx")).toBe('fence(:"x\\n")');
    expect(warnings("```\nx")).toContain("unclosed-fence");
  });

  test("インデントされたフェンス", () => {
    expect(md("- a\n\n  ```\n  x\n  ```")).toBe('ul(li(p("a") fence(:"x\\n")))');
  });

  test("表", () => {
    expect(md("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(
      'table[-,-](tr(td("a") td("b")) tr(td("1") td("2")))',
    );
    expect(md("| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |")).toBe(
      'table[left,center,right](tr(td("a") td("b") td("c")) tr(td("1") td("2") td("3")))',
    );
    expect(md("a | b\n--- | ---\n1 | 2")).toBe(
      'table[-,-](tr(td("a") td("b")) tr(td("1") td("2")))',
    );
  });

  test("表のセルの中", () => {
    expect(md("| `a|b` | c \\| d |\n| - | - |\n| *x* | [l](/p) |")).toBe(
      'table[-,-](tr(td(code("a|b")) td("c | d")) tr(td(em("x")) td(a(/p: "l"))))',
    );
  });

  test("表の列が足りない行は、空のセルで埋める", () => {
    expect(md("| a | b |\n| - | - |\n| 1 |")).toBe(
      'table[-,-](tr(td("a") td("b")) tr(td("1") td()))',
    );
  });

  test("区切り行がなければ表にしない", () => {
    expect(md("a | b\nc | d")).toBe('p("a | b\\nc | d")');
    expect(md("| a | b |\n| - |")).toBe('p("| a | b |\\n| - |")');
  });

  test("表は空行で終わる", () => {
    expect(md("| a |\n| - |\n| 1 |\n\ntext")).toBe('table[-](tr(td("a")) tr(td("1"))) p("text")');
  });

  test("引用の中のリストと表", () => {
    expect(md("> - a\n> - b")).toBe('quote(ul(li(p("a")) li(p("b"))))');
    expect(md("> | a |\n> | - |\n> | 1 |")).toBe('quote(table[-](tr(td("a")) tr(td("1"))))');
  });

  test("CRLF の改行", () => {
    expect(md("# a\r\n\r\ntext\r\nmore")).toBe('h1("a") p("text\\nmore")');
  });
});

describe("未対応の構文は、黙って落とさず error にする", () => {
  test.each([
    ["取り消し線", "~~a~~"],
    ["脚注", "文[^1]\n\n[^1]: 注"],
    ["生の HTML（ブロック）", "<div>a</div>"],
    ["生の HTML（インライン）", "a <span>b</span> c"],
    ["HTML コメント", "<!-- a -->"],
    ["Setext 見出し", "見出し\n---"],
    ["タスクリスト", "- [ ] a\n- [x] b"],
    ["参照リンクの定義", "[a]: https://example.com"],
    ["インデントのコード", "text\n\n    code"],
  ])("%s", (_, source) => {
    expect(errors(source)).toContain("unsupported-syntax");
  });

  test("コードの中の HTML や記号は、問題にしない", () => {
    expect(errors("`<div>` と `~~a~~`\n\n```html\n<div>a</div>\n```")).toEqual([]);
    expect(errors("配列 `Array<T>` の話")).toEqual([]);
  });
});

describe("検証（lint）", () => {
  test("危険な URL", () => {
    expect(errors("[a](javascript:alert(1))")).toContain("unsafe-url");
    expect(errors("![a](data:image/png;base64,AAAA)")).toContain("unsafe-url");
  });

  test("安全な URL", () => {
    for (const url of [
      "https://a.b/c",
      "http://a.b",
      "mailto:a@b.c",
      "tel:+81",
      "/p",
      "./p",
      "../p",
      "#h",
      "a/b.md",
      "x.png",
    ]) {
      expect(errors(`[a](${url})`), url).toEqual([]);
    }
  });

  test("見出しのレベルが飛ぶ", () => {
    expect(errors("## a\n\n#### b")).toContain("heading-increment");
    expect(errors("## a\n\n### b\n\n## c")).toEqual([]);
    expect(errors("### 最初はどのレベルでもよい")).toEqual([]);
  });

  test("見出しの重複", () => {
    expect(errors("## a\n\n## a")).toContain("duplicate-heading");
    expect(errors("## a\n\n## b")).toEqual([]);
  });

  test("同じ英単語が続く", () => {
    expect(errors("the the cat")).toContain("repeated-word");
    expect(errors("the cat")).toEqual([]);
    // 離れていれば問題にしない（「Git を…Git を」のような近接は、誤検知が多いので見ない）。
    expect(errors("Git を使い、保存のたびに Git を操作する")).toEqual([]);
  });

  test("句読点の重複は警告にとどめる", () => {
    expect(warnings("おわり。。")).toContain("repeated-punctuation");
    expect(errors("おわり。。")).toEqual([]);
  });

  test("行末の空白は error、コードの中は対象外", () => {
    expect(errors("a \nb")).toContain("trailing-spaces");
    expect(errors("```\na \n```")).toEqual([]);
  });

  test("空行が続くのは警告。コードブロック直後の空行 1 つは問題にしない", () => {
    expect(warnings("a\n\n\nb")).toContain("max-consecutive-blank-lines");
    expect(warnings("## A\n\n```\ncode\n```\n\n## B")).toEqual([]);
  });
});

describe("frontmatter", () => {
  test("記事で使っている書き方", () => {
    const doc = parseDocument(
      '---\ntitle: 題名\ndescription: 説明\ndate: 2026-01-01\ntags: ["a", "b c"]\ndraft: true\n---\n\n本文',
    );
    expect(doc.frontmatter).toEqual({
      title: "題名",
      description: "説明",
      date: "2026-01-01",
      tags: ["a", "b c"],
      draft: true,
    });
    expect(doc.body).toBe("本文");
    expect(doc.diagnostics).toEqual([]);
  });

  test("引用符つきの値、行末のコメント、行で書く配列", () => {
    const doc = parseDocument(
      '---\ntitle: "a: b"\ndate: 2026-01-01 # 日付\ntags:\n  - x\n  - y\n---\n本文',
    );
    expect(doc.frontmatter).toEqual({ title: "a: b", date: "2026-01-01", tags: ["x", "y"] });
  });

  test("frontmatter がなければ error", () => {
    const doc = parseDocument("本文だけ");
    expect(doc.frontmatter).toBeNull();
    expect(doc.diagnostics.map((d) => d.ruleId)).toContain("frontmatter");
  });

  test.each([
    ["title がない", "---\ndate: 2026-01-01\n---\nx"],
    ["date の形式が違う", "---\ntitle: a\ndate: 2026/01/01\n---\nx"],
    ["draft が真偽値でない", "---\ntitle: a\ndate: 2026-01-01\ndraft: yes\n---\nx"],
    ["tags が配列でない", "---\ntitle: a\ndate: 2026-01-01\ntags: abc\n---\nx"],
    ["閉じられていない", "---\ntitle: a\ndate: 2026-01-01\nx"],
    ["キーの重複", "---\ntitle: a\ntitle: b\ndate: 2026-01-01\n---\nx"],
  ])("%s", (_, raw) => {
    expect(
      parseDocument(raw).diagnostics.filter((d) => d.severity === "error").length,
    ).toBeGreaterThan(0);
  });
});

describe("位置情報", () => {
  const source = "# 見出し\n\n段落 [リンク](/p)\n\n- 項目\n  - 入れ子\n\n```ts\ncode\n```\n";

  function find(node: MdastNode, type: string): MdastNode | undefined {
    if (node.type === type) return node;
    for (const child of "children" in node ? node.children : []) {
      const found = find(child, type);
      if (found) return found;
    }
    return undefined;
  }

  test("ノードの範囲が、ソースの該当部分を指す", () => {
    const ast = parseMarkdown(source).ast;
    const slice = (node?: MdastNode) =>
      source.slice(node?.position?.start.offset, node?.position?.end.offset);
    expect(slice(find(ast, "heading"))).toBe("# 見出し");
    expect(slice(find(ast, "link"))).toBe("[リンク](/p)");
    expect(slice(find(ast, "code"))).toBe("```ts\ncode\n```");
    expect(slice(find(ast, "listItem"))).toBe("- 項目\n  - 入れ子");
  });

  test("入れ子の中のノードも、ソース上の正しい位置を指す", () => {
    const ast = parseMarkdown(source).ast;
    const nested = find(find(ast, "listItem") as MdastNode & { children: MdastNode[] }, "list");
    const inner = nested && "children" in nested ? nested.children[0] : undefined;
    expect(source.slice(inner?.position?.start.offset, inner?.position?.end.offset)).toBe(
      "- 入れ子",
    );
  });

  test("行と桁は 1 始まり", () => {
    const heading = find(parseMarkdown(source).ast, "heading");
    expect(heading?.position?.start).toEqual({ line: 1, column: 1, offset: 0 });
    const link = find(parseMarkdown(source).ast, "link");
    expect(link?.position?.start.line).toBe(3);
  });

  test("診断の位置は、frontmatter を含む記事全体の先頭からのもの", () => {
    const raw = "---\ntitle: a\ndate: 2026-01-01\n---\n\n## a\n\n#### b\n";
    const diagnostic = parseDocument(raw).diagnostics.find((d) => d.ruleId === "heading-increment");
    expect(raw.slice(diagnostic?.from, diagnostic?.to)).toBe("#### b");
    expect(diagnostic?.line).toBe(8);
    expect(diagnostic?.column).toBe(1);
  });

  test("コードの外の行末の空白の位置", () => {
    const raw = "---\ntitle: a\ndate: 2026-01-01\n---\n\nabc  \n```\nx \n```\n";
    const diagnostics = parseDocument(raw).diagnostics.filter(
      (d) => d.ruleId === "trailing-spaces",
    );
    expect(diagnostics).toHaveLength(1);
    expect(raw.slice(diagnostics[0]?.from, diagnostics[0]?.to)).toBe("  ");
  });
});

describe("例外を投げない（書きかけの入力でも、必ず AST と診断を返す）", () => {
  // ブラウザでも同じテストを動かすため、node:fs ではなく Vite の glob で記事を読む。
  const posts = Object.values(
    import.meta.glob<string>("../../../content/posts/*.md", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  );

  test("既存の記事を、いろいろな長さで切った入力", () => {
    for (const raw of posts) {
      for (let end = 0; end <= raw.length; end += 97) {
        expect(() => parseDocument(raw.slice(0, end))).not.toThrow();
      }
    }
  });

  test("Markdown の記号をランダムに並べた入力", () => {
    // 再現できるように、乱数は固定の種から作る。
    let seed = 12345;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const pieces = [
      "#",
      "##",
      "-",
      "*",
      "**",
      "_",
      "`",
      "``",
      "```",
      "~~~",
      ">",
      "1.",
      "[",
      "]",
      "(",
      ")",
      "![",
      "<",
      ">",
      "|",
      ":--",
      "\\",
      "\n",
      "\n\n",
      " ",
      "  ",
      "\t",
      "a",
      "あ",
      "http://x",
      "---",
      "<b>",
      "&amp;",
    ];
    for (let n = 0; n < 3000; n++) {
      let source = "";
      const length = 1 + Math.floor(random() * 40);
      for (let k = 0; k < length; k++) source += pieces[Math.floor(random() * pieces.length)] ?? "";
      expect(() => parseMarkdown(source), JSON.stringify(source)).not.toThrow();
    }
  });

  test("深い入れ子でも、スタックを使い切らない", () => {
    expect(() => parseMarkdown(`${"> ".repeat(300)}a`)).not.toThrow();
    expect(() => parseMarkdown(`${"- ".repeat(300)}a`)).not.toThrow();
    expect(() => parseMarkdown(`${"*a ".repeat(2000)}`)).not.toThrow();
    expect(() => parseMarkdown(`${"[".repeat(5000)}`)).not.toThrow();
  });
});
