#!/usr/bin/env python3
"""本地静态站 + DeepSeek 反代。Key 只从 .env 读取。限流以 Vercel Upstash 为准，本地用内存近似。"""

from __future__ import annotations

import json
import os
import posixpath
import re
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("WANDER_HOST", "127.0.0.1")
PORT = int(os.environ.get("WANDER_PORT", "8787"))
UPSTREAM = "https://api.deepseek.com/chat/completions"
VERSION = "1.1.0"
CST = timezone(timedelta(hours=8))
IP_DAILY = 30
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
_ip_hits: dict[str, tuple[str, int]] = defaultdict(lambda: ("", 0))

BASE = """你是「轻漫游」里的本地向导，只做城市周边 1～3 小时微漫游。
规则：一次最多 2 问；禁止跨城多日机票酒店；避开过曝网红点；地点必须真实；点位 4～8 个，字段 lat/lng。
核心槽位：city、mode（walk/cycling/trail）、durationHours、startArea。
路线 JSON：title,theme,city,mode,durationHours,distanceKm,summary,stops[{name,lat,lng,stayMinutes,intro,tips}]"""

INTENT = {
    "collect": "当前 intent=collect。禁止任何 JSON 代码块。",
    "generate": "当前 intent=generate。先 2～4 句说明，然后必须且只能一个 ```json 代码块。",
    "revise": "当前 intent=revise。在上一轮上改，先说明再输出唯一 ```json 代码块。",
}


def load_env() -> None:
    for name in (".env", ".env.local"):
        path = ROOT / name
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


load_env()


def shanghai_day() -> str:
    return datetime.now(CST).strftime("%Y-%m-%d")


def redact(text: str) -> str:
    s = re.sub(r"sk-[a-zA-Z0-9]{10,}", "sk-***", text or "")
    s = re.sub(r"Bearer\s+\S+", "Bearer ***", s, flags=re.I)
    return s[:240]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        msg = fmt % args
        if "Authorization" in msg or "Bearer" in msg or "sk-" in msg:
            return
        print(f"[wander-lite] {self.address_string()} {msg}")

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] == "/api/health":
            key = bool(os.environ.get("DEEPSEEK_API_KEY", "").strip())
            self._json(200, {"ok": True, "serverKey": key, "version": VERSION})
            return
        super().do_GET()

    def _limit(self, ip: str) -> str | None:
        day = shanghai_day()
        prev_day, n = _ip_hits[ip]
        if prev_day != day:
            n = 0
        n += 1
        _ip_hits[ip] = (day, n)
        if n > IP_DAILY:
            return "今日该网络试用次数已用完（30次），明天再来或填自己的 DeepSeek Key。"
        return None

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/api/chat":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length > 200 * 1024:
            self._json(413, {"error": {"message": "请求过大"}})
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"error": {"message": "请提交 JSON"}})
            return
        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            self._json(400, {"error": {"message": "缺少 messages"}})
            return
        intent = payload.get("intent") if payload.get("intent") in INTENT else "collect"
        model = payload.get("model") if payload.get("model") in {"deepseek-chat", "deepseek-reasoner"} else "deepseek-chat"
        auth = self.headers.get("Authorization", "")
        guest = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        server = os.environ.get("DEEPSEEK_API_KEY", "").strip()
        key = guest or server
        if not key:
            self._json(401, {"error": {"message": "模型暂未配置"}})
            return
        hit = self._limit(self.client_address[0])
        if hit:
            self._json(429, {"error": {"message": hit}})
            return
        safe = [
            {"role": m.get("role"), "content": m.get("content")}
            for m in messages
            if isinstance(m, dict) and m.get("role") in {"user", "assistant"} and isinstance(m.get("content"), str)
        ][-24:]
        body = json.dumps(
            {
                "model": model,
                "max_tokens": 4096,
                "temperature": 0.7,
                "messages": [{"role": "system", "content": BASE + "\n" + INTENT[intent]}, *safe],
            },
            ensure_ascii=False,
        ).encode("utf-8")
        req = urllib.request.Request(
            UPSTREAM,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        )
        try:
            with _OPENER.open(req, timeout=90) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
                self._json(200, {"text": text, "serverKey": bool(server) and not guest})
        except urllib.error.HTTPError as exc:
            err_raw = exc.read().decode("utf-8", "ignore")
            try:
                parsed = json.loads(err_raw)
                msg = parsed.get("error", {})
                msg = msg if isinstance(msg, str) else msg.get("message", err_raw)
            except json.JSONDecodeError:
                msg = err_raw
            mapped = "模型未配置或 Key 无效" if exc.code in (401, 403) else redact(str(msg) or f"上游错误 {exc.code}")
            self._json(exc.code, {"error": {"message": mapped}})
        except Exception as exc:  # noqa: BLE001
            self._json(502, {"error": {"message": redact(str(exc))}})

    def translate_path(self, path: str) -> str:
        path = path.split("?", 1)[0].split("#", 1)[0]
        path = posixpath.normpath(path)
        words = [w for w in path.split("/") if w and w != ".."]
        resolved = ROOT.joinpath(*words)
        if resolved.is_dir():
            resolved = ROOT / "index.html"
        return str(resolved)


if __name__ == "__main__":
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"轻漫游 {VERSION}  http://{HOST}:{PORT}")
    print("本地限流为内存近似；生产以 Vercel Upstash 30/IP/天 + 全站 200/天为准")
    httpd.serve_forever()
