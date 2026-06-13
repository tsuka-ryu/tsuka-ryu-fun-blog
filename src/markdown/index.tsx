import type { ReactNode } from "react";
import type { MdastNode } from "#markdown/types.js";
import { MarkdownNode } from "#markdown/components.js";

// ox-content の mdast ツリーを React 要素に描画する入口。
// ノードごとの描画は MarkdownNode が type で分岐して行う（components.tsx）。
export function Markdown({ root }: { root: MdastNode }): ReactNode {
  return <MarkdownNode node={root} />;
}

export { renderChildren, MarkdownNode } from "#markdown/components.js";
export type { MdastNode, NodeProps } from "#markdown/types.js";
