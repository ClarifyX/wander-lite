const MODE_LABEL = {
  walk: "老街区漫步",
  cycling: "城市骑行",
  trail: "公园轻越野",
};

export function extractJson(text) {
  const fences = [...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  if (fences.length) return fences[fences.length - 1][1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

export function inChina(lat, lng) {
  return lat >= 18 && lat <= 53 && lng >= 73 && lng <= 135;
}

export function normalizeStop(stop) {
  if (!stop || typeof stop !== "object") return null;
  const lat = Number(stop.lat);
  const lng = Number(stop.lng ?? stop.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inChina(lat, lng)) return null;
  if (!stop.name || !stop.intro) return null;
  return { ...stop, lat, lng };
}

export function parseRoute(text) {
  const raw = extractJson(text);
  if (!raw) return { ok: false, error: "没有找到 JSON" };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "JSON 格式损坏" };
  }
  return validateRoute(data);
}

export function validateRoute(data) {
  if (!data || typeof data !== "object") return { ok: false, error: "JSON 格式损坏" };
  if (!Array.isArray(data.stops)) return { ok: false, error: "缺经纬度" };
  if (data.stops.length < 2 || data.stops.length > 12) {
    return { ok: false, error: "点位数量不在 2～12 之间" };
  }
  const stops = [];
  for (const stop of data.stops) {
    const n = normalizeStop(stop);
    if (!n) return { ok: false, error: "缺经纬度" };
    stops.push(n);
  }
  if (!data.title || !data.city || !data.mode) {
    return { ok: false, error: "JSON 缺路线标题或城市/方式" };
  }
  return { ok: true, route: { ...data, stops } };
}

export function modeLabel(mode) {
  return MODE_LABEL[mode] || mode || "";
}

export function proseWithoutJson(text) {
  return String(text)
    .replace(/```(?:json)?\s*[\s\S]*?```/gi, "")
    .trim();
}
