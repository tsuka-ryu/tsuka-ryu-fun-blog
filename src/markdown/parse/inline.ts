import type { DiagnosticSink, LineIndex } from "#markdown/parse/source.js";
import type { MdastNode } from "#markdown/types.js";

// インライン（段落・見出し・表のセルの中身）の解析。
// 対応: エスケープ、インラインコード、リンク、画像、強調（* と _）、<url> の自動リンク、
// 改行（ソフト／ハード）。取り消し線・脚注・生の HTML は未対応で、診断のエラーにする。

/** 解析する文字列の index を、ソース全体の offset に戻す表。 */
export interface OffsetMap {
  /** text 内の index と、そこに対応するソースの offset の組。index の昇順。 */
  segments: Array<{ index: number; source: number }>;
}

export function mapOffset(map: OffsetMap, index: number): number {
  let found = map.segments[0];
  for (const seg of map.segments) {
    if (seg.index <= index) found = seg;
    else break;
  }
  return (found?.source ?? 0) + (index - (found?.index ?? 0));
}

export interface InlineContext {
  lines: LineIndex;
  sink: DiagnosticSink;
}

// 強調の開閉の判定に使う文字の種類。
const WHITESPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/** 強調の記号（* や _）の連なり。同じ記号が連続したひとかたまり。 */
interface Delimiter {
  char: "*" | "_";
  count: number;
  originalCount: number;
  canOpen: boolean;
  canClose: boolean;
  /** text 内の範囲。強調に使った分だけ、開く側は右から、閉じる側は左から縮む。 */
  start: number;
  end: number;
}

/** 解析途中の要素。普通のノードか、まだ強調に使うかもしれない記号の連なり。 */
interface Item {
  node: MdastNode;
  delimiter?: Delimiter;
  /** `[` や `![` の開き。`]` が来たとき、リンクか画像として閉じる候補になる。 */
  bracket?: { image: boolean; active: boolean; start: number };
}

/** index の直前の 1 文字（サロゲートペアは 2 つ分で 1 文字）。先頭なら空白とみなす。 */
function charBefore(text: string, index: number): string {
  if (index <= 0) return " ";
  const low = text.charCodeAt(index - 1);
  if (index >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text.charAt(index - 1);
}

function charAfter(text: string, index: number): string {
  if (index >= text.length) return " ";
  return String.fromCodePoint(text.codePointAt(index) ?? 32);
}

function textNode(value: string, position?: MdastNode["position"]): MdastNode {
  return position ? { type: "text", value, position } : { type: "text", value };
}

/** 隣り合う text ノードを 1 つにする。エスケープなどで分かれたものを元に戻す。 */
function mergeText(nodes: MdastNode[]): MdastNode[] {
  const out: MdastNode[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.type === "text" && last?.type === "text") {
      last.value += node.value;
      if (last.position && node.position)
        last.position = { start: last.position.start, end: node.position.end };
    } else {
      out.push(node);
    }
  }
  return out;
}

interface LinkTail {
  url: string;
  title: string | null;
  /** `)` の次の index。 */
  end: number;
}

function unescape(raw: string): string {
  return raw.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

/** `(url "title")` を解析する。text[open] は `(` であること。合わなければ null。 */
function parseLinkTail(text: string, open: number): LinkTail | null {
  let i = open + 1;
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text.charAt(i))) i++;
  };
  skipSpace();

  let url = "";
  if (text.charAt(i) === "<") {
    const close = text.indexOf(">", i + 1);
    const newline = text.indexOf("\n", i + 1);
    if (close === -1 || (newline !== -1 && newline < close)) return null;
    url = text.slice(i + 1, close);
    i = close + 1;
  } else {
    const start = i;
    let depth = 0;
    while (i < text.length) {
      const c = text.charAt(i);
      if (c === "\\" && i + 1 < text.length) {
        i += 2;
        continue;
      }
      if (/\s/.test(c)) break;
      if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    url = text.slice(start, i);
  }

  skipSpace();
  let title: string | null = null;
  const quote = text.charAt(i);
  if (quote === '"' || quote === "'" || quote === "(") {
    const closeChar = quote === "(" ? ")" : quote;
    let j = i + 1;
    let raw = "";
    let closed = false;
    while (j < text.length) {
      const c = text.charAt(j);
      if (c === "\\" && j + 1 < text.length) {
        raw += text.slice(j, j + 2);
        j += 2;
        continue;
      }
      if (c === closeChar) {
        closed = true;
        break;
      }
      raw += c;
      j++;
    }
    if (!closed) return null;
    title = unescape(raw);
    i = j + 1;
    skipSpace();
  }
  if (text.charAt(i) !== ")") return null;
  return { url: unescape(url), title, end: i + 1 };
}

