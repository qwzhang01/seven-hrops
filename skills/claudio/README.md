# 🎵 MusicAgent - 你的私人 AI DJ

```

强调一下  这是个demo ，是x上看到一个女生分享的，觉得特别好，然后用claude 生成的
本来想基于demo 来一个简单的额 agent 教程，但是AI写的实在不是我想要的，先提交晚点再整理

```


> 理解你的品味习惯 → 规划音乐 → 像 DJ 那样播报

一个基于 Claude AI 的个人音乐电台 Agent，通过理解你的音乐品味、日常作息和当前环境（时间、天气、心情），在合适的时间为你推荐合适的音乐。

## ✨ 功能特性

- 🧠 **AI 大脑** - Claude 理解你的品味，智能推荐音乐
- 🎵 **网易云音乐** - 搜歌、播放、歌词、推荐
- 🎙️ **DJ 播报** - 像电台 DJ 一样在歌曲间做过渡
- ⏰ **节律调度** - 早起唤醒、工作专注、午休放松、睡前助眠
- 🌤️ **环境感知** - 根据天气、时间自动调整推荐风格
- 📱 **PWA 应用** - 可安装到手机桌面，离线可用
- 🗣️ **语音合成** - Fish Audio TTS 播报（可选）
- 📊 **品味学习** - 记录你的收听历史，不断优化推荐

## 🏗️ 架构

```
┌─────────────────────────────────────────────────┐
│  第一层：外部上下文                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │用户品味资料│  │Claude API│  │网易云音乐 API │   │
│  │taste.md  │  │  大脑    │  │search/url/   │   │
│  │routines  │  │          │  │lyric/recommend│   │
│  │playlists │  │          │  │              │   │
│  └──────────┘  └──────────┘  └──────────────┘   │
│  ┌──────────┐  ┌──────────┐                     │
│  │Fish TTS  │  │OpenWeather│                     │
│  │语音合成   │  │天气 API   │                     │
│  └──────────┘  └──────────┘                     │
└─────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────┐
│  第二层：本地大脑 (Node.js)                       │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ │
│  │router  │ │context │ │claude  │ │scheduler │ │
│  │意图分流 │ │提示词组装│ │大脑适配 │ │节律调度   │ │
│  └────────┘ └────────┘ └────────┘ └──────────┘ │
│  ┌────────┐ ┌────────┐                         │
│  │tts     │ │state.db│                         │
│  │声音管线 │ │状态记忆 │                         │
│  └────────┘ └────────┘                         │
└─────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────┐
│  第三层：Context Window (6片组成 prompt)          │
│  [系统提示词] [用户资料] [环境注入]               │
│  [记忆检索]   [用户输入] [执行轨迹]               │
└─────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────┐
│  第四层：交互表层                                 │
│  ┌─────────────────┐  ┌───────────────────────┐ │
│  │  PWA Web App    │  │   HTTP API + WS       │ │
│  │  Player/Profile │  │   /api/chat           │ │
│  │  /Settings      │  │   /api/now            │ │
│  │                 │  │   /stream (WebSocket) │ │
│  └─────────────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────────┘
```

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，填入你的 API Keys
```

**必须配置：**
- `ANTHROPIC_API_KEY` - Claude API Key（[获取](https://console.anthropic.com/)）

**可选配置：**
- `FISH_API_KEY` - Fish Audio TTS（[获取](https://fish.audio/)）
- `OPENWEATHER_API_KEY` - 天气 API（[获取](https://openweathermap.org/api)）

### 3. 启动网易云音乐 API（必须）

MusicAgent 依赖 NeteaseCloudMusicApi 来获取音乐数据：

```bash
# 方式一：全局安装并启动
npx NeteaseCloudMusicApi

# 方式二：Docker
docker run -p 3001:3000 binaryify/netease_cloud_music_api
```

确保 API 运行在 `http://localhost:3001`

### 4. 启动 MusicAgent

```bash
npm run dev
```

打开浏览器访问 `http://localhost:3000`

### 5. 个性化配置

编辑 `user/` 目录下的文件来定制你的音乐偏好：

- `user/taste.md` - 你的音乐品味描述
- `user/routines.md` - 你的日常作息
- `user/playlists.json` - 自定义播放列表
- `user/mood-rules.md` - 情绪与音乐的映射规则

## 📡 API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/chat` | 与 AI DJ 对话 |
| GET | `/api/now` | 获取当前状态 |
| GET | `/api/search?keyword=` | 搜索歌曲 |
| GET | `/api/song/url/:id` | 获取播放链接 |
| GET | `/api/taste` | 获取品味配置 |
| PUT | `/api/taste` | 更新品味 |
| GET | `/api/plan/today` | 今日计划 |
| GET | `/api/history` | 播放历史 |
| POST | `/api/tts` | 文字转语音 |
| WS | `/stream` | WebSocket 实时通信 |

## 🗣️ 对话示例

```
你: 来点适合工作的音乐
DJ: 专注模式启动 🎯 给你准备了一组不打扰思绪的纯音乐
    → Tycho - Awake
    → Nils Frahm - Says
    → Boards of Canada - Dayvan Cowboy

你: 有点累了
DJ: 辛苦了，来一首治愈的吧 🌿
    → Marconi Union - Weightless

你: 搜索 坂本龙一
DJ: 找到了这些：
    1. Merry Christmas Mr. Lawrence - 坂本龙一
    2. Energy Flow - 坂本龙一
    3. Aqua - 坂本龙一
```

## 📁 项目结构

```
music-agent/
├── public/             # PWA 前端
│   ├── index.html     # 主页面
│   ├── style.css      # 样式
│   ├── app.js         # 前端逻辑
│   ├── manifest.json  # PWA 配置
│   └── sw.js          # Service Worker
├── src/               # 后端
│   ├── server.js      # Express 服务器
│   ├── config.js      # 配置
│   ├── core/          # 核心大脑
│   │   ├── router.js  # 意图分流
│   │   ├── context.js # Prompt 组装
│   │   ├── claude.js  # Claude 适配器
│   │   ├── scheduler.js # 定时调度
│   │   └── state.js   # 状态管理(SQLite)
│   └── services/      # 外部服务
│       ├── music.js   # 网易云音乐
│       ├── weather.js # 天气
│       └── tts.js     # 语音合成
├── user/              # 用户个性化数据
│   ├── taste.md       # 音乐品味
│   ├── routines.md    # 日常作息
│   ├── playlists.json # 播放列表
│   └── mood-rules.md  # 情绪规则
├── prompts/           # AI 提示词
│   └── persona.md     # DJ 人设
├── data/              # 运行时数据
│   ├── state.db       # SQLite 数据库
│   └── cache/         # 缓存(TTS等)
├── .env.example       # 环境变量模板
├── package.json
└── README.md
```

## 🔧 开发计划

- [x] 核心架构搭建
- [x] Claude AI 集成
- [x] 网易云音乐 API 集成
- [x] PWA 播放器界面
- [x] WebSocket 实时通信
- [x] 定时调度系统
- [ ] UPnP 推送到家庭音响
- [ ] 飞书/微信消息通知
- [ ] 更智能的品味学习算法
- [ ] 多设备同步

## 📄 License

MIT
