# 把这个 AI 音乐电台的代码讲清楚

> **写给谁**：后端工程师，想看懂一个 Agent 是怎么用代码跑起来的。
>
> **讲什么**：`claudio` 项目的每一行代码做了什么，为什么这么写。
>
> **不讲什么**：架构图、概念、术语。只讲代码。

---

## 项目一共几个文件？各自干什么？

```
claudio/
├── src/
│   ├── server.js          ← 主服务器，启动一切
│   ├── config.js          ← 读 .env 的配置
│   ├── core/
│   │   ├── router.js      ← 入口：收到输入，决定走哪条路
│   │   ├── context.js     ← 拼提示词：把6块信息合成 system prompt
│   │   ├── llm-router.js  ← 选大脑：Claude 还是 OpenAI？
│   │   ├── claude.js      ← 调 Claude API + 解析输出
│   │   ├── openai.js      ← 调 OpenAI API + 解析输出
│   │   ├── scheduler.js   ← 定时触发：6个时间点自动推歌
│   │   └── state.js       ← SQLite 数据库：存对话、播放记录、计划、偏好
│   └── services/
│       ├── music.js       ← 封装网易云音乐 API（搜歌、拿URL、歌词、推荐）
│       └── weather.js     ← 天气服务（和风天气 → OpenWeather → mock）
├── prompts/
│   └── persona.md         ← DJ 人设 + 输出 JSON 格式约定
├── user/
│   ├── taste.md           ← 用户音乐品味
│   ├── routines.md        ← 用户日常作息
│   └── mood-rules.md      ← 用户情绪规则
└── public/                ← 前端静态文件
```

**总共 12 个文件，有效代码不到 1000 行。** 下面逐个讲清楚。

---

## 1. server.js：服务器启动时做了什么？

这个文件干了 3 件事：

**① 启动网易云音乐 API 子进程**

```javascript
function startNeteaseApi() {
  const port = config.neteaseApiPort || 3001;
  const baseUrl = `http://localhost:${port}`;

  const proc = spawn('npx', ['NeteaseCloudMusicApi'], {
    env: { ...process.env, PORT: port },
    stdio: 'pipe',
  });

  // ... 日志输出 ...

  // 轮询健康检查，最多等 15 秒
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = async () => {
      try {
        const res = await fetch(`${baseUrl}/search?keywords=test&limit=1`);
        if (res.ok || res.status === 400) {
          resolve();  // 能收到 HTTP 响应，说明服务已就绪
          return;
        }
      } catch { /* 还在启动中 */ }

      if (Date.now() - startTime > 15000) {
        resolve();  // 超时也继续，只是音乐搜索可能不可用
        return;
      }
      setTimeout(check, 1000);
    };
    check();
  });
}
```

关键点：它用 `spawn` 起了一个 `npx NeteaseCloudMusicApi` 的子进程。然后用轮询的方式检查 `http://localhost:3001/search` 是否能返回 HTTP 响应——不管返回 200 还是 400，只要不是连接失败就算就绪。超时 15 秒后也继续启动服务器，只是音乐搜索功能可能不可用。

**② 注册 9 个 REST API + 1 个 WebSocket**

```javascript
// 获取当前状态
app.get('/api/now', ...)

// 与 AI DJ 对话（核心入口）
app.post('/api/chat', ...)

// 搜索歌曲
app.get('/api/search', ...)

// 获取歌曲播放 URL
app.get('/api/song/url/:id', ...)

// 读取/更新用户品味
app.get('/api/taste', ...)
app.put('/api/taste', ...)

// 获取今日计划
app.get('/api/plan/today', ...)

// 获取播放历史
app.get('/api/history', ...)

// 文字转语音
app.post('/api/tts', ...)

// 歌曲过渡播报
app.post('/api/transition', ...)
```

WebSocket 端点 `/stream` 做了两件事：
- 注册了 scheduler 的广播监听，定时任务触发时主动推送消息
- 接收客户端发来的 `chat` 和 `play_event` 消息

**③ 启动定时调度**

```javascript
(async () => {
  await startNeteaseApi();    // 先等网易云 API 就绪
  app.listen(config.port, ...);  // 启动 HTTP 服务
  scheduler.start();             // 启动定时任务
})();
```

执行顺序：网易云 API → HTTP 服务 → 定时任务。不能乱，因为定时任务触发后可能会调音乐搜索。

---

## 2. router.js：用户消息进来后怎么走？

这是整个 Agent 的入口。`handle(input)` 方法做了两步分流：

