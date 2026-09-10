import { createSheet } from "./sheet.js";
import { createMap } from "./map.js";
import {
  chat as llmChat,
  setApiKey,
  clearApiKey,
  hasApiKey,
  canChat,
  setModel,
  getModel,
  probeHealth,
} from "./deepseek.js";
import { parseRoute, modeLabel, proseWithoutJson } from "./parse-route.js";

const GREETING =
  "跟我说一句你隐约想去的方向就行。比如：周末下午在市区骑两小时，想看老厂房，避开网红点。我一次最多问两个问题，问清了再给你一条可走的短途。";

const STARTERS = [
  "我想周末下午，在市区骑行 2 小时，避开网红打卡点，想看老厂房和老街区，路尽量平缓。",
  "傍晚沿河边慢慢走，想安静，不想人挤人。",
  "公园里轻越野一下，1.5 小时，别太累。",
];

const els = {
  messages: document.getElementById("sheet-messages"),
  form: document.getElementById("composer"),
  input: document.getElementById("prompt"),
  send: document.getElementById("send"),
  plus: document.getElementById("btn-plus"),
  plusMenu: document.getElementById("plus-menu"),
  keyPanel: document.getElementById("key-panel"),
  keyInput: document.getElementById("key-input"),
  modelInput: document.getElementById("model-input"),
  keySave: document.getElementById("key-save"),
  keyClear: document.getElementById("key-clear"),
  keyClose: document.getElementById("key-close"),
  gear: document.getElementById("btn-gear"),
  locate: document.getElementById("btn-locate"),
  zoomIn: document.getElementById("btn-zoom-in"),
  zoomOut: document.getElementById("btn-zoom-out"),
  controls: document.getElementById("map-controls"),
  sheet: document.getElementById("sheet"),
};

const wanderMap = createMap("map");
const history = [];
let intent = "collect";
let pendingRoute = null;
let confirmedRoute = null;
let busy = false;

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatAssistant(text) {
  const safe = escapeHtml(text);
  const withBold = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return withBold
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^[-•]/.test(l.trim()) || !l.trim())) {
        const items = lines
          .filter((l) => l.trim())
          .map((l) => `<li>${l.replace(/^[-•]\s*/, "")}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${lines.join("<br>")}</p>`;
    })
    .join("");
}

function addMessage({ role, text, html, extra }) {
  const box = els.messages || document.getElementById("sheet-messages");
  const art = document.createElement("article");
  art.className = `msg msg-${role}`;
  if (role === "user") {
    art.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  } else if (role === "system") {
    art.innerHTML = `<p>${escapeHtml(text)}</p>`;
  } else {
    art.innerHTML = html || formatAssistant(text);
  }
  if (extra) art.appendChild(extra);
  box.appendChild(art);
  box.scrollTop = box.scrollHeight;
  return art;
}

function routeCard(route, { gated } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "route-card";
  const mode = modeLabel(route.mode);
  wrap.innerHTML = `
    <h2>${escapeHtml(route.title)}</h2>
    <p class="meta">${escapeHtml(route.city)} · ${escapeHtml(mode)} · ${escapeHtml(String(route.durationHours))}h · ${escapeHtml(String(route.distanceKm))}km</p>
    <p>${escapeHtml(route.summary || route.theme || "")}</p>
    <ol>${(route.stops || []).map((s, i) => `<li>${i + 1}. ${escapeHtml(s.name)}</li>`).join("")}</ol>
  `;
  if (gated) {
    const actions = document.createElement("div");
    actions.className = "gate-actions";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "确认路线";
    const again = document.createElement("button");
    again.type = "button";
    again.textContent = "重新生成";
    ok.addEventListener("click", () => confirmRoute(ok, again));
    again.addEventListener("click", () => regenerate());
    actions.append(ok, again);
    wrap.appendChild(actions);
  }
  return wrap;
}

function coreSlotsReady(texts) {
  const blob = texts.join("\n");
  const city = /上海|北京|杭州|广州|深圳|成都|南京|武汉|西安|重庆|苏州|宁波|天津|长沙|青岛|厦门/.test(blob);
  const mode = /骑行|骑车|自行车|步行|散步|漫步|走走|越野|步道/.test(blob);
  const hours = /\d+(?:\.\d+)?\s*小时|一下午|一小时|两小时/.test(blob);
  const start = /附近|起点|片区|杨浦|虹口|徐汇|普陀|西城|海淀|拱墅|随便|你定|家门口|市区/.test(blob);
  return city && mode && hours && start;
}

function isReset(text) {
  return /重新说|换个城市|换一座城|从头来|重开一轮/.test(text);
}

