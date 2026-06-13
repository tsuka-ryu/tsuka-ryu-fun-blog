import type { ReactNode } from "react";
import type { MdastNode, MarkdownComponents } from "#markdown/types.js";

// 子ノードの配列を、それぞれレジストリ経由でディスパッチして描画する。
export function renderChildren(
  children: MdastNode[] | undefined,
  components: MarkdownComponents,
): ReactNode {
  if (!children) return null;
  return children.map((child, index) => (
    <MarkdownNode key={index} node={child} components={components} />
  ));
}

// 単一の mdast ノードを、その type に登録されたコンポーネントで描画する。
export function MarkdownNode({
  node,
  components,
}: {
  node: MdastNode;
  components: MarkdownComponents;
}): ReactNode {
  const Component = components[node.type] ?? components.unknown;
  if (!Component) return null;
  return <Component node={node} components={components} />;
}
