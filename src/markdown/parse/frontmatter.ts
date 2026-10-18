import type { DiagnosticSink } from "#markdown/parse/source.js";

// 記事の先頭の frontmatter（`---` で囲んだ YAML）の読み取り。
// 記事で使っている書き方だけを扱う小さな実装:
//   key: 文字列 / "引用符つき" / '引用符つき' / true / false / null / 数値
//   key: ["a", "b"]（1 行の配列）と、`- a` を並べた配列
// それ以外（入れ子、複数行の文字列など）は、診断のエラーにする。

export interface SplitFrontmatter {
  /** frontmatter の中身。なければ null。 */
  data: Record<string, unknown> | null;
  /** frontmatter を除いた本文。 */
  body: string;
  /** 本文の先頭が、元の文字列の何文字目か。 */
  bodyOffset: number;
}

/** 引用符つき・なしの 1 つの値を読む。 */
function parseScalar(raw: string): string | number | boolean | null {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value
      .slice(1, -1)
      .replace(/\\(["\\nt])/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~" || value === "") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  // 行末のコメント（空白 + #）を落とす。
  return value.replace(/[ \t]+#.*$/, "");
}

/** `[a, "b, c", 'd']` を配列にする。引用符の中のカンマでは区切らない。 */
function parseFlowSequence(raw: string): unknown[] | null {
  const inner = raw.trim().slice(1, -1);
  const items: string[] = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner.charAt(i);
    if (quote) {
      current += c;
      if (c === "\\" && quote === '"') {
        current += inner.charAt(i + 1);
        i++;
      } else if (c === quote) {
        quote = "";
      }
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === ",") {
      items.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  if (quote) return null;
  if (current.trim() !== "") items.push(current);
  return items.map((item) => parseScalar(item));
}

export function splitFrontmatter(raw: string, sink: DiagnosticSink): SplitFrontmatter {
  const bom = raw.startsWith("\uFEFF") ? 1 : 0;
  const open = /^---[ \t]*\r?\n/.exec(raw.slice(bom));
  if (!open) return { data: null, body: raw, bodyOffset: 0 };

  const contentStart = bom + open[0].length;
  const close = /(?:^|\r?\n)(---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(raw.slice(contentStart));
  if (!close) {
    sink.add(
      "error",
      "frontmatter",
      "frontmatter が `---` で閉じられていません",
      0,
      open[0].length,
    );
    return { data: null, body: raw, bodyOffset: 0 };
  }

  const yamlEnd = contentStart + close.index;
  // 本文は、frontmatter の直後の空行を除いたところから始める（現行の ox-content の prepareSource と同じ）。
  const afterClose = contentStart + close.index + close[0].length;
  const bodyOffset =
    afterClose + (/^(?:[ \t]*\r?\n)+/.exec(raw.slice(afterClose))?.[0].length ?? 0);
  const yaml = raw.slice(contentStart, yamlEnd);

  const data: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let offset = contentStart;
  for (let n = 0; n < lines.length; n++) {
    const text = (lines[n] ?? "").replace(/\r$/, "");
    const lineFrom = offset;
    offset += (lines[n]?.length ?? 0) + 1;
    if (text.trim() === "" || text.trim().startsWith("#")) continue;

    const m = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(text);
    if (!m) {
      sink.add(
        "error",
        "frontmatter",
        "frontmatter の書き方が未対応です（`key: value` の形だけ使えます）",
        lineFrom,
        lineFrom + text.length,
      );
      continue;
    }
    const key = m[1] ?? "";
    const rest = m[2] ?? "";
    if (key in data) {
      sink.add(
        "error",
        "frontmatter",
        `frontmatter の \`${key}\` が重複しています`,
        lineFrom,
        lineFrom + text.length,
      );
      continue;
    }
    if (rest.trim() === "") {
      // 次の行から `- item` が続くなら配列。
      const list: unknown[] = [];
      let next = n + 1;
      while (next < lines.length && /^[ \t]*-[ \t]+/.test(lines[next] ?? "")) {
        list.push(
          parseScalar((lines[next] ?? "").replace(/^[ \t]*-[ \t]+/, "").replace(/\r$/, "")),
        );
        offset += (lines[next]?.length ?? 0) + 1;
        next++;
      }
      data[key] = list.length > 0 ? list : null;
      n = next - 1;
    } else if (rest.trim().startsWith("[")) {
      const seq = rest.trim().endsWith("]") ? parseFlowSequence(rest) : null;
      if (!seq) {
        sink.add(
          "error",
          "frontmatter",
          `\`${key}\` の配列を読めません（\`["a", "b"]\` の形で 1 行に書いてください）`,
          lineFrom,
          lineFrom + text.length,
        );
      } else {
        data[key] = seq;
      }
    } else if (/^[|>][+-]?[ \t]*$/.test(rest.trim()) || rest.trim().startsWith("{")) {
      sink.add(
        "error",
        "frontmatter",
        `\`${key}\` の値の書き方は未対応です（複数行の文字列やオブジェクトは使えません）`,
        lineFrom,
        lineFrom + text.length,
      );
    } else {
      data[key] = parseScalar(rest);
    }
  }
  return { data, body: raw.slice(bodyOffset), bodyOffset };
}
