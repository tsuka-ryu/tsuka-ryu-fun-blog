// 行単位の差分（履歴の版と、いまの下書きの比較に使う）。最長共通部分列で求める。

export type DiffLine = { kind: "same" | "add" | "remove"; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");

  // 先頭と末尾の共通部分は、表を作らずに取り除く（長い記事の小さな変更を軽くするため）。
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const head = a.slice(0, start).map((text): DiffLine => ({ kind: "same", text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ kind: "same", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  // 真ん中が大きすぎるときは、表を作らず、まるごと置き換えとして扱う（メモリを使い切らないため）。
  if (midA.length * midB.length > 4_000_000) {
    return [
      ...head,
      ...midA.map((text): DiffLine => ({ kind: "remove", text })),
      ...midB.map((text): DiffLine => ({ kind: "add", text })),
      ...tail,
    ];
  }

  const rows = midA.length + 1;
  const cols = midB.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        midA[i] === midB[j]
          ? table[(i + 1) * cols + j + 1]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }

  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      middle.push({ kind: "same", text: midA[i]! });
      i++;
      j++;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      middle.push({ kind: "remove", text: midA[i++]! });
    } else {
      middle.push({ kind: "add", text: midB[j++]! });
    }
  }
  while (i < midA.length) middle.push({ kind: "remove", text: midA[i++]! });
  while (j < midB.length) middle.push({ kind: "add", text: midB[j++]! });
  return [...head, ...middle, ...tail];
}