**第一步：正则匹配，识别直接的音乐指令**

```javascript
_detectMusicIntent(input) {
    const lower = input.toLowerCase();

    if (/搜索|搜|找/.test(input)) {
      const keyword = input.replace(/搜索|搜|找|歌曲|音乐/g, '').trim();
      if (keyword) return { type: 'search', keyword };
    }

    if (/播放|放一首|来首|听一下/.test(input)) {
      const keyword = input.replace(/播放|放一首|来首|听一下|听/g, '').trim();
      if (keyword) return { type: 'play', keyword };
    }

    if (/下一首|next|换一首|切歌/.test(lower)) {
      return { type: 'next' };
    }

    if (/暂停|pause|停/.test(lower)) {
      return { type: 'pause' };
    }

    return null;  // 没命中任何规则
}
```

5 个正则，覆盖 4 类操作：搜索、播放、下一首、暂停。命中了就直接走音乐服务，不调 LLM。

**第二步：没命中规则，交给 LLM 处理**

```javascript
async _handleWithClaude(input) {
    const { systemPrompt, messages } = await context.build(input);
    const response = await llm.compute(systemPrompt, messages);

    // LLM 返回了推荐歌曲 → 去音乐 API 搜歌、拿播放 URL
    if (response.play && response.play.length > 0) {
      const songsWithUrl = [];
      for (const songStr of response.play.slice(0, 5)) {
        const keyword = songStr.split(' - ')[0] || songStr;
        const results = await musicService.search(keyword, 1);
        if (results.length > 0) {
          const url = await musicService.getSongUrl(results[0].id);
          songsWithUrl.push({ ...results[0], url });
          state.addPlay(results[0].id.toString(), results[0].name, results[0].artist);
        }
      }
      response.songs = songsWithUrl;
    }

    state.addMessage('assistant', JSON.stringify(response));
    return response;
}
```

LLM 返回的 `play` 数组里是形如 `"Clair de Lune - Debussy"` 的字符串。代码取歌名部分作为关键词去网易云 API 搜索，搜索到结果后再拿播放 URL，最后把这些歌曲信息（带 URL）挂到 `response.songs` 上。

**主动推荐走同一条管道：**

```javascript
async proactiveRecommend(trigger = 'scheduled') {
    const { systemPrompt, messages } = await context.build(
      `[系统触发: ${trigger}] 请根据当前时间和环境，主动推荐适合现在听的音乐。`
    );
    const response = await llm.compute(systemPrompt, messages);
    // 后续的搜歌、获取 URL 逻辑和用户触发的 _handleWithClaude 完全一样
    ...
}
```

区别只在入口：用户触发是 `handle(input)`，定时触发是 `proactiveRecommend(trigger)`。后面的处理一模一样。

**过渡播报走特殊管道：**

```javascript
async handleTransition(currentSong, nextSong) {
    // 用专门的过渡播报提示词，不走常规的 context.build()
    const { systemPrompt, messages } = await context.buildTransitionPrompt(currentSong, nextSong);
    const response = await llm.compute(systemPrompt, messages);
    // 只需要 say 字段作为播报词
    return {
      say: response.say || `接下来播放：${nextSong.name} - ${nextSong.artist}`,
      type: 'transition'
    };
}
```

过渡播报只需要一段话来衔接两首歌，不需要推荐歌曲，所以用了专门的 `buildTransitionPrompt`，并且提示词里明确说了"只返回播报词文本，不要 JSON 格式，不超过 30 字"。

---

## 3. context.js：每次调 LLM 前，怎么拼提示词？

`build()` 方法拼了 6 块信息：

**片 1：系统提示词**（读 `prompts/persona.md` 文件）

这个文件定义了 DJ 的人设、说话风格、核心能力，以及输出必须是 JSON 格式的约定。它是整个 Agent "人格"的来源。

**片 2：用户资料**（读 `user/` 目录下的 3 个文件）

- `taste.md`：音乐品味（喜欢的风格、艺术家等）
- `routines.md`：日常作息（几点起床、工作、睡觉）
- `mood-rules.md`：情绪规则（什么天气想听什么类型的歌）

这三个文件是独立的文本文件，修改它们不需要改代码，直接编辑文件就行。

**片 3：环境注入**（当前时间 + 天气）

```javascript
_getTimeContext() {
    const now = new Date();
    const hour = now.getHours();
    // ...
    let period = '';
    if (hour >= 6 && hour < 9) period = '早晨';
    else if (hour >= 9 && hour < 12) period = '上午';
    // ...
    return { time, day, period, isWeekend, dateStr };
}
```