/** 文字列を解析して、インラインのノード列にする。 */
export function parseInline(text: string, map: OffsetMap, ctx: InlineContext): MdastNode[] {
  const items: Item[] = [];
  let buffer = "";
  let bufferStart = 0;

  const position = (from: number, to: number) =>
    ctx.lines.position(mapOffset(map, from), mapOffset(map, to));
  const report = (ruleId: string, message: string, from: number, to: number) =>
    ctx.sink.add("error", ruleId, message, mapOffset(map, from), mapOffset(map, to));

  const flush = (end: number) => {
    if (buffer) {
      items.push({ node: textNode(buffer, position(bufferStart, end)) });
      buffer = "";
    }
  };
  const addText = (value: string, index: number) => {
    if (!buffer) bufferStart = index;
    buffer += value;
  };

  /** items[from..] の記号を強調にまとめる。 */
  const processEmphasis = (from: number) => {
    let ci = from;
    while (ci < items.length) {
      const closer = items[ci]?.delimiter;
      if (!closer || !closer.canClose || closer.count === 0) {
        ci++;
        continue;
      }
      let oi = ci - 1;
      let found = -1;
      for (; oi >= from; oi--) {
        const opener = items[oi]?.delimiter;
        if (!opener || opener.char !== closer.char || !opener.canOpen || opener.count === 0)
          continue;
        // 3 の倍数の規則: 開きと閉じの片方が両方向に使えるとき、元の長さの和が 3 の倍数なら組にしない。
        const bothWays = opener.canClose || closer.canOpen;
        const sum = opener.originalCount + closer.originalCount;
        if (
          bothWays &&
          sum % 3 === 0 &&
          !(opener.originalCount % 3 === 0 && closer.originalCount % 3 === 0)
        ) {
          continue;
        }
        found = oi;
        break;
      }
      if (found < 0) {
        ci++;
        continue;
      }
      const opener = items[found]?.delimiter;
      if (!opener) {
        ci++;
        continue;
      }
      const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
      const emphStart = opener.end - use;
      const emphEnd = closer.start + use;
      const inner = items.slice(found + 1, ci).map((it) => it.node);
      const node: MdastNode = {
        type: use === 2 ? "strong" : "emphasis",
        children: mergeText(inner),
        position: position(emphStart, emphEnd),
      };
      opener.count -= use;
      opener.end -= use;
      closer.count -= use;
      closer.start += use;
      const openerItem = items[found];
      const closerItem = items[ci];
      if (openerItem)
        openerItem.node = textNode(
          opener.char.repeat(opener.count),
          position(opener.start, opener.end),
        );
      items.splice(found + 1, ci - found - 1, { node });
      ci = found + 2;
      if (opener.count === 0) {
        items.splice(found, 1);
        ci--;
      }
      if (closer.count === 0) {
        items.splice(ci, 1);
      } else if (closerItem) {
        closerItem.node = textNode(
          closer.char.repeat(closer.count),
          position(closer.start, closer.end),
        );
      }
    }
  };

  const closeBracket = (index: number): boolean => {
    // 直近の開きを探す。
    let bi = -1;
    for (let k = items.length - 1; k >= 0; k--) {
      if (items[k]?.bracket) {
        bi = k;
        break;
      }
    }
    if (bi < 0) return false;
    const openerItem = items[bi];
    const bracket = openerItem?.bracket;
    if (!openerItem || !bracket) return false;
    if (!bracket.active) {
      // リンクの中のリンクは作らない。開きを普通の文字として残す。
      delete openerItem.bracket;
      return false;
    }
    const tail = text.charAt(index + 1) === "(" ? parseLinkTail(text, index + 1) : null;
    if (!tail) {
      delete openerItem.bracket;
      return false;
    }
    processEmphasis(bi + 1);
    const children = mergeText(items.slice(bi + 1).map((it) => it.node));
    const at = position(bracket.start, tail.end);
    let node: MdastNode;
    if (bracket.image) {
      const alt = children.map(plainText).join("");
      node = { type: "image", url: tail.url, alt, position: at };
      if (tail.title !== null) node.title = tail.title;
    } else {
      node = { type: "link", url: tail.url, children, position: at };
      if (tail.title !== null) node.title = tail.title;
    }
    items.splice(bi, items.length - bi, { node });
    if (!bracket.image) {
      // 外側のリンクの開きは、これ以降は閉じられないようにする。
      for (const it of items) if (it.bracket && !it.bracket.image) it.bracket.active = false;
    }
    pendingEnd = tail.end;
    return true;
  };
  let pendingEnd = -1;

  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);

    if (c === "\\") {
      const next = text.charAt(i + 1);
      if (next === "\n") {
        flush(i);
        items.push({ node: { type: "break", position: position(i, i + 2) } });
        i += 2;
        continue;
      }
      if (next && ASCII_PUNCTUATION.test(next)) {
        addText(next, i);
        i += 2;
        continue;
      }
      addText("\\", i);
      i++;
      continue;
    }

    if (c === "`") {
      let run = 1;
      while (text.charAt(i + run) === "`") run++;
      // 同じ長さのバッククォートの並びが閉じになる。
      let close = -1;
      for (let j = i + run; j < text.length; j++) {
        if (text.charAt(j) !== "`") continue;
        let len = 1;
        while (text.charAt(j + len) === "`") len++;
        if (len === run) {
          close = j;
          break;
        }
        j += len - 1;
      }
      if (close === -1) {
        addText("`".repeat(run), i);
        i += run;
        continue;
      }
      flush(i);
      let content = text.slice(i + run, close).replace(/\n/g, " ");
      if (content.startsWith(" ") && content.endsWith(" ") && content.trim() !== "") {
        content = content.slice(1, -1);
      }
      items.push({
        node: { type: "inlineCode", value: content, position: position(i, close + run) },
      });
      i = close + run;
      continue;
    }

    if (c === "<") {
      const auto = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/.exec(text.slice(i));
      if (auto) {
        flush(i);
        const url = auto[1] ?? "";
        items.push({
          node: {
            type: "link",
            url,
            children: [textNode(url)],
            position: position(i, i + auto[0].length),
          },
        });
        i += auto[0].length;
        continue;
      }
      const html = /^<(?:\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|!--)/.exec(text.slice(i));
      if (html) {
        report(
          "unsupported-syntax",
          "生の HTML は未対応です。コードに入れるか、書き方を変えてください",
          i,
          i + html[0].length,
        );
      }
      addText("<", i);
      i++;
      continue;
    }

    if (c === "~" && text.charAt(i + 1) === "~") {
      report("unsupported-syntax", "取り消し線（~~）は未対応です", i, i + 2);
      addText("~~", i);
      i += 2;
      continue;
    }

    if (c === "!" && text.charAt(i + 1) === "[") {
      flush(i);
      items.push({
        node: textNode("![", position(i, i + 2)),
        bracket: { image: true, active: true, start: i },
      });
      i += 2;
      continue;
    }

    if (c === "[") {
      if (text.charAt(i + 1) === "^") {
        const close = text.indexOf("]", i + 2);
        if (close !== -1 && !/\s/.test(text.slice(i + 2, close))) {
          report("unsupported-syntax", "脚注は未対応です", i, close + 1);
        }
      }
      flush(i);
      items.push({
        node: textNode("[", position(i, i + 1)),
        bracket: { image: false, active: true, start: i },
      });
      i++;
      continue;
    }

    if (c === "]") {
      flush(i);
      if (closeBracket(i)) {
        i = pendingEnd;
        continue;
      }
      addText("]", i);
      i++;
      continue;
    }

    if (c === "*" || c === "_") {
      let run = 1;
      while (text.charAt(i + run) === c) run++;
      const before = charBefore(text, i);
      const after = charAfter(text, i + run);
      const beforeSpace = WHITESPACE.test(before);
      const afterSpace = WHITESPACE.test(after);
      const beforePunct = PUNCTUATION.test(before);
      const afterPunct = PUNCTUATION.test(after);
      const leftFlanking = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
      const rightFlanking = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
      const canOpen = c === "*" ? leftFlanking : leftFlanking && (!rightFlanking || beforePunct);
      const canClose = c === "*" ? rightFlanking : rightFlanking && (!leftFlanking || afterPunct);
      flush(i);
      items.push({
        node: textNode(c.repeat(run), position(i, i + run)),
        delimiter: {
          char: c,
          count: run,
          originalCount: run,
          canOpen,
          canClose,
          start: i,
          end: i + run,
        },
      });
      i += run;
      continue;
    }

    if (c === "\n") {
      // 行末の空白は取り除く。2 つ以上ならハードブレーク。
      const trailing = /[ \t]*$/.exec(buffer)?.[0].length ?? 0;
      const hard = trailing >= 2;
      if (trailing > 0) buffer = buffer.slice(0, buffer.length - trailing);
      if (hard) {
        flush(i);
        items.push({ node: { type: "break", position: position(i, i + 1) } });
      } else {
        addText("\n", i);
      }
      i++;
      while (text.charAt(i) === " " || text.charAt(i) === "\t") i++;
      continue;
    }

    addText(c, i);
    i++;
  }
  flush(text.length);

  processEmphasis(0);
  return mergeText(items.map((it) => it.node));
}

/** ノードの見た目のテキスト（画像の alt に使う）。 */
function plainText(node: MdastNode): string {
  if ("value" in node) return node.value;
  if ("children" in node) return node.children.map(plainText).join("");
  return "";
}
