import type { ReactNode } from "react";
import type { MdastNode, MarkdownComponents } from "#markdown/types.js";
import { MarkdownNode } from "#markdown/render.js";
import { defaultComponents } from "#markdown/components.js";

// ox-content の mdast ツリーを React 要素に描画する入口。
// components を渡すと既定のノードレンダラーを上書き・拡張できる
// （渡したエントリは defaultComponents の上にマージされる）。
export function Markdown({
  root,
  components,
}: {
  root: MdastNode;
  components?: MarkdownComponents;
}): ReactNode {
  const merged = components
    ? { ...defaultComponents, ...components }
    : defaultComponents;
  return <MarkdownNode node={root} components={merged} />;
}

export { defaultComponents } from "#markdown/components.js";
export { renderChildren, MarkdownNode } from "#markdown/render.js";
export type {
  MdastNode,
  MarkdownComponents,
  MarkdownComponentProps,
} from "#markdown/types.js";
