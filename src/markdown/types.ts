// Markdown の AST（mdast）のノードの型定義。現行の ox-content と、自作パーサー（parse/）の
// どちらの出力も、この形になる。レンダラーが使うフィールドだけを、type で判別できる判別可能ユニオンとして列挙する。
// 各ノードは自分の type に必要なフィールドだけを持つので、描画側で
// node.type を switch すれば対応する variant に自動で絞り込まれる（キャスト不要）。
/** ソース上の 1 点。line と column は 1 始まり、offset は先頭からの文字数（0 始まり）。 */
export interface Point {
  line: number;
  column: number;
  offset: number;
}

/** ノードがソースのどこにあたるか。自作パーサーだけが付ける（ox-content の出力にはない）。 */
export interface Position {
  start: Point;
  end: Point;
}

export type MdastNode = MdastVariant & { position?: Position };

type MdastVariant =
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
  | { type: "code"; value: string; lang?: string | null; meta?: string | null }
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
  position?: Position;
}

export interface TableCell {
  type: "tableCell";
  children: MdastNode[];
  position?: Position;
}

// 指定した type の variant を node に持つ Server Component の props 型。
// 例: NodeProps<"heading"> は { node: { type: "heading"; depth: number; ... } }。
export type NodeProps<T extends MdastNode["type"]> = {
  node: Extract<MdastNode, { type: T }>;
};
