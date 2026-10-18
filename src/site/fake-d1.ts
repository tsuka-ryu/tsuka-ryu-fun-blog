import { DatabaseSync } from "node:sqlite";

// テスト用の D1 もどき。node:sqlite のメモリ DB の上に、Drizzle の D1 ドライバが使う最小の API
// （prepare / bind / run / all / raw / batch）だけを実装する。本番と同じドライバ・同じ migration の SQL を通せる。

type Param = string | number | null;

class FakeStatement {
  constructor(
    private readonly db: DatabaseSync,
    readonly query: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...params: Param[]): FakeStatement {
    return new FakeStatement(this.db, this.query, params);
  }

  async run() {
    const result = this.db.prepare(this.query).run(...this.params);
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    };
  }

  async all() {
    const results = this.db.prepare(this.query).all(...this.params);
    return { success: true, results, meta: {} };
  }

  async raw() {
    const stmt = this.db.prepare(this.query);
    stmt.setReturnArrays(true);
    return stmt.all(...this.params);
  }
}

export class FakeD1 {
  private readonly db = new DatabaseSync(":memory:");

  /** migration の SQL（`--> statement-breakpoint` 区切り）を流す。 */
  exec(sqlText: string): void {
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      if (statement.trim()) this.db.exec(statement);
    }
  }

  /** 読み取りレプリカ用のセッション。メモリ DB なので、自分自身を返すだけ。 */
  withSession(): this {
    return this;
  }

  prepare(query: string): FakeStatement {
    return new FakeStatement(this.db, query);
  }

  /** D1 の batch は 1 つのトランザクション。途中で失敗したら全部戻す。 */
  async batch(statements: FakeStatement[]) {
    this.db.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
