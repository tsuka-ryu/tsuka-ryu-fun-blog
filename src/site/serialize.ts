// 記事の内容（編集中の項目）を、frontmatter 付きの Markdown 原文にする。依存を持たない純粋な処理で、
// サーバー（公開・`.md` 配信）とブラウザ（エディタのプレビュー）の両方から使う。

/** 編集中の記事の項目（`slug` 以外）。 */
export interface PostFields {
  title: string;
  description: string;
  /** `YYYY-MM-DD`。 */
  date: string;
  tags: string[];
  /** frontmatter を含まない本文の Markdown。 */
  body: string;
}

/** YAML の値として、そのまま書いても読み違えられない文字列か。 */
function isPlainScalar(value: string): boolean {
  return (
    /^[^\s"'[\]{}#&*!|>%@`,:?-]/.test(value) &&
    !/[:#]\s|\s$|\n/.test(value) &&
    !/^(true|false|null|~)$/.test(value) &&
    !/^-?\d+(\.\d+)?$/.test(value)
  );
}

function yamlString(value: string): string {
  if (isPlainScalar(value)) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/**
 * 記事の内容を、frontmatter 付きの Markdown 原文にする（`/posts/<slug>.md` で配信し、バックアップを兼ねる）。
 * 項目の並びは、既存の記事と同じ（title / description / date / tags）。
 */
export function serializePost(input: PostFields): string {
  const { frontmatter, body } = serializePostParts(input);
  // frontmatter と本文のあいだに、空行を 1 つ置く。
  return `${frontmatter}\n\n${body}`;
}

/** frontmatter 部分（末尾の `---` まで）と、末尾に改行を足した本文に分けて返す。原文は `frontmatter + "\n\n" + body`。 */
export function serializePostParts(input: PostFields): { frontmatter: string; body: string } {
  const lines = ["---", `title: ${yamlString(input.title)}`];
  if (input.description) lines.push(`description: ${yamlString(input.description)}`);
  lines.push(`date: ${input.date}`);
  if (input.tags.length > 0) {
    lines.push(`tags: [${input.tags.map((tag) => yamlString(tag)).join(", ")}]`);
  }
  lines.push("---");
  const body = input.body.endsWith("\n") ? input.body : `${input.body}\n`;
  return { frontmatter: lines.join("\n"), body };
}