天气服务会返回城市、温度、体感温度、湿度、天气描述、风速等。这些信息注入到 prompt 里，让 LLM 知道"现在下雨"或"今天很热"，从而推荐合适的音乐。

**片 4：记忆检索**（从 SQLite 读最近 5 首播放记录 + 今日统计）

```javascript
const recentPlays = state.getRecentPlays(5);
const stats = state.getListeningStats();
```

最近听过什么歌、今天听了多少首——这些信息让 LLM 知道不要重复推荐。

**片 5：用户输入**（直接放在 messages 数组的最后一条）

**片 6：执行轨迹**（今日计划）

```javascript
const todayPlan = state.getTodayPlan();
const execution = todayPlan.length > 0
  ? `\n## 今日计划\n${todayPlan.map(p => `- [${p.status}] ${p.time_slot}: ${p.plan}`).join('\n')}`
  : '';
```

最终拼出来的 system prompt 长这样：

```
[persona.md 内容]

---
[taste.md 内容]

---
[routines.md 内容]

---
[mood-rules.md 内容]

---
## 当前环境
- 时间: 2026-07-06 周六 13:24 (下午)
- 是否周末: 是
- 天气: Shanghai 多云, 22°C, 体感21°C
- 天气状况: cloudy
- 湿度: 60%, 风速: 3m/s

---
## 最近播放记录
- Clair de Lune - Debussy (2026-07-06 12:30:00)
- Gymnopédie No.1 - Erik Satie (2026-07-06 12:15:00)

---
## 今日统计
- 今天播放: 8 首
- 总计播放: 42 首

---
## 今日计划
- [done] 07:00: 早间唤醒
- [pending] 18:00: 下班放松
```

messages 数组就是对话历史，最近 10 条，按时间正序排列，最后一条是当前用户输入。

---

## 4. llm-router.js + claude.js + openai.js：怎么调 LLM？

**llm-router.js 只做一件事：根据配置选大脑。**

```javascript
function getBrain() {
  const protocol = (config.llmProtocol || 'anthropic').toLowerCase();
  return protocol === 'openai' ? openaiBrain : claudeBrain;
}

