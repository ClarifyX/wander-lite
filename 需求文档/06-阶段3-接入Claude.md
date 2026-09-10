# 阶段 3：接入 DeepSeek LLM

> 1.0.2：供应商为 DeepSeek，不再使用 Claude。闸门与 JSON 协议不变。完整接口与 CORS 见 `1.0.2.txt`。

## 目标

用户自备 DeepSeek API Key，用对话补齐偏好，模型输出 JSON，前端抽出并预览，**人点确认后才渲染地图**。

## 1. API Key 输入

页面不要顶栏大表单。放进输入条「+」菜单，或抽屉标题右侧齿轮（见 `1.0.1.txt`）。

- DeepSeek API Key：`type=password`，placeholder `sk-...`
- 模型名：默认 `deepseek-chat`（可改为 `deepseek-reasoner`）
- 按钮：保存到内存 / 清除
- 说明文案：「Key 只留在这次页面内存，刷新即丢失，不会上传到本站服务器。GitHub Pages 托管页也不会替你保管 Key。」
- 未填 Key 第一次点发送：在抽屉内弹出轻量设置层，不要跳页。

行为：

- 保存在模块变量 `let apiKey = ''`
- **禁止** `localStorage` / `sessionStorage` / Cookie / 写文件
- 未填 Key 点发送：助手提示「先填入 DeepSeek API Key，或先点【加载示例路线】看地图效果」
- 不要在 UI 回显完整 Key

## 2. 调用约定

`js/deepseek.js`：

```
chat({ apiKey, model, history, userText }) → { text, raw }
```

- `history` 为已发生的 user/assistant 文本
- `system` 作为 messages 第一条 `{role:'system'}`，内容为需求文档 `02` 的人设 + `08` 的 JSON 契约
- `POST https://api.deepseek.com/chat/completions`，`Authorization: Bearer <key>`
- 若存在同源 `/api/chat` 则优先走反代（见 1.0.2 CORS）
- 禁止 `api.anthropic.com` 与 `anthropic-*` 头

当核心槽位已齐、准备让模型出路线时，在 **当次 user 消息末尾** 追加一段前端注入的约束（用户看不见或用浅色系统提示）：

```
[系统约束] 核心偏好已齐，请输出符合契约的唯一 json 代码块。不要问新问题。
```

前端可用简单规则判断「核心槽位是否齐」：扫描对话里是否已出现城市、方式、时长、起点。做不好也没关系，但 **只要 parse 到合法 JSON，就必须走闸门，禁止直接画图**。

## 3. 追问

模型负责追问。前端不要做成 6 个输入框。发送键提交。

可选：3 条示例 chip，点击填入输入框并发送或仅填入：

- 我想周末下午，在市区骑行 2 小时，避开网红打卡点，想看老厂房和老街区，路尽量平缓。
- 傍晚沿河边慢慢走，想安静，不想人挤人。
- 公园里轻越野一下，1.5 小时，别太累。

## 4. 抽取 JSON

`js/parse-route.js`：

1. 用正则从助手全文取 **最后一个** ```json ... ``` 或 ``` ... ``` 块。
2. `JSON.parse`，try/catch。
3. 校验必填字段（见 `08`）。缺 lat/lng、stops 不是数组、stops 长度 < 2 或 > 12，视为失败。
4. 返回 `{ ok: true, route }` 或 `{ ok: false, error }`。

解析失败：聊天里明确说失败原因（「没有找到 JSON」/「JSON 格式损坏」/「缺经纬度」），提供可再点的【重新生成】（若无 Key 则隐藏）。

## 5. 人工闸门（强制）

解析成功后：

1. 状态进入 `preview`
2. 聊天区路线预览卡：标题、主题、城市、方式、时长、距离、点位列表（序号+名）
3. 两个按钮：**【确认并画到地图】** **【重新生成】**
4. **此时不得调用 `renderRoute`**（已确认的旧路线可保留，新路线不上图）
5. 确认：`renderRoute(route)`，按钮区改为「已画到地图」；抽屉收到 half 或 collapsed，让用户看见路线。`fitBounds` 加抽屉 padding。
6. 重新生成：发一条隐藏/可见的 user：`请基于同一偏好重新生成一条不同的路线，避开上一轮的点位，仍输出唯一 json 代码块。`

预览期间用户若手动输入修改意见，当作新的 user 消息，带上「上一轮 JSON 标题与点名」。

## 6. 忙态与错误

- 请求中：发送按钮 disabled，显示「在想路线…」
- 网络/401/403：提示 Key 是否有效、是否开通 DeepSeek API
- CORS 失败：提示改用本地 `python3 server.py` 同源反代；禁止公共 CORS 代理。细节见 `1.0.2.txt`

## 7. 与阶段 2 共存

【加载示例路线】保留。文案标明这是离线示例，不耗 Token。示例路线仍可直接上图（可信数据），与模型路线的闸门策略不同，这是有意为之。
