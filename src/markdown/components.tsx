import { highlight } from "#markdown/highlight.js";
import { createElement, type CSSProperties, type ReactNode } from "react";

import type { MdastNode, NodeProps } from "#markdown/types.js";

// 子ノードの配列を、それぞれ MarkdownNode 経由でディスパッチして描画する。
export function renderChildren(children: MdastNode[] | undefined): ReactNode {
  if (!children) return null;
  return children.map((child, index) => <MarkdownNode key={index} node={child} />);
}

// 単一の mdast ノードを type で分岐して描画する。switch の各 case 内では
// node が対応する variant に自動で絞り込まれるため、キャストは不要。
export function MarkdownNode({ node }: { node: MdastNode }): ReactNode {
  switch (node.type) {
    case "root":
      return <Root node={node} />;
    case "heading":
      return <Heading node={node} />;
    case "paragraph":
      return <Paragraph node={node} />;
    case "text":
      return <Text node={node} />;
    case "strong":
      return <Strong node={node} />;
    case "emphasis":
      return <Emphasis node={node} />;
    case "delete":
      return <Delete node={node} />;
    case "inlineCode":
      return <InlineCode node={node} />;
    case "link":
      return <Link node={node} />;
    case "image":
      return <Image node={node} />;
    case "list":
      return <List node={node} />;
    case "listItem":
      return <ListItem node={node} />;
    case "blockquote":
      return <Blockquote node={node} />;
    case "code":
      return <CodeBlock node={node} />;
    case "thematicBreak":
      return <ThematicBreak />;
    case "break":
      return <Break />;
    case "table":
      return <Table node={node} />;
    case "tableRow":
    case "tableCell":
      // 行・セルは Table が直接組み立てるため、単独では子をそのまま描画する。
      return <>{renderChildren(node.children)}</>;
    default:
      return <Unknown node={node} />;
  }
}

// 以下の各コンポーネントは、1 つの mdast ノード型をマークアップに対応づける
// Server Component。受け取る node は NodeProps で対応 variant に固定される。

function Root({ node }: NodeProps<"root">) {
  return <>{renderChildren(node.children)}</>;
}

function Heading({ node }: NodeProps<"heading">) {
  const depth = Math.min(Math.max(node.depth, 1), 6);
  // id は extractToc が付与する。目次リンクと見出しでアンカーを共有させる。
  return createElement(
    `h${depth}`,
    node.id ? { id: node.id } : null,
    renderChildren(node.children),
  );
}

function Paragraph({ node }: NodeProps<"paragraph">) {
  return <p>{renderChildren(node.children)}</p>;
}

function Text({ node }: NodeProps<"text">) {
  return node.value;
}

function Strong({ node }: NodeProps<"strong">) {
  return <strong>{renderChildren(node.children)}</strong>;
}

function Emphasis({ node }: NodeProps<"emphasis">) {
  return <em>{renderChildren(node.children)}</em>;
}

function Delete({ node }: NodeProps<"delete">) {
  return <del>{renderChildren(node.children)}</del>;
}

function InlineCode({ node }: NodeProps<"inlineCode">) {
  return <code>{node.value}</code>;
}

// http(s):// または // 始まり（プロトコル相対）を外部リンクとみなす。
const EXTERNAL_URL = /^(https?:)?\/\//;

function Link({ node }: NodeProps<"link">) {
  const external = EXTERNAL_URL.test(node.url);
  return (
    <a
      href={node.url}
      title={node.title ?? undefined}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {renderChildren(node.children)}
    </a>
  );
}

// TODO: width/height 必須化。CLS 対策で width/height を出したいが、mdast に寸法情報が
// 無い。型で必須化するとリモート画像（http）が寸法解決できずビルド失敗になり「リモート画像も
// 許可」方針と衝突するため保留中。リモート寸法の取得戦略（ビルド時 fetch か Markdown 明示記法）
// が決まり次第、content.ts の走査で image ノードに width/height を注入 →型必須化を一括で入れる。
function Image({ node }: NodeProps<"image">) {
  return <img src={node.url} alt={node.alt ?? ""} loading="lazy" decoding="async" />;
}

function List({ node }: NodeProps<"list">) {
  return node.ordered ? (
    <ol start={node.start ?? undefined}>{renderChildren(node.children)}</ol>
  ) : (
    <ul>{renderChildren(node.children)}</ul>
  );
}

function ListItem({ node }: NodeProps<"listItem">) {
  const isTask = typeof node.checked === "boolean";
  if (isTask) {
    return (
      <li className="task-list-item">
        <input
          type="checkbox"
          checked={node.checked ?? false}
          disabled
          readOnly
          aria-label={node.checked ? "完了" : "未完了"}
        />{" "}
        {renderChildren(node.children)}
      </li>
    );
  }
  return <li>{renderChildren(node.children)}</li>;
}

function Blockquote({ node }: NodeProps<"blockquote">) {
  return <blockquote>{renderChildren(node.children)}</blockquote>;
}

// コードブロックのレンダラー。node.value を shiki でビルド時にハイライトする
// async Server Component（highlight 参照）。シンタックスカラーは静的 HTML / RSC
// ペイロードに焼き込まれ、ハイライターはクライアントに送られない。トークンは
// React 要素として出力する（dangerouslySetInnerHTML は使わない）。
async function CodeBlock({ node }: NodeProps<"code">) {
  const lang = node.lang ?? undefined;
  const { lines, rootStyle } = await highlight(node.value, lang);

  return (
    <pre className="shiki" style={rootStyle} data-lang={lang}>
      <code>
        {lines.map((line, i) => (
          <span key={i} className="line">
            {line.map((token, j) => (
              <span key={j} style={token.htmlStyle as CSSProperties}>
                {token.content}
              </span>
            ))}
            {i < lines.length - 1 ? "\n" : null}
          </span>
        ))}
      </code>
    </pre>
  );
}

function ThematicBreak() {
  return <hr />;
}

function Break() {
  return <br />;
}

function Table({ node }: NodeProps<"table">) {
  const [headRow, ...bodyRows] = node.children;
  const align = node.align ?? [];
  const styleFor = (i: number): CSSProperties | undefined =>
    align[i] ? { textAlign: align[i]! } : undefined;

  return (
    <table>
      {headRow && (
        <thead>
          <tr>
            {headRow.children.map((cell, i) => (
              <th key={i} style={styleFor(i)}>
                {renderChildren(cell.children)}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {bodyRows.map((row, r) => (
          <tr key={r}>
            {row.children.map((cell, i) => (
              <td key={i} style={styleFor(i)}>
                {renderChildren(cell.children)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 専用レンダラーを持たない（= 判別可能ユニオンに無い）ノード型のフォールバック。
// 型上は到達しない（node: never）が、ox-content が想定外の type を吐いても
// ビルドが壊れないよう実行時の保険として子・値を素描きする。ここだけは
// 「型で表せない実行時データ」の境界として 1 つだけキャストを許容する
// （消したかったディスパッチの相関キャストとは別物の、正直なキャスト）。
function Unknown({ node }: { node: never }): ReactNode {
  const loose = node as { children?: MdastNode[]; value?: string };
  if (loose.children) return <>{renderChildren(loose.children)}</>;
  if (loose.value != null) return <>{loose.value}</>;
  return null;
}