export async function compute(systemPrompt, messages) {
  const brain = getBrain();
  return brain.compute(systemPrompt, messages);
}
```

读 `.env` 里的 `LLM_PROTOCOL`，`openai` 就用 OpenAI 适配器，其他一律用 Claude。业务代码只调 `llm.compute()`，不关心底层。

**claude.js：封装 Anthropic SDK 的调用细节**

构造函数里：有 `LLM_API_KEY` 就创建客户端，没有就打印警告，后面走 mock。

`compute()` 方法：调 `this.client.messages.create()`，参数是 `system`（系统提示词）+ `messages`（对话历史）。返回后调 `_parseResponse()` 解析。

`_parseResponse()` 做了 3 层容错：
1. 正则提取 JSON 部分：`text.match(/\{[\s\S]*\}/)` → 过滤 LLM 可能在 JSON 前后加的废话
2. `JSON.parse()` 用 try/catch 包裹 → 防止格式错误
3. 所有字段给默认值 → `say: parsed.say || ''`，`play: Array.isArray(parsed.play) ? parsed.play : []`

全失败了，把整段文本当 `say` 返回：`{ say: text.slice(0, 200), play: [], ... }`

**openai.js：和 claude.js 接口完全一样，内部封装不同**

区别在于 OpenAI 的消息格式：`system` 作为第一条消息放到 `messages` 数组里，而 Claude 的 `system` 是单独参数。

OpenAI 适配器多打了详细日志：请求提示词、对话历史、完整 messages 数组、返回内容、token 用量。方便调试。

两个适配器的 `_parseResponse()` 和 `_mockResponse()` 逻辑完全一样。

**mock 模式根据当前时间段返回不同模拟数据：**

```javascript
_mockResponse() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 9) return { say: '早安 ☀️ ...', play: ['Sunrise - Norah Jones', 'Morning - Beck'], ... };
    if (hour >= 9 && hour < 18) return { say: '专注时间到...', play: ['Intro - The xx', 'Awake - Tycho', 'Opus - Eric Prydz'], ... };
    if (hour >= 18 && hour < 22) return { say: '辛苦一天了...', play: ['Weightless - Marconi Union', 'Nuvole Bianche - Ludovico Einaudi'], ... };
    return { say: '夜深了...', play: ['Clair de Lune - Debussy', 'Gymnopédie No.1 - Erik Satie'], ... };
}
```

---

## 5. scheduler.js：怎么做到不需要用户说话也能主动推歌？

6 个 cron 任务，覆盖一天的关键时间点：

```javascript
start() {
    this.jobs.push(cron.schedule('0 7 * * *',    () => this._trigger('morning_wake')));     // 每天 07:00
    this.jobs.push(cron.schedule('0 9 * * 1-5',  () => this._trigger('work_start')));    // 工作日 09:00
    this.jobs.push(cron.schedule('0 12 * * *',   () => this._trigger('lunch_break')));    // 每天 12:00
    this.jobs.push(cron.schedule('0 14 * * 1-5', () => this._trigger('afternoon_start'))); // 工作日 14:00
    this.jobs.push(cron.schedule('0 18 * * 1-5', () => this._trigger('work_end')));       // 工作日 18:00
    this.jobs.push(cron.schedule('0 22 * * *',   () => this._trigger('sleep_prep')));     // 每天 22:00
}
```

`1-5` 表示周一到周五，`*` 表示每天。

触发后做什么？调 `router.proactiveRecommend(trigger)`，这和用户输入走同一条管道——一样的 context 拼装，一样的 LLM 调用，一样的搜歌拿 URL。唯一的区别是入口处加了一句 `[系统触发: morning_wake]` 来告诉 LLM 这是一个主动推荐场景。

广播机制：scheduler 维护一个 listeners 数组，WebSocket 连接时注册监听器，连接关闭时移除。触发时调用 `_broadcast()` 把消息推给所有活跃的 WebSocket 连接。

---

## 6. state.js：数据怎么存？怎么读？

4 张 SQLite 表：

**messages 表**：存对话历史。`addMessage(role, content)` 插入，`getRecentMessages(limit)` 按时间倒序取最近 N 条再反转（变成正序）。

**plays 表**：存播放记录。`addPlay(songId, songName, artist, duration, skipped)` 插入，`getRecentPlays(limit)` 取最近 N 首，`getTodayPlays()` 取今天的。

**plans 表**：存每日计划。`setPlan(date, timeSlot, plan)` 插入或替换，`getTodayPlan()` 取今天的。

**prefs 表**：键值对存偏好。`setPref(key, value)` 插入或替换，`getPref(key)` 读取（支持 JSON 反序列化）。

**统计**：`getListeningStats()` 返回今日播放数、总播放数、Top 5 艺术家。

这些数据在两个地方被读取：
- `context.build()` 里读最近播放和对话历史，注入提示词
- `server.js` 的 `/api/now`、`/api/history`、`/api/plan/today` 等接口直接读取返回给前端

写入在两个地方：
- `router.handle()` 执行完动作后，调用 `state.addMessage()` 和 `state.addPlay()`
- `server.js` 的 `/api/taste` 接口更新用户偏好时调 `state.setPref()`

---

## 7. music.js + weather.js：外部服务怎么调？挂了怎么办？

**music.js：封装网易云音乐 API 的 6 个方法**

| 方法 | 调的 API | 返回什么 |
|------|----------|----------|
| `search(keyword, limit)` | `/search?keywords=...&limit=...` | `[{id, name, artist, album, duration}]` |
| `getSongUrl(id)` | `/song/url?id=...&br=320000` | 播放 URL 字符串 |
| `getLyric(id)` | `/lyric?id=...` | `{lyric, translation}` |
| `getRecommend(songId)` | `/simi/song?id=...` | 同 search 格式的歌曲列表 |
| `getTopPlaylist(cat, limit)` | `/top/playlist?cat=...&limit=...` | `[{id, name, trackCount, playCount}]` |
| `getPlaylistDetail(id)` | `/playlist/detail?id=...` | `{name, tracks: [{id, name, artist}]}` |

所有请求都带 8 秒超时。所有 API 返回先检查 `code === 200`，不符合就返回空数组。非 JSON 响应会抛出明确错误："API 返回了非 JSON 响应，请确认 NeteaseCloudMusicApi 服务已启动"。

启动时自动调 `checkHealth()` 做健康检查——请求 `/search?keywords=test&limit=1`，成功就打印"连接正常"，失败就打印错误信息。

**weather.js：双源 fallback 天气服务**

优先级：和风天气 → OpenWeather → mock 数据

和风天气的调用分两步：先调城市查询 API 拿 location ID，再调天气查询 API 拿实时天气。两步都可能失败。

OpenWeather 是备选：一个请求搞定，用 `units=metric` 和 `lang=zh_cn`。

两个 API 都失败时返回 mock 数据：城市取配置里的 `weatherCity`，温度 22°C，多云。

30 分钟缓存——缓存有效期内直接返回，不再请求外部 API。

---

## 8. persona.md：LLM 的"人格"和输出约定从哪来？

这个文件是 LLM 行为的"源头"。它定义了：

- **身份**：私人 AI 音乐电台主持人
- **性格**：温暖但不啰嗦，有音乐品味，幽默适度
- **说话风格**：简短有力，像电台 DJ 过渡语，不啰嗦
- **核心能力**：根据时间/天气/用户状态推荐音乐、做歌曲过渡播报、记住用户喜好、主动播报
- **输出格式约定**：必须是 JSON，包含 `say`（播报词）、`play`（推荐歌曲列表）、`reason`（推荐理由）、`seque`（下一步动作）

这就是为什么 `_parseResponse()` 能期望 LLM 返回 JSON——因为 prompt 里明确要求了。也是为什么 `_parseResponse()` 要做容错——因为 LLM 不一定会遵守。

---

## 9. config.js：所有配置从哪来？

读 `.env` 文件，提供默认值。关键配置：

| 配置项 | 默认值 | 作用 |
|--------|--------|------|
| `LLM_PROTOCOL` | `anthropic` | 选 Claude 还是 OpenAI |
| `LLM_API_KEY` | 空 | LLM 的 API Key |
| `LLM_BASE_URL` | 空 | LLM 服务地址（可选，不填用官方默认） |
| `LLM_MODEL` | `claude-sonnet-4-20250514` | 使用的模型 |
| `NETEASE_API_BASE` | `http://localhost:3001` | 网易云 API 地址 |
| `QWEATHER_API_KEY` | 空 | 和风天气 Key |
| `OPENWEATHER_API_KEY` | 空 | OpenWeather Key |
| `WEATHER_CITY` | `Shanghai` | 天气查询城市 |
| `PORT` / `HOST` | `3000` / `localhost` | 服务器端口和主机 |

