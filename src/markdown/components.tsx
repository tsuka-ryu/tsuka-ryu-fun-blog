import { createElement, type CSSProperties } from "react";
import type { MarkdownComponentProps, MarkdownComponents } from "#markdown/types.js";
import { renderChildren } from "#markdown/render.js";
import { highlight } from "#markdown/highlight.js";

// 以下の各コンポーネントは、1 つの mdast ノード型をマークアップに対応づける
// Server Component。<Markdown> の components プロパティで個別に上書きできる。

function Root({ node, components }: MarkdownComponentProps) {
  return <>{renderChildren(node.children, components)}</>;
}

function Heading({ node, components }: MarkdownComponentProps) {
  const depth = Math.min(Math.max(node.depth ?? 1, 1), 6);
  // id は extractToc が付与する。目次リンクと見出しでアンカーを共有させる。
  return createElement(
    `h${depth}`,
    node.id ? { id: node.id } : null,
    renderChildren(node.children, components),
  );
}

function Paragraph({ node, components }: MarkdownComponentProps) {
  return <p>{renderChildren(node.children, components)}</p>;
}

function Text({ node }: MarkdownComponentProps) {
  return node.value ?? null;
}

function Strong({ node, components }: MarkdownComponentProps) {
  return <strong>{renderChildren(node.children, components)}</strong>;
}

function Emphasis({ node, components }: MarkdownComponentProps) {
  return <em>{renderChildren(node.children, components)}</em>;
}

function Delete({ node, components }: MarkdownComponentProps) {
  return <del>{renderChildren(node.children, components)}</del>;
}

function InlineCode({ node }: MarkdownComponentProps) {
  return <code>{node.value}</code>;
}

function Link({ node, components }: MarkdownComponentProps) {
  const external = node.url?.startsWith("http") ?? false;
  return (
    <a
      href={node.url}
      title={node.title ?? undefined}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {renderChildren(node.children, components)}
    </a>
  );
}

function Image({ node }: MarkdownComponentProps) {
  return <img src={node.url} alt={node.alt ?? ""} />;
}

function List({ node, components }: MarkdownComponentProps) {
  return node.ordered ? (
    <ol start={node.start ?? undefined}>
      {renderChildren(node.children, components)}
    </ol>
  ) : (
    <ul>{renderChildren(node.children, components)}</ul>
  );
}

function ListItem({ node, components }: MarkdownComponentProps) {
  const isTask = node.checked === true || node.checked === false;
  if (isTask) {
    return (
      <li className="task-list-item">
        <input type="checkbox" checked={node.checked ?? false} disabled readOnly />{" "}
        {renderChildren(node.children, components)}
      </li>
    );
  }
  return <li>{renderChildren(node.children, components)}</li>;
}

function Blockquote({ node, components }: MarkdownComponentProps) {
  return <blockquote>{renderChildren(node.children, components)}</blockquote>;
}

// コードブロックのレンダラー。node.value を shiki でビルド時にハイライトする
// async Server Component（highlight 参照）。シンタックスカラーは静的 HTML / RSC
// ペイロードに焼き込まれ、ハイライターはクライアントに送られない。トークンは
// React 要素として出力する（dangerouslySetInnerHTML は使わない）。
async function CodeBlock({ node }: MarkdownComponentProps) {
  const code = node.value ?? "";
  const lang = node.lang ?? undefined;
  const { lines, rootStyle } = await highlight(code, lang);

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

function Table({ node, components }: MarkdownComponentProps) {
  const rows = node.children ?? [];
  const [headRow, ...bodyRows] = rows;
  const align = node.align ?? [];
  const styleFor = (i: number): CSSProperties | undefined =>
    align[i] ? { textAlign: align[i]! } : undefined;

  return (
    <table>
      {headRow && (
        <thead>
          <tr>
            {(headRow.children ?? []).map((cell, i) => (
              <th key={i} style={styleFor(i)}>
                {renderChildren(cell.children, components)}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {bodyRows.map((row, r) => (
          <tr key={r}>
            {(row.children ?? []).map((cell, i) => (
              <td key={i} style={styleFor(i)}>
                {renderChildren(cell.children, components)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 専用レンダラーを持たないノード型のフォールバック。 */
function Unknown({ node, components }: MarkdownComponentProps) {
  if (node.children) return <>{renderChildren(node.children, components)}</>;
  if (node.value != null) return <>{node.value}</>;
  return null;
}

// mdast の type → Server Component の既定レジストリ。<Markdown> の
// components プロパティで個別に上書き・拡張できる。
export const defaultComponents: MarkdownComponents = {
  root: Root,
  heading: Heading,
  paragraph: Paragraph,
  text: Text,
  strong: Strong,
  emphasis: Emphasis,
  delete: Delete,
  inlineCode: InlineCode,
  link: Link,
  image: Image,
  list: List,
  listItem: ListItem,
  blockquote: Blockquote,
  code: CodeBlock,
  thematicBreak: ThematicBreak,
  break: Break,
  table: Table,
  unknown: Unknown,
};
