// Markdown の AST（mdast）のノードの型定義。自作パーサー（parse/）の出力の形。
// レンダラーが使うフィールドだけを、type で判別できる判別可能ユニオンとして列挙する。
// 各ノードは自分の type に必要なフィールドだけを持つので、描画側で
// node.type を switch すれば対応する variant に自動で絞り込まれる（キャスト不要）。
/** ソース上の 1 点。line と column は 1 始まり、offset は先頭からの文字数（0 始まり）。 */
export interface Point {
  line: number;
  column: number;
  offset: number;
}

/** ノードがソースのどこにあたるか。自作パーサーが付ける。 */
export interface Position {
  start: Point;
  end: Point;
}

/** シンタックスハイライト済みのコード。トークンごとの色は、ライト・ダークそれぞれの CSS 変数で持つ。 */
export interface HighlightedCode {
  lines: Array<Array<{ content: string; htmlStyle?: Record<string, string> }>>;
  /** ルートの `<pre>` に付けるスタイル（背景色の CSS 変数）。 */
  rootStyle?: Record<string, string>;
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
  | {
      type: "code";
      value: string;
      lang?: string | null;
      meta?: string | null;
      /** ハイライト済みの内容。公開時に埋める。なければ、色なしの素のコードとして描画する。 */
      highlight?: HighlightedCode;
    }
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