---

## 把整个流程串起来

用户发一条消息"来点适合下雨天的音乐"，发生了什么？

1. **HTTP 请求** → `POST /api/chat`，`message` = "来点适合下雨天的音乐"
2. **Router** → `_detectMusicIntent()` 没有匹配到任何规则（"来点适合下雨天的"不在正则里）→ 走 `_handleWithClaude()`
3. **Context** → `build()` 拼了 6 块信息：persona + taste + routines + mood-rules + 环境(时间+天气) + 记忆(播放记录+统计) + 用户输入
4. **LLM** → `llm-router.js` 选 Claude → `claude.js` 调 Anthropic API
5. **解析** → LLM 返回 JSON → `_parseResponse()` 提取出 `{say: "下雨天适合听...", play: ["Riders on the Storm - The Doors", ...], reason: "雨天推荐爵士和蓝调", seque: "continue"}`
6. **搜歌** → `play` 数组里有歌名 → 遍历每个歌名，调 `musicService.search()` 搜歌 → 搜到结果后调 `musicService.getSongUrl()` 拿播放 URL
7. **返回** → 把 `{say, play, songs(带URL), reason, seque}` 返回给前端
8. **存库** → `state.addMessage()` 存对话，`state.addPlay()` 存播放记录

如果是定时触发（比如每天 07:00），流程一样，只是入口从用户消息变成了 scheduler 的 `_trigger('morning_wake')`。

---

## 总结：这个项目做对的 7 件事

1. **启动时拉起外部服务**（网易云 API 子进程），轮询等它就绪，超时也不阻塞启动
2. **意图路由先走正则，搞不定的才扔给 LLM**，省钱省时，确定性意图 100% 可预测
3. **6 块信息拼成上下文**，每次调 LLM 前动态生成，天气变了、时间变了、播放记录变了，prompt 就变了
4. **LLM 通过适配层接入**，`llm-router.js` 20 行代码，换供应商只改配置
5. **LLM 输出必须解析+容错**，不信任格式，JSON 提取 → parse → 默认值 → 纯文本降级，4 层防线
6. **定时和用户触发共用管道**，代码不重复，行为一致
7. **每个外部服务都有降级**：LLM 没 key → mock，天气 API 挂了 → 备用源 → mock，网易云 API 挂了 → 返回空结果