function isRevise(text) {
  return /太长|改短|更安静|换一条|加点咖啡|缩短|不要那么多/.test(text);
}

function contradictionOf(blob) {
  if (/只要步行|只能步行|不要骑/.test(blob) && /骑行|骑车/.test(blob)) {
    return "只要步行却又提到骑行";
  }
  if (/必须.*(外滩|田子坊|断桥|南键|宽窄)/.test(blob) && /避开.*网红|不要网红/.test(blob)) {
    return "既要去过曝点又要避开网红";
  }
  if (/(^|[^\d])(1|一)\s*小时/.test(blob) && /三个区|跨区狂奔|30\s*公里/.test(blob)) {
    return "时长和路程对不上";
  }
  return null;
}

function pickIntent(userText) {
  if (isReset(userText)) {
    pendingRoute = null;
    intent = "collect";
    return "collect";
  }
  if ((pendingRoute || confirmedRoute) && isRevise(userText)) {
    intent = "revise";
    return "revise";
  }
  const corpus = [...history.map((m) => m.content), userText];
  const blob = corpus.join("\n");
  if (contradictionOf(blob)) {
    intent = "collect";
    return "collect";
  }
  if (coreSlotsReady(corpus)) {
    intent = "generate";
    return "generate";
  }
  intent = "collect";
  return "collect";
}

function friendlyError(err) {
  if (err.kind === "timeout" || err.status === 408) return "模型响应超时，请重试";
  if (err.kind === "network") return "网络异常，请稍后重试";
  if (err.status === 401 || err.message === "NO_KEY") return "模型未配置或 Key 无效";
  if (err.status === 429) return err.message;
  if (err.status >= 400) return `生成失败：${err.message}`;
  return "网络异常，请稍后重试";
}

function setBusy(on) {
  busy = on;
  els.send.disabled = on || !els.input.value.trim();
  els.input.disabled = on;
}

function syncSend() {
  els.send.disabled = busy || !els.input.value.trim();
}

