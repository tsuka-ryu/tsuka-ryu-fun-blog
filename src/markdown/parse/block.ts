import { parseInline, type InlineContext, type OffsetMap } from "#markdown/parse/inline.js";

import type { MdastNode, TableCell, TableRow } from "#markdown/types.js";

// ブロック（見出し・段落・リスト・引用・コード・表・水平線）の解析。
// 入力は行の配列。引用やリストの中身は、先頭の記号やインデントを取り除いた行にして、再帰的に解析する。
// 取り除いた分は `start`（その行の text[0] がソースのどこにあたるか）に反映するので、
// どの深さのノードでも、ソース上の正しい位置を指せる。

/** 1 行。text は行末の改行を除いたもので、start は text[0] のソース上の offset。 */
export interface Line {
  text: string;
  start: number;
}

export function splitLines(source: string, baseOffset: number): Line[] {
  const lines: Line[] = [];
  let from = 0;
  while (from <= source.length) {
    const nl = source.indexOf("\n", from);
    const end = nl === -1 ? source.length : nl;
    let text = source.slice(from, end);
    if (text.endsWith("\r")) text = text.slice(0, -1);
    lines.push({ text, start: baseOffset + from });
    if (nl === -1) break;
    from = nl + 1;
  }
  return lines;
}

const isBlank = (text: string) => /^[ \t]*$/.test(text);

/** 行頭の空白の桁数。タブは 4 の倍数の桁に揃える。 */
function indentOf(text: string): number {
  let col = 0;
  for (const c of text) {
    if (c === " ") col++;
    else if (c === "\t") col += 4 - (col % 4);
    else break;
  }
  return col;
}

/** 行頭の空白を、指定した桁数まで取り除く。 */
function stripColumns(line: Line, columns: number): Line {
  let col = 0;
  let i = 0;
  while (i < line.text.length && col < columns) {
    const c = line.text.charAt(i);
    if (c === " ") col++;
    else if (c === "\t") col += 4 - (col % 4);
    else break;
    i++;
  }
  return { text: line.text.slice(i), start: line.start + i };
}

