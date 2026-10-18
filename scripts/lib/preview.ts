import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

// ビルド済みのサイト（`vite preview`。本番に近い workerd 上の Worker）を、まっさらなローカル状態（D1 / R2）で起動し、
// `content/posts/*.md` を管理 API で取り込む。VRT（vrt/global-setup.ts）と、QA（scripts/qa-preview.ts）が使う。
// 先に `pnpm build` しておくこと。開発中のローカル状態（`.void/`）には触れず、`stateDir` を使う。

export interface PreviewOptions {
  /** プロジェクトのルート。 */
  root: string;
  port: number;
  /** ローカルの D1 / R2 の保存先。起動のたびに消して作り直す。 */
  stateDir: string;
  /** プレビューの出力のログ。起動や取り込みに失敗したときに、末尾を見せる。 */
  logFile: string;
}

export interface Preview {
  origin: string;
  /** 管理 API を呼ぶ Bearer トークン。 */
  token: string;
  /** 保存先を消さずに止める。 */
  stop(): void;
  /** 保存先を消さずに、同じ状態で起動し直す（D1 を壊したあとの確認用）。 */
  restart(): Promise<void>;
}

const TOKEN = "preview-token";

// 認証のミドルウェアは全リクエストで GitHub の認証情報を要求するので、ダミーの値を渡す（ログインは使わない）。
const DEV_VARS: Record<string, string> = {
  ADMIN_API_TOKEN: TOKEN,
  AUTH_GITHUB_CLIENT_ID: "preview",
  AUTH_GITHUB_CLIENT_SECRET: "preview",
  BETTER_AUTH_SECRET: "preview-secret-for-local-preview-only-0123456789",
};

/**
 * トークンとダミーの認証情報を、ビルド成果物の `dist/ssr/.dev.vars`（`vite preview` のワーカーが読む環境変数）に書く。
 * `.env` はビルド時に `.dev.vars` へ写されるだけで、シェルの環境変数もプレビューには渡らない。
 * ビルドの出力を書き換えるだけなので、開発者の `.env` には触れない。
 */
function writeDevVars(root: string): void {
  const file = path.join(root, "dist/ssr/.dev.vars");
  if (!existsSync(path.dirname(file)))
    throw new Error("dist/ssr がありません。先に pnpm build してください");
  const keys = Object.keys(DEV_VARS);
  const kept = (existsSync(file) ? readFileSync(file, "utf8").split("\n") : []).filter(
    (line) => line.trim() !== "" && !keys.some((key) => line.startsWith(`${key}=`)),
  );
  const added = Object.entries(DEV_VARS).map(([key, value]) => `${key}=${value}`);
  writeFileSync(file, `${[...kept, ...added].join("\n")}\n`);
}

async function waitUntilReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // まだ起動していない。
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `サイトが ${timeoutMs}ms 以内に起動しませんでした（${url}）。先に pnpm build してください`,
  );
}

function logTail(logFile: string): string {
  return existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").slice(-30).join("\n") : "";
}

/** まっさらな状態で起動し、migration を流して、記事を取り込む。失敗したら、起動したプロセスを止めて投げる。 */
export async function startPreview(options: PreviewOptions): Promise<Preview> {
  const { root, port, stateDir, logFile } = options;
  const origin = `http://localhost:${port}`;
  const env = { ...process.env, VOID_PERSIST_TO: stateDir, ADMIN_API_TOKEN: TOKEN };
  let server: ChildProcess | undefined;

  const launch = async () => {
    mkdirSync(path.dirname(logFile), { recursive: true });
    const logFd = openSync(logFile, "w");
    server = spawn("pnpm", ["exec", "vite", "preview", "--port", String(port), "--strictPort"], {
      cwd: root,
      env,
      // 起動に失敗したときに原因が追えるよう、出力をファイルに残す。
      stdio: ["ignore", logFd, logFd],
      // pnpm の子プロセスごと止められるよう、独立したプロセスグループにする。
      detached: true,
    });
    closeSync(logFd);
    await waitUntilReady(`${origin}/`, 60_000);
  };

  const stop = () => {
    if (!server?.pid) return;
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // すでに終了している。
    }
    server = undefined;
  };

  const run = (command: string, args: string[]) => {
    try {
      execFileSync(command, args, { cwd: root, env, stdio: "pipe", encoding: "utf8" });
    } catch (error) {
      const { stdout, stderr } = error as { stdout?: string; stderr?: string };
      throw new Error(
        `${command} ${args.join(" ")} に失敗しました\n${stdout ?? ""}${stderr ?? ""}\n--- ${path.basename(logFile)} ---\n${logTail(logFile)}`,
      );
    }
  };

  try {
    rmSync(stateDir, { recursive: true, force: true });
    writeDevVars(root);
    await launch();
    // プレビューが起動して保存先（`.void/local-d1.json`）を記録したあとでないと、`void db` は `VOID_PERSIST_TO` に従わない。
    run("pnpm", ["exec", "void", "db", "migrate"]);
    run("node", ["scripts/import-posts.ts", origin]);
  } catch (error) {
    stop();
    throw error;
  }
  return {
    origin,
    token: TOKEN,
    stop,
    restart: async () => {
      stop();
      await launch();
    },
  };
}