function autosize() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(els.input.scrollHeight, 120)}px`;
}

function openKeyPanel() {
  els.keyPanel.hidden = false;
  els.plusMenu.hidden = true;
  els.modelInput.value = getModel();
  sheet.setSnap("half");
}

function closeKeyPanel() {
  els.keyPanel.hidden = true;
}

function positionControls(height, snap = "half") {
  try {
    const rect = els.sheet.getBoundingClientRect();
    const gap = 10;
    els.controls.style.right = `${gap + 4}px`;
    els.controls.style.bottom = `${Math.max(gap, window.innerHeight - rect.top + 12)}px`;
    wanderMap.setPadding({
      top: snap === "expanded" ? Math.max(gap, Math.round(rect.top)) : 24,
      left: Math.max(gap, Math.round(rect.left)),
      right: Math.max(gap, Math.round(window.innerWidth - rect.right)),
      bottom: Math.max(80, Math.round(window.innerHeight - rect.top)),
    });
    wanderMap.invalidate();
  } catch (err) {
    console.error(err);
  }
}

function renderGreeting() {
  addMessage({ role: "assistant", text: GREETING });
  const chips = document.createElement("div");
  chips.className = "chips";
  STARTERS.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s;
    b.addEventListener("click", () => sendUser(s));
    chips.appendChild(b);
  });
  els.messages.appendChild(chips);
}

renderGreeting();

const sheet = createSheet(els.sheet, {
  onChange({ height, snap }) {
    positionControls(height, snap);
  },
});

function confirmRoute(okBtn, againBtn) {
  if (!pendingRoute) return;
  const drawn = wanderMap.renderRoute(pendingRoute);
  if (drawn && drawn.ok === false) {
    addMessage({ role: "system", text: `地图校验失败，未渲染：${drawn.error}` });
    return;
  }
  confirmedRoute = pendingRoute;
  if (okBtn) {
    okBtn.textContent = "已画到地图";
    okBtn.disabled = true;
  }
  if (againBtn) againBtn.disabled = true;
  sheet.setSnap("half");
}

async function regenerate() {
  if (!canChat()) {
    addMessage({ role: "system", text: "模型暂未配置。可填自己的 DeepSeek Key，或先加载示例路线。" });
    openKeyPanel();
    return;
  }
  const prev = pendingRoute || confirmedRoute;
  const names = (prev?.stops || []).map((s) => s.name).join("、");
  await sendUser("请基于同一偏好重新生成一条不同的路线。", {
    visible: true,
    forceIntent: prev && confirmedRoute && prev !== pendingRoute ? "revise" : "generate",
    extra: prev ? `\n上一轮：${prev.title}（${names}）` : "",
  });
}

async function loadSample() {
  els.plusMenu.hidden = true;
  const res = await fetch("./data/sample-route.json");
  const route = await res.json();
  wanderMap.clearRoute();
  const drawn = wanderMap.renderRoute(route);
  if (drawn && drawn.ok === false) {
    addMessage({ role: "system", text: `示例路线校验失败：${drawn.error}` });
    return;
  }
  confirmedRoute = route;
  addMessage({
    role: "assistant",
    text: "已加载示例路线，用于验证地图（不耗 Token）。",
    extra: routeCard(route),
  });
  sheet.setSnap("half");
}

async function sendUser(text, { visible = true, extra = "", forceIntent } = {}) {
  const value = text.trim();
  if (!value || busy) return;
  document.querySelector(".chips")?.remove();
  if (visible) addMessage({ role: "user", text: value });
  els.input.value = "";
  autosize();
  sheet.expandIfCollapsed();

  if (!canChat()) {
    addMessage({
      role: "assistant",
      text: "公网 Demo 会走服务端模型（限额内）。若未配置，可在设置里填自己的 DeepSeek Key，或先点【加载示例路线】。",
    });
    openKeyPanel();
    return;
  }

  const nextIntent = forceIntent || pickIntent(value);
  let payload = value + extra;
  const ref = pendingRoute || confirmedRoute;
  if (nextIntent === "revise" && ref) {
    payload += `\n[上一轮路线] ${ref.title}；点位：${(ref.stops || []).map((s) => s.name).join("、")}`;
  }

  setBusy(true);
  const thinking = addMessage({ role: "system", text: "在想…" });
  try {
    const { text: reply } = await llmChat({ history, userText: payload, intent: nextIntent });
    thinking.remove();
    history.push({ role: "user", content: value });
    history.push({ role: "assistant", content: reply });
    const parsed = parseRoute(reply);
    const prose = proseWithoutJson(reply) || reply;

    if (nextIntent === "collect") {
      if (parsed.ok) {
        addMessage({ role: "assistant", text: prose });
        addMessage({ role: "system", text: "还在收集偏好，未生成路线。" });
      } else {
        addMessage({ role: "assistant", text: prose || reply });
      }
      return;
    }

    if (parsed.ok) {
      pendingRoute = parsed.route;
      addMessage({
        role: "assistant",
        text: prose,
        extra: routeCard(parsed.route, { gated: true }),
      });
    } else {
      addMessage({ role: "assistant", text: prose || reply });
      addMessage({ role: "system", text: "路线数据解析失败，请点重新生成" });
    }
  } catch (err) {
    thinking.remove();
    addMessage({ role: "system", text: friendlyError(err) });
    if (err.status === 401 || err.message === "NO_KEY") openKeyPanel();
  } finally {
    setBusy(false);
    syncSend();
    els.input.focus();
  }
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  sendUser(els.input.value);
});
els.input.addEventListener("input", () => {
  autosize();
  syncSend();
});
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendUser(els.input.value);
  }
});
els.input.addEventListener("focus", () => sheet.expandIfCollapsed());

els.plus.addEventListener("click", () => {
  els.plusMenu.hidden = !els.plusMenu.hidden;
});
els.plusMenu.addEventListener("click", (e) => {
  const act = e.target.dataset.act;
  if (act === "sample") loadSample();
  if (act === "key") openKeyPanel();
});
els.gear.addEventListener("click", openKeyPanel);
els.keyClose.addEventListener("click", closeKeyPanel);
els.keySave.addEventListener("click", () => {
  setApiKey(els.keyInput.value);
  setModel(els.modelInput.value);
  els.keyInput.value = "";
  closeKeyPanel();
  addMessage({
    role: "system",
    text: hasApiKey() ? "已使用你自己的 Key（只在这次内存）。" : "没有读到 Key，将尝试服务端配置。",
  });
});
els.keyClear.addEventListener("click", () => {
  clearApiKey();
  els.keyInput.value = "";
  addMessage({ role: "system", text: "已从内存清除访客 Key。" });
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#plus-menu, #btn-plus")) els.plusMenu.hidden = true;
});

els.locate.addEventListener("click", () => wanderMap.locateMe());
els.zoomIn.addEventListener("click", () => wanderMap.zoomIn());
els.zoomOut.addEventListener("click", () => wanderMap.zoomOut());

syncSend();
positionControls(sheet.getHeight(), sheet.getSnap());
probeHealth().then((h) => {
  if (h.ok && h.serverKey) {
    addMessage({ role: "system", text: "已连接服务端模型（限额内无需自备 Key）。" });
  }
});

if (new URLSearchParams(location.search).get("sample") === "1") {
  loadSample();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).catch(() => {});
  });
}
