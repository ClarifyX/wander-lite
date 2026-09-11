# 轻漫游

对话式「家门口短途」灵感探索器。全屏浅灰地图 + 四周留缝悬浮抽屉，ChatGPT 风格对话。可当 PWA 打开。

- GitHub：https://github.com/ClarifyX/wander-lite
- Vercel：https://wander-lite.vercel.app
- 版本 tag：与需求文档编号对齐，当前 `v1.4.0`

## 本地运行

```bash
python3 server.py
```

打开 http://127.0.0.1:8787 。Key 放在项目根目录 `.env`（已被 gitignore）：

```
DEEPSEEK_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
AMAP_JS_KEY=
AMAP_SECURITY_JS_CODE=
AMAP_WEB_KEY=
```

不要把真实 Key 写进代码或本 README。本地 `server.py` 会读 `.env` 做 `/api/health`、`/api/map-config`、`/api/chat`、`/api/plan`。底图脚本由浏览器直连高德 JS API（须 `AMAP_JS_KEY`）；POI / 步行 / 骑行只用服务端 `AMAP_WEB_KEY`，不下发浏览器。本地 IP 限流是内存近似；**生产以 Vercel Upstash 为准：每 IP 每天 30 次，全站每天 200 次**（访客自带 Key 仍计 IP 30，不计全站 200）。

无服务端 Key 时仍可 **+ → 加载示例路线** 看地图。

## Git 版本与回滚

需求文档现行为 `1.4.0`（tag `v1.4.0`）：从当前位置接到附近一个点的高德真路。地图栈见 `1.3.0`。

```bash
git tag -l
git checkout v1.3.0   # 高德全栈 + 多点通惠河示例
git checkout v1.4.0   # 定位 GCJ-02 + 一点真路
```

Safari 打开会留下系统地址栏，网页去不掉。地图沉浸请用「添加到主屏幕」后的 PWA 验收。

生产跟 `main`。需要让 main 退回某版时用 `git revert` 或基于 tag 开修复分支，不要 force push `main`。

## 发布

源码在 GitHub。Vercel 连该仓，push `main` 即部署。对话走 Vercel：`GET /api/health`、`GET /api/map-config`、`POST /api/chat`、`POST /api/plan`。1.4.0 起 plan 从用户定位接到 5km 内一个目的地（高德步行/骑行真折线）。底图为高德 JS API 2.0。另需 `AMAP_JS_KEY` / `AMAP_WEB_KEY`（只进 Env，不要进 Git）。站长 DeepSeek Key 为 `DEEPSEEK_API_KEY`。限流用 Upstash Redis（`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`）。

访客可不填 Key（限额内走站长 Env），也可以在设置里填自己的 DeepSeek Key（请求带自己的 Bearer，不消耗站长 Key）。

## 产品怎么用

1. 点定位（允许后对话不再问你在哪）
2. 说一句模糊想法
3. 收集偏好时最多追问 2 个问题，不会出路线 JSON
4. 槽位齐了才生成预览；点 **确认路线** 才画地图；**重新生成** 不会立刻覆盖已确认的图
5. 「改短一点」会按修改路线再出 JSON

Safari 打开会留下系统地址栏，网页去不掉。要看地图钻进灵动岛，请用「添加到主屏幕」后的 PWA。

## 作品集物料

- GitHub 仓库
- Vercel 在线 Demo
- 产品文档：`docs/产品架构.md`
