export const VERSION = "1.1.0";
export const UPSTREAM = "https://api.deepseek.com/chat/completions";
export const MODELS = new Set(["deepseek-chat", "deepseek-reasoner"]);
export const MAX_BODY = 200 * 1024;
export const MAX_TOKENS = 4096;
export const IP_DAILY = 30;
export const ALL_DAILY = 200;

const BASE = `你是「轻漫游」里的本地向导，只做城市周边 1～3 小时微漫游：老街区步行、城市骑行、公园轻越野。

规则：
1. 先抽取用户已给的槽位，只问还缺的核心槽位，每次最多 2 问。
2. 禁止规划跨城、多日、机票酒店。若用户要长途，明确拒绝并拉回短途。
3. 避开过曝点：外滩、田子坊、豫园人潮、西湖断桥/雷峰塔、南键鼓巷、宽窄巷子等。给「同类氛围的非网红替代」。
4. 地点必须是真实存在的公共空间 / 街道 / 公园 / 滨江 / 可查到的咖啡馆。不许编造店名。没有把握的点不要写进 JSON。
5. 点位 4～8 个，顺序可走通，总时长匹配。给 WGS84 经纬度，字段名用 lat / lng（不要只用 lon）。
6. 需求矛盾时用白话指出，请用户选一边，不要强行给路线。
7. 核心槽位：city、mode（walk / cycling / trail）、durationHours（1～3）、startArea。startArea 为「随便/你定」算已填。

路线 JSON 必须符合：
{"title":"string","theme":"string","city":"string","mode":"walk|cycling|trail","durationHours":1,"distanceKm":1,"summary":"80字内","stops":[{"name":"string","lat":31.23,"lng":121.47,"stayMinutes":15,"intro":"40～80字","tips":"可选"}]}
stops 4～8 个。禁止缺 name / lat / lng / intro。`;

const INTENT = {
  collect:
    "当前 intent=collect。只追问或解释矛盾，禁止输出任何 JSON 代码块，禁止给完整路线。一次最多 2 问。",
  generate:
    "当前 intent=generate。先用 2～4 句中文说明为什么适合，然后必须且只能输出一个 ```json 代码块。不要再问新问题。",
  revise:
    "当前 intent=revise。在上一轮路线上修改，先 2～4 句说明改了什么，然后必须且只能输出一个 ```json 代码块。",
};

export function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function cors(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-headers": "content-type, authorization",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      },
    });
  }
  return null;
}

export function clientIp(req) {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return ip.slice(0, 64);
}

export function shanghaiDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function ttlToShanghaiMidnight() {
  const day = shanghaiDay();
  const [y, m, d] = day.split("-").map(Number);
  const nextUtc = Date.UTC(y, m - 1, d + 1, 0, 0, 0) - 8 * 3600 * 1000;
  return Math.max(60, Math.ceil((nextUtc - Date.now()) / 1000));
}

export function redact(text) {
  return String(text || "")
    .replace(/sk-[a-zA-Z0-9]{10,}/g, "sk-***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .slice(0, 240);
}

export function systemFor(intent) {
  const key = INTENT[intent] ? intent : "collect";
  return `${BASE}\n\n${INTENT[key]}`;
}

export function hasServerKey() {
  return Boolean(String(process.env.DEEPSEEK_API_KEY || "").trim());
}

export async function redisCmd(args) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([args]),
  });
  const data = await res.json().catch(() => null);
  const row = data?.result?.[0];
  if (row && typeof row === "object" && "result" in row) return row.result;
  return row;
}

export async function incrExpire(key, ttl) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return { ok: false, missing: true, n: 0 };
  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, ttl, "NX"],
    ]),
  });
  const data = await res.json().catch(() => null);
  const n = Number(data?.result?.[0]?.result ?? data?.result?.[0] ?? 0);
  if (!res.ok || !Number.isFinite(n)) return { ok: false, missing: false, n: 0 };
  return { ok: true, missing: false, n };
}

export async function rateLimit({ ip, guestKey }) {
  const day = shanghaiDay();
  const ttl = ttlToShanghaiMidnight();
  const ipHit = await incrExpire(`rl:ip:${ip}:${day}`, ttl);
  if (ipHit.missing) {
    return { ok: false, status: 503, message: "限流存储未配置，请稍后再试。" };
  }
  if (!ipHit.ok) {
    return { ok: false, status: 503, message: "限流服务暂时不可用。" };
  }
  if (ipHit.n > IP_DAILY) {
    return {
      ok: false,
      status: 429,
      message: "今日该网络试用次数已用完（30次），明天再来或填自己的 DeepSeek Key。",
    };
  }
  if (!guestKey) {
    const allHit = await incrExpire(`rl:all:${day}`, ttl);
    if (allHit.ok && allHit.n > ALL_DAILY) {
      return {
        ok: false,
        status: 429,
        message: "今日 Demo 总次数已满（200次），请明日再试或使用自己的 Key。",
      };
    }
  }
  return { ok: true };
}

export async function callDeepSeek({ key, messages, model, intent }) {
  const useModel = MODELS.has(model) ? model : "deepseek-chat";
  const body = {
    model: useModel,
    max_tokens: MAX_TOKENS,
    temperature: 0.7,
    messages: [{ role: "system", content: systemFor(intent) }, ...messages],
  };
  const res = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: { message: raw.slice(0, 200) } };
  }
  const errText = redact(typeof data.error === "string" ? data.error : data.error?.message || "");
  return { res, data, errText };
}
