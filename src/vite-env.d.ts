/// <reference types="vite/client" />

// `.bin` は、Cloudflare Workers がバイト列（ArrayBuffer）のモジュールとして読み込む。
declare module "*.bin" {
  const data: ArrayBuffer;
  export default data;
}
