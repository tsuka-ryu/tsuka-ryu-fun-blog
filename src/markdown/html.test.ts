import { mdastToHtml } from "#markdown/html.js";
import { parseMarkdown } from "#markdown/parse/index.js";
import { describe, expect, test } from "vitest";

const html = (source: string, origin?: string) =>
  mdastToHtml(parseMarkdown(source).ast, { origin });

describe("mdastToHtml", () => {
  test("段落・強調・コード・見出し", () => {
    expect(html("## 見出し\n\na *b* **c** `d`")).toBe(
      "<h2>見出し</h2>\n<p>a <em>b</em> <strong>c</strong> <code>d</code></p>\n",
    );
  });

  test("HTML の特殊文字をエスケープする", () => {
    expect(html('a < b & c > d "e"')).toBe("<p>a &lt; b &amp; c &gt; d &quot;e&quot;</p>\n");
    expect(html("```html\n<div>&</div>\n```")).toBe(
      '<pre><code class="language-html">&lt;div&gt;&amp;&lt;/div&gt;\n</code></pre>\n',
    );
  });

  test("リスト（ネスト・番号の開始）", () => {
    expect(html("1. a\n2. b")).toBe("<ol>\n<li><p>a</p>\n</li>\n<li><p>b</p>\n</li>\n</ol>\n");
    expect(html("3. a")).toContain('<ol start="3">');
  });

  test("リンクと画像。origin を指定すると、サイト内の URL を絶対 URL にする", () => {
    expect(html("[a](/p) [b](https://x.y) ![c](/i.png)", "https://e.com")).toBe(
      '<p><a href="https://e.com/p">a</a> <a href="https://x.y">b</a> <img src="https://e.com/i.png" alt="c" /></p>\n',
    );
    expect(html("[a](//cdn.x/y)", "https://e.com")).toContain('href="//cdn.x/y"');
  });

  test("表（配置つき）", () => {
    expect(html("| a | b |\n| :- | -: |\n| 1 | 2 |")).toBe(
      '<table>\n<thead>\n<tr><th style="text-align:left">a</th><th style="text-align:right">b</th></tr>\n</thead>\n<tbody>\n<tr><td style="text-align:left">1</td><td style="text-align:right">2</td></tr>\n</tbody>\n</table>\n',
    );
  });

  test("引用・水平線・改行", () => {
    expect(html("> q\n\n---\n\na  \nb")).toBe(
      "<blockquote>\n<p>q</p>\n</blockquote>\n<hr />\n<p>a<br />\nb</p>\n",
    );
  });
});
