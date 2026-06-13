import type { ComponentType } from "react";

// ox-content の parse() が生成する mdast ノードのゆるい型定義。
// レンダラーが使うフィールドだけを列挙し、全ノード型の合併を
// 「省略可能フィールドを持つ 1 つの形」に潰してレジストリを単純化する。
export interface MdastNode {
  type: string;
  children?: MdastNode[];
  value?: string;
  depth?: number;
  /** 見出しに extractToc が付与するアンカー id（src/lib/toc.ts 参照）。 */
  id?: string;
  ordered?: boolean;
  start?: number | null;
  spread?: boolean;
  checked?: boolean | null;
  url?: string;
  title?: string | null;
  alt?: string;
  lang?: string | null;
  align?: Array<"left" | "right" | "center" | null>;
}

export interface MarkdownComponentProps {
  node: MdastNode;
  components: MarkdownComponents;
}

// mdast ノードの type 文字列を、それを描画するコンポーネントに対応づけるレジストリ。
// 認識できないノード型のフォールバックとして "unknown" エントリを使う。
export type MarkdownComponents = Record<
  string,
  ComponentType<MarkdownComponentProps>
>;
