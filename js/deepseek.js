const DEFAULT_MODEL = "deepseek-chat";
const TIMEOUT_MS = 25000;

let apiKey = "";
let model = DEFAULT_MODEL;
let serverKey = false;
let healthTried = false;

export function setApiKey(value) {
  apiKey = String(value || "").trim();
}

export function clearApiKey() {
  apiKey = "";
}

export function hasApiKey() {
  return Boolean(apiKey);
}

export function hasServerKey() {
  return serverKey;
}

export function canChat() {
  return hasApiKey() || serverKey;
}

export function setModel(value) {
  model = String(value || "").trim() || DEFAULT_MODEL;
}

export function getModel() {
  return model;
}

function errorMessage(data, status) {
  const err = data?.error;
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err && typeof err.message === "string" && err.message.trim()) return err.message.trim();
  return `HTTP ${status}`;
}

export async function probeHealth() {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    const data = await res.json();
    serverKey = Boolean(res.ok && data && data.ok && data.serverKey);
    healthTried = true;
    return { ok: res.ok && data?.ok === true, serverKey, version: data?.version || "" };
  } catch {
    healthTried = true;
    serverKey = false;
    return { ok: false, serverKey: false, version: "" };
  }
}

export async function chat({ history, userText, intent }) {
  if (!healthTried) await probeHealth();
  if (!canChat()) {
    const err = new Error("NO_KEY");
    err.status = 401;
    throw err;
  }

  const messages = [...history, { role: "user", content: userText }];
  const headers = { "content-type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        messages,
        model,
        intent: intent || "collect",
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      const e = new Error("模型响应超时，请重试");
      e.status = 408;
      e.kind = "timeout";
      throw e;
    }
    const e = new Error("网络异常，请稍后重试");
    e.status = 0;
    e.kind = "network";
    throw e;
  }
  clearTimeout(timer);

  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: { message: raw.slice(0, 200) } };
  }
  if (!res.ok) {
    const err = new Error(errorMessage(data, res.status));
    err.status = res.status;
    throw err;
  }
  const text = data.text || data.choices?.[0]?.message?.content || "";
  return { text, raw: data };
}
