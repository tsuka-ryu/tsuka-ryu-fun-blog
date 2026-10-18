// 公開スナップショットの置き場（本番は R2）。公開関数とテストを、R2 に依存させないための薄い抽象。
// 読み書きできるのは、テキスト（JSON / Markdown / XML）と、公開時に作る PNG（OG 画像）。
// アップロードされた画像は、R2 を直接使う。

export interface ObjectStore {
  /** 存在しなければ null。 */
  get(key: string): Promise<string | null>;
  put(key: string, body: string | Uint8Array, contentType: string): Promise<void>;
  /** バイト列として読む（OG 画像）。存在しなければ null。 */
  getBytes(key: string): Promise<Uint8Array | null>;
  /** 存在しないキーを消してもエラーにしない。 */
  delete(key: string): Promise<void>;
  /** prefix で始まるキーを、辞書順で全部返す。 */
  list(prefix: string): Promise<string[]>;
}

/** テスト用のメモリ実装。書き込みの失敗を差し込めるよう、`failOn` を持つ。 */
export class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { body: string | Uint8Array; contentType: string }>();
  /** true を返したキーへの put / delete を、例外で失敗させる（途中失敗のテスト用）。 */
  failOn: (key: string) => boolean = () => false;
  /** get の呼び出し回数（読み取りの回数を数えるテスト用）。 */
  gets = 0;

  async get(key: string): Promise<string | null> {
    this.gets += 1;
    const body = this.objects.get(key)?.body;
    return typeof body === "string" ? body : null;
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    this.gets += 1;
    const body = this.objects.get(key)?.body;
    return body instanceof Uint8Array ? body : null;
  }

  async put(key: string, body: string | Uint8Array, contentType: string): Promise<void> {
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
