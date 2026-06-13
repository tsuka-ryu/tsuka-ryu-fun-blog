// ox-content の parse() が生成する mdast ノードの型定義。
// レンダラーが使うフィールドだけを、type で判別できる判別可能ユニオンとして列挙する。
// 各ノードは自分の type に必要なフィールドだけを持つので、描画側で
// node.type を switch すれば対応する variant に自動で絞り込まれる（キャスト不要）。
export type MdastNode =
  | { type: "root"; children: MdastNode[] }
  // id は extractToc が付与するアンカー id（src/lib/toc.ts 参照）。
  | { type: "heading"; depth: number; id?: string; children: MdastNode[] }
  | { type: "paragraph"; children: MdastNode[] }
  | { type: "text"; value: string }
  | { type: "strong"; children: MdastNode[] }
  | { type: "emphasis"; children: MdastNode[] }
  | { type: "delete"; children: MdastNode[] }
  | { type: "inlineCode"; value: string }
  | { type: "link"; url: string; title?: string | null; children: MdastNode[] }
  | { type: "image"; url: string; alt?: string | null; title?: string | null }
  | { type: "list"; ordered?: boolean; start?: number | null; children: MdastNode[] }
  | { type: "listItem"; checked?: boolean | null; children: MdastNode[] }
  | { type: "blockquote"; children: MdastNode[] }
  | { type: "code"; value: string; lang?: string | null }
  | { type: "thematicBreak" }
  | { type: "break" }
  | {
      type: "table";
      align?: Array<"left" | "right" | "center" | null>;
      children: TableRow[];
    }
  | TableRow
  | TableCell;

export interface TableRow {
  type: "tableRow";
  children: TableCell[];
}

export interface TableCell {
  type: "tableCell";
  children: MdastNode[];
}

// 指定した type の variant を node に持つ Server Component の props 型。
// 例: NodeProps<"heading"> は { node: { type: "heading"; depth: number; ... } }。
export type NodeProps<T extends MdastNode["type"]> = {
  node: Extract<MdastNode, { type: T }>;
};
