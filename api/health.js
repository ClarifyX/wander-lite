import { VERSION, cors, hasServerKey, json } from "./_shared.js";

export const config = { runtime: "edge" };

export default async function handler(req) {
  const pre = cors(req);
  if (pre) return pre;
  if (req.method !== "GET") return json(405, { error: { message: "仅支持 GET" } });
  return json(200, { ok: true, serverKey: hasServerKey(), version: VERSION });
}