const lineEnd = (line: Line) => line.start + line.text.length;

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/;
const ATX = /^( {0,3})(#{1,6})([ \t]+|$)(.*)$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const LIST_MARKER = /^( {0,3})([-+*]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

interface ListMarker {
  ordered: boolean;
  /** 箇条書きの記号、または番号のあとの `.` / `)`。同じリストかどうかの判定に使う。 */
  kind: string;
  number: number;
  /** 項目の中身が始まる桁。2 行目以降の取り除く量に使う。 */
  contentIndent: number;
  /** 最初の行で、中身が始まる text 内の位置（記号とその後の空白の次）。 */
  contentStart: number;
  /** 記号のあとに中身があるか。 */
  hasContent: boolean;
}

function listMarker(text: string): ListMarker | null {
  const m = LIST_MARKER.exec(text);
  if (!m) return null;
  const marker = m[2] ?? "";
  const ordered = /^\d/.test(marker);
  const markerWidth = (m[1]?.length ?? 0) + marker.length;
  const rest = m[4] ?? "";
  const spaces = m[3] ? indentOf(m[3]) : 0;
  const hasContent = rest.trim() !== "";
  // 記号の直後が空行なら、中身の桁は「記号 + 1」。5 桁以上空いていたら、コードなので 1 桁だけ空白とみなす。
  const contentIndent =
    !hasContent || spaces >= 5 ? markerWidth + 1 : markerWidth + Math.max(spaces, 1);
  const spaceChars = m[3]?.length ?? 0;
  const contentStart = !hasContent ? text.length : markerWidth + (spaces >= 5 ? 1 : spaceChars);
  return {
    ordered,
    kind: ordered ? marker.slice(-1) : marker,
    number: ordered ? Number.parseInt(marker, 10) : 0,
    contentIndent,
    contentStart,
    hasContent,
  };
}

/** この行が、段落を途中で打ち切る（または引用の遅延継続を止める）ブロックの開始か。 */
function startsBlock(text: string): boolean {
  if (indentOf(text) >= 4) return false;
  if ((FENCE.test(text) && !/`/.test(FENCE.exec(text)?.[3] ?? "")) || /^ {0,3}~{3,}/.test(text))
    return true;
  if (ATX.test(text) || HR.test(text) || /^ {0,3}>/.test(text)) return true;
  const marker = listMarker(text);
  if (marker?.hasContent && (!marker.ordered || marker.number === 1)) return true;
  return false;
}

export function parseBlocks(lines: Line[], ctx: InlineContext): MdastNode[] {
  const out: MdastNode[] = [];
  const at = (from: number, to: number) => ctx.lines.position(from, to);
  const report = (
    ruleId: string,
    message: string,
    from: number,
    to: number,
    severity: "error" | "warning" = "error",
  ) => ctx.sink.add(severity, ruleId, message, from, to);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) break;
    if (isBlank(line.text)) {
      i++;
      continue;
    }

    // インデントによるコードブロック（4 桁以上）。未対応。
    if (indentOf(line.text) >= 4) {
      const body: string[] = [];
      const first = line;
      let last = line;
      while (i < lines.length) {
        const l = lines[i];
        if (!l || (!isBlank(l.text) && indentOf(l.text) < 4)) break;
        body.push(stripColumns(l, 4).text);
        if (!isBlank(l.text)) last = l;
        i++;
      }
      while (body.length > 0 && isBlank(body[body.length - 1] ?? "")) body.pop();
      report(
        "unsupported-syntax",
        "インデントによるコードブロックは未対応です。``` で囲んでください",
        first.start,
        lineEnd(last),
      );
      out.push({
        type: "code",
        value: `${body.join("\n")}\n`,
        position: at(first.start, lineEnd(last)),
      });
      continue;
    }

    // フェンスコード
    const fence = FENCE.exec(line.text);
    if (fence && !(fence[2]?.startsWith("`") && (fence[3] ?? "").includes("`"))) {
      const fenceChar = fence[2]?.charAt(0) ?? "`";
      const fenceLength = fence[2]?.length ?? 3;
      const fenceIndent = fence[1]?.length ?? 0;
      const info = (fence[3] ?? "").trim();
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      let end = lineEnd(line);
      while (j < lines.length) {
        const l = lines[j];
        if (!l) break;
        const close = new RegExp(
          `^ {0,3}${fenceChar === "`" ? "`" : "~"}{${fenceLength},}[ \\t]*$`,
        ).exec(l.text);
        if (close) {
          closed = true;
          end = lineEnd(l);
          j++;
          break;
        }
        body.push(stripColumns(l, fenceIndent).text);
        end = lineEnd(l);
        j++;
      }
      if (!closed) {
        report("unclosed-fence", "コードブロックが閉じられていません", line.start, end, "warning");
      }
      const node: MdastNode = {
        type: "code",
        value: body.length > 0 ? `${body.join("\n")}\n` : "",
        position: at(line.start, end),
      };
      const space = info.search(/\s/);
      const lang = space === -1 ? info : info.slice(0, space);
      const meta = space === -1 ? "" : info.slice(space).trim();
      if (lang) node.lang = lang;
      if (meta) node.meta = meta;
      out.push(node);
      i = j;
      continue;
    }

    // ATX 見出し
    const atx = ATX.exec(line.text);
    if (atx) {
      const contentFrom = (atx[1]?.length ?? 0) + (atx[2]?.length ?? 0) + (atx[3]?.length ?? 0);
      const raw = (atx[4] ?? "")
        .replace(/[ \t]+#+[ \t]*$/, "")
        .replace(/^#+[ \t]*$/, "")
        .trimEnd();
      const map: OffsetMap = { segments: [{ index: 0, source: line.start + contentFrom }] };
      out.push({
        type: "heading",
        depth: atx[2]?.length ?? 1,
        children: parseInline(raw, map, ctx),
        position: at(line.start, lineEnd(line)),
      });
      i++;
      continue;
    }

    // 水平線
    if (HR.test(line.text)) {
      out.push({ type: "thematicBreak", position: at(line.start, lineEnd(line)) });
      i++;
      continue;
    }

    // 引用
    if (/^ {0,3}>/.test(line.text)) {
      const inner: Line[] = [];
      let last = line;
      let prevParagraph = false;
      while (i < lines.length) {
        const l = lines[i];
        if (!l) break;
        const m = /^( {0,3}>)( ?)/.exec(l.text);
        if (m) {
          const strip = m[0].length;
          inner.push({ text: l.text.slice(strip), start: l.start + strip });
          prevParagraph = !isBlank(l.text.slice(strip));
          last = l;
          i++;
        } else if (prevParagraph && !isBlank(l.text) && !startsBlock(l.text)) {
          // `>` のない行でも、段落の続きなら引用に含める（遅延継続）。
          inner.push(l);
          last = l;
          i++;
        } else {
          break;
        }
      }
      out.push({
        type: "blockquote",
        children: parseBlocks(inner, ctx),
        position: at(line.start, lineEnd(last)),
      });
      continue;
    }

    // リスト
    const first = listMarker(line.text);
    if (first) {
      const items: MdastNode[] = [];
      let listEnd = lineEnd(line);
      let cursor = i;
      for (;;) {
        const head = lines[cursor];
        const marker = head ? listMarker(head.text) : null;
        if (!head || !marker || marker.ordered !== first.ordered || marker.kind !== first.kind)
          break;
        const itemLines: Line[] = [
          { text: head.text.slice(marker.contentStart), start: head.start + marker.contentStart },
        ];
        let itemEnd = lineEnd(head);
        let j = cursor + 1;
        let prevText = marker.hasContent;
        while (j < lines.length) {
          const l = lines[j];
          if (!l) break;
          if (isBlank(l.text)) {
            // 空行は、そのあとの行が項目の中身ならこの項目に含める。
            let k = j;
            while (k < lines.length && isBlank(lines[k]?.text ?? "")) k++;
            const next = lines[k];
            if (!next || indentOf(next.text) < marker.contentIndent) break;
            for (let b = j; b < k; b++) itemLines.push({ text: "", start: lines[b]?.start ?? 0 });
            j = k;
            prevText = false;
            continue;
          }
          if (indentOf(l.text) >= marker.contentIndent) {
            itemLines.push(stripColumns(l, marker.contentIndent));
            itemEnd = lineEnd(l);
            prevText = true;
            j++;
            continue;
          }
          // インデントが足りなくても、段落の続きならこの項目に含める（遅延継続）。
          if (prevText && !startsBlock(l.text) && !listMarker(l.text)) {
            itemLines.push(l);
            itemEnd = lineEnd(l);
            j++;
            continue;
          }
          break;
        }
        const children = parseBlocks(itemLines, ctx);
        const firstText = itemLines[0];
        if (firstText && /^\[[ xX]\](?:[ \t]|$)/.test(firstText.text)) {
          report(
            "unsupported-syntax",
            "タスクリストは未対応です",
            firstText.start,
            firstText.start + 3,
          );
        }
        items.push({ type: "listItem", children, position: at(head.start, itemEnd) });
        listEnd = itemEnd;
        cursor = j;
        // 空行を挟んで、同じ種類の記号が続くなら次の項目。
        let k = cursor;
        while (k < lines.length && isBlank(lines[k]?.text ?? "")) k++;
        const nextMarker = lines[k] ? listMarker(lines[k]?.text ?? "") : null;
        if (
          nextMarker &&
          nextMarker.ordered === first.ordered &&
          nextMarker.kind === first.kind &&
          !HR.test(lines[k]?.text ?? "")
        ) {
          cursor = k;
        } else {
          break;
        }
      }
      const list: MdastNode = {
        type: "list",
        ordered: first.ordered,
        children: items,
        position: at(line.start, listEnd),
      };
      if (first.ordered) list.start = first.number;
      out.push(list);
      i = cursor;
      continue;
    }

    // 表（ヘッダー行の次が区切り行で、列数が同じ）
    const table = line.text.includes("|") ? tryTable(lines, i, ctx) : null;
    if (table) {
      out.push(table.node);
      i = table.next;
      continue;
    }

    // 段落（と、下線つきの見出し）
    const para: Line[] = [line];
    let j = i + 1;
    let setext: { depth: number; end: number } | null = null;
    while (j < lines.length) {
      const l = lines[j];
      if (!l || isBlank(l.text)) break;
      const underline = SETEXT.exec(l.text);
      if (underline) {
        setext = { depth: underline[1]?.startsWith("=") ? 1 : 2, end: lineEnd(l) };
        j++;
        break;
      }
      if (startsBlock(l.text)) break;
      para.push(l);
      j++;
    }
    const firstLine = para[0] ?? line;
    const lastLine = para[para.length - 1] ?? line;
    if (/^ {0,3}\[[^\]]+\]:[ \t]*\S/.test(firstLine.text)) {
      report(
        "unsupported-syntax",
        "参照リンクの定義は未対応です",
        firstLine.start,
        lineEnd(firstLine),
      );
    }
    // 行頭の空白を除いて連結し、位置の対応表を作る。
    let content = "";
    const segments: OffsetMap["segments"] = [];
    for (const [n, l] of para.entries()) {
      const lead = l.text.length - l.text.trimStart().length;
      segments.push({ index: content.length, source: l.start + lead });
      content += l.text.slice(lead);
      if (n < para.length - 1) content += "\n";
    }
    content = content.replace(/[ \t]+$/, "");
    const children = parseInline(content, { segments }, ctx);
    if (setext) {
      report(
        "unsupported-syntax",
        "下線で書く見出し（Setext）は未対応です。# を使ってください",
        firstLine.start,
        setext.end,
      );
      out.push({
        type: "heading",
        depth: setext.depth,
        children,
        position: at(firstLine.start, setext.end),
      });
    } else {
      out.push({ type: "paragraph", children, position: at(firstLine.start, lineEnd(lastLine)) });
    }
    i = j;
  }
  return out;
}

interface Cell {
  text: string;
  /** 行の text の中での、セルの中身（前後の空白を除いたもの）の開始位置。 */
  from: number;
}

/** 表の 1 行をセルに分ける。エスケープされていない `|` で区切り、コードスパンの中は区切らない。 */
function splitRow(text: string): Cell[] {
  const cells: Cell[] = [];
  let current = "";
  let currentFrom = 0;
  let i = 0;
  let inCode = 0;
  const trimmed = text.replace(/^[ \t]*/, "");
  i = text.length - trimmed.length;
  if (text.charAt(i) === "|") i++;
  currentFrom = i;
  const push = (end: number) => {
    const lead = current.length - current.trimStart().length;
    cells.push({ text: current.trim(), from: currentFrom + lead });
    current = "";
    currentFrom = end + 1;
  };
  for (; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "\\" && i + 1 < text.length) {
      current += text.slice(i, i + 2);
      i++;
      continue;
    }
    if (c === "`") {
      let run = 1;
      while (text.charAt(i + run) === "`") run++;
      inCode = inCode === run ? 0 : inCode === 0 ? run : inCode;
      current += "`".repeat(run);
      i += run - 1;
      continue;
    }
    if (c === "|" && inCode === 0) {
      push(i);
      continue;
    }
    current += c;
  }
  // 最後の `|` のあとが空白だけなら、空のセルは作らない。
  if (current.trim() !== "") push(text.length);
  return cells;
}

