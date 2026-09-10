import {
  MAX_BODY,
  callDeepSeek,
  clientIp,
  cors,
  hasServerKey,
  json,
  rateLimit,
  redact,
} from "./_shared.js";

export const config = { runtime: "edge" };

export default async function handler(req) {
  const pre = cors(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(405, { error: { message: "仅支持 POST" } });

  const len = Number(req.headers.get("content-length") || "0");
  if (len > MAX_BODY) return json(413, { error: { message: "请求过大" } });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: { message: "请提交 JSON" } });
  }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length) {
    return json(400, { error: { message: "缺少 messages" } });
  }
  const safeMessages = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-24);
  const intent = ["collect", "generate", "revise"].includes(body.intent) ? body.intent : "collect";
  const model = typeof body.model === "string" ? body.model : "deepseek-chat";

  const headerAuth = req.headers.get("authorization") || "";
  const guestKey = headerAuth.toLowerCase().startsWith("bearer ")
    ? headerAuth.slice(7).trim()
    : "";
  const serverKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
  const key = guestKey || serverKey;
  if (!key) return json(401, { error: { message: "模型暂未配置" } });

  const limited = await rateLimit({ ip: clientIp(req), guestKey: Boolean(guestKey) });
  if (!limited.ok) return json(limited.status, { error: { message: limited.message } });

  try {
    const { res, data, errText } = await callDeepSeek({
      key,
      messages: safeMessages,
      model,
      intent,
    });
    if (!res.ok) {
      const mapped =
        res.status === 401 || res.status === 403
          ? "模型未配置或 Key 无效"
          : errText || `上游错误 ${res.status}`;
      return json(res.status >= 400 && res.status < 600 ? res.status : 502, {
        error: { message: mapped },
      });
    }
    const text = data.choices?.[0]?.message?.content || "";
    return json(200, { text, serverKey: hasServerKey() && !guestKey });
  } catch (err) {
    return json(502, { error: { message: redact(err.message || "生成失败") } });
  }
}
