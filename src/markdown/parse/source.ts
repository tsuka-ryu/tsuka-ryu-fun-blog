import type { Point, Position } from "#markdown/types.js";

/** 診断。位置はソース全体の先頭からの offset と、1 始まりの行・桁で持つ。 */
export interface Diagnostic {
  severity: "error" | "warning";
  /** ルールの識別子（例: "unsafe-url"）。 */
  ruleId: string;
  message: string;
  /** 範囲の開始（含む）と終了（含まない）。エディタの範囲指定にそのまま使える。 */
  from: number;
  to: number;
  line: number;
  column: number;
}

/** 行の先頭 offset の表。offset から行・桁を引く。 */
export class LineIndex {
  readonly starts: number[] = [0];

  constructor(source: string) {
    for (let i = source.indexOf("\n"); i !== -1; i = source.indexOf("\n", i + 1)) {
      this.starts.push(i + 1);
    }
  }

  point(offset: number): Point {
    // 二分探索で、offset 以下で最大の行頭を探す。
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - (this.starts[lo] ?? 0) + 1, offset };
  }

  position(from: number, to: number): Position {
    return { start: this.point(from), end: this.point(to) };
  }
}

/** 診断を作って集めるための入れ物。パーサーと lint が共有する。 */
export class DiagnosticSink {
  readonly items: Diagnostic[] = [];

  constructor(readonly lines: LineIndex) {}

  add(severity: Diagnostic["severity"], ruleId: string, message: string, from: number, to: number) {
    const start = this.lines.point(from);
    this.items.push({
      severity,
      ruleId,
      message,
      from,
      to: Math.max(to, from),
      line: start.line,
      column: start.column,
    });
  }
}