function tryTable(
  lines: Line[],
  at: number,
  ctx: InlineContext,
): { node: MdastNode; next: number } | null {
  const header = lines[at];
  const delimiter = lines[at + 1];
  if (
    !header ||
    !delimiter ||
    !TABLE_DELIMITER.test(delimiter.text) ||
    !delimiter.text.includes("-")
  )
    return null;
  const headerCells = splitRow(header.text);
  const delimiterCells = splitRow(delimiter.text);
  if (headerCells.length !== delimiterCells.length || headerCells.length === 0) return null;
  const align = delimiterCells.map((c): "left" | "right" | "center" | null => {
    const left = c.text.startsWith(":");
    const right = c.text.endsWith(":");
    return left && right ? "center" : left ? "left" : right ? "right" : null;
  });
  const toRow = (line: Line, cells: Cell[]): TableRow => ({
    type: "tableRow",
    children: headerCells.map((_, n): TableCell => {
      const cell = cells[n];
      const text = cell?.text ?? "";
      const map: OffsetMap = {
        segments: [{ index: 0, source: line.start + (cell?.from ?? line.text.length) }],
      };
      return {
        type: "tableCell",
        children: parseInline(text, map, ctx),
        position: ctx.lines.position(
          line.start + (cell?.from ?? 0),
          line.start + (cell?.from ?? 0) + text.length,
        ),
      };
    }),
    position: ctx.lines.position(line.start, line.start + line.text.length),
  });
  const rows: TableRow[] = [toRow(header, headerCells)];
  let j = at + 2;
  let end = delimiter.start + delimiter.text.length;
  while (j < lines.length) {
    const l = lines[j];
    if (!l || isBlank(l.text) || startsBlock(l.text)) break;
    rows.push(toRow(l, splitRow(l.text)));
    end = l.start + l.text.length;
    j++;
  }
  return {
    node: {
      type: "table",
      align,
      children: rows as never,
      position: ctx.lines.position(header.start, end),
    },
    next: j,
  };
}
