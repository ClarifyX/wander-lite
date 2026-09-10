import { validateRoute } from "./parse-route.js";

const ATTRIBUTION = "Tiles &copy; Esri &copy; OpenStreetMap";
// 1.0.1 指定 Carto light_all，但 cartocdn 现会打 API KEY REQUIRED 水印。
// 无 Carto Key 时用同气质的浅灰底图；有 Carto Key 后再换回官方 URL。
const TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function noopMap() {
  return {
    setPadding() {},
    invalidate() {},
    zoomIn() {},
    zoomOut() {},
    locateMe() {},
    clearRoute() {},
    renderRoute() {},
  };
}

export function createMap(domId) {
  const L = window.L;
  if (!L) {
    console.error("Leaflet 未加载");
    return noopMap();
  }

  function numberedIcon(n) {
    return L.divIcon({
      className: "wander-pin",
      html: `<span>${n}</span>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -14],
    });
  }

  const host = document.getElementById(domId);
  if (host && host._leaflet_id) {
    host._leaflet_id = undefined;
    host.replaceChildren();
  }

  const map = L.map(domId, {
    zoomControl: false,
    scrollWheelZoom: true,
    dragging: true,
    attributionControl: true,
  }).setView([31.23, 121.47], 12);

  L.tileLayer(TILE, {
    attribution: ATTRIBUTION,
    maxZoom: 16,
  }).addTo(map);

  const layer = L.layerGroup().addTo(map);
  let pad = { top: 24, left: 10, right: 10, bottom: 280 };

  function fit(route) {
    const stops = route.stops || [];
    if (!stops.length) return;
    if (stops.length === 1) {
      map.setView([stops[0].lat, stops[0].lng], 15);
      return;
    }
    const bounds = L.latLngBounds(stops.map((s) => [s.lat, s.lng]));
    map.fitBounds(bounds, {
      paddingTopLeft: [pad.left, pad.top],
      paddingBottomRight: [pad.right, pad.bottom],
    });
  }

  const api = {
    map,
    setPadding(next) {
      pad = { ...pad, ...next };
    },
    invalidate() {
      setTimeout(() => map.invalidateSize(), 40);
    },
    zoomIn() {
      map.zoomIn();
    },
    zoomOut() {
      map.zoomOut();
    },
    locateMe() {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.setView([pos.coords.latitude, pos.coords.longitude], 14);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 4000 }
      );
    },
    clearRoute() {
      layer.clearLayers();
    },
    renderRoute(route) {
      layer.clearLayers();
      const checked = validateRoute(route);
      if (!checked.ok) return checked;
      const stops = checked.route.stops;
      const latlngs = stops.map((s) => [s.lat, s.lng]);
      L.polyline(latlngs, {
        color: "#3a3a3c",
        weight: 3.5,
        opacity: 0.85,
      }).addTo(layer);
      stops.forEach((stop, i) => {
        const marker = L.marker([stop.lat, stop.lng], { icon: numberedIcon(i + 1) }).addTo(layer);
        const stay = stop.stayMinutes ? `停留 ${stop.stayMinutes} 分钟` : "";
        const tips = stop.tips ? `<p class="tips">${esc(stop.tips)}</p>` : "";
        marker.bindPopup(
          `<h3>${esc(stop.name)}</h3><p>${esc(stop.intro || "")}</p>${stay ? `<p class="tips">${stay}</p>` : ""}${tips}`
        );
      });
      fit(checked.route);
      api.invalidate();
      return { ok: true };
    },
  };

  return api;
}
