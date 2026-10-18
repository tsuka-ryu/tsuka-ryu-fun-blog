// 公開スナップショットの置き場（本番は R2）。公開関数とテストを、R2 に依存させないための薄い抽象。
// 扱うのはテキスト（JSON / Markdown / XML）だけ。画像などのバイナリは、R2 を直接使う。

export interface ObjectStore {
  /** 存在しなければ null。 */
  get(key: string): Promise<string | null>;
  put(key: string, body: string, contentType: string): Promise<void>;
  /** 存在しないキーを消してもエラーにしない。 */
  delete(key: string): Promise<void>;
  /** prefix で始まるキーを、辞書順で全部返す。 */
  list(prefix: string): Promise<string[]>;
}

/** テスト用のメモリ実装。書き込みの失敗を差し込めるよう、`failOn` を持つ。 */
export class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { body: string; contentType: string }>();
  /** true を返したキーへの put / delete を、例外で失敗させる（途中失敗のテスト用）。 */
  failOn: (key: string) => boolean = () => false;
  /** get の呼び出し回数（読み取りの回数を数えるテスト用）。 */
  gets = 0;

  async get(key: string): Promise<string | null> {
    this.gets += 1;
    return this.objects.get(key)?.body ?? null;
  }

  async put(key: string, body: string, contentType: string): Promise<void> {
    if (this.failOn(key)) throw new Error(`put failed: ${key}`);
    this.objects.set(key, { body, contentType });
  }

  async delete(key: string): Promise<void> {
    if (this.failOn(key)) throw new Error(`delete failed: ${key}`);
    this.objects.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}
