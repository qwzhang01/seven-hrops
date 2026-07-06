/**
 * MusicAgent 主服务器
 * Express + WebSocket
 */

import express from 'express';
import expressWs from 'express-ws';
import cors from 'cors';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import config from './config.js';
import router from './core/router.js';
import scheduler from './core/scheduler.js';
import state from './core/state.js';
import tts from './services/tts.js';
import musicService from './services/music.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
expressWs(app);

// 中间件
app.use(cors());
app.use(express.json());
// 静态文件服务 - 使用 process.cwd() 确保路径正确
app.use(express.static(join(process.cwd(), 'public')));

// === 启动 NeteaseCloudMusicApi 子进程 ===
function startNeteaseApi() {
  const port = config.neteaseApiPort || 3001;
  const baseUrl = `http://localhost:${port}`;
  console.log(`[Netease API] 正在启动，端口 ${port}...`);

  const proc = spawn('npx', ['NeteaseCloudMusicApi'], {
    env: { ...process.env, PORT: port },
    stdio: 'pipe',
  });

  proc.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[Netease API] ${msg}`);
  });

  proc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[Netease API] ${msg}`);
  });

  proc.on('close', (code) => {
    console.warn(`[Netease API] 进程已退出，退出码: ${code}`);
  });

  // 轮询健康检查，最多等 15 秒
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${baseUrl}/search?keywords=test&limit=1`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok || res.status === 400) {
          // 能收到 HTTP 响应说明服务已就绪
          console.log(`[Netease API] 服务已就绪: ${baseUrl}`);
          resolve();
          return;
        }
      } catch {
        // 还在启动中，继续等
      }

      if (Date.now() - startTime > 15000) {
        console.warn('[Netease API] 启动超时，继续使用（音乐搜索可能不可用）');
        resolve();
        return;
      }
      setTimeout(check, 1000);
    };
    check();
  });
}

// === REST API ===

/**
 * GET /api/now - 获取当前状态（正在播放、DJ 播报等）
 */
app.get('/api/now', async (req, res) => {
  try {
    const recentPlays = state.getRecentPlays(1);
    const stats = state.getListeningStats();
    res.json({
      status: 'ok',
      nowPlaying: recentPlays[0] || null,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/chat - 与 AI DJ 对话
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: '需要 message 字段' });
    }
    const response = await router.handle(message);
    res.json({ status: 'ok', data: response });
  } catch (err) {
    console.error('[API] /api/chat 错误:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/search - 搜索歌曲
 */
app.get('/api/search', async (req, res) => {
  try {
    const { keyword, limit } = req.query;
    if (!keyword) {
      return res.status(400).json({ error: '需要 keyword 参数' });
    }
    const songs = await musicService.search(keyword, parseInt(limit) || 10);
    res.json({ status: 'ok', songs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/song/url/:id - 获取歌曲播放 URL
 */
app.get('/api/song/url/:id', async (req, res) => {
  try {
    const url = await musicService.getSongUrl(req.params.id);
    if (url) {
      res.json({ status: 'ok', url });
    } else {
      res.status(404).json({ error: '无法获取播放链接' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/taste - 获取用户品味配置
 */
app.get('/api/taste', async (req, res) => {
  try {
    const { readFileSync } = await import('fs');
    const taste = readFileSync(join(config.userDir, 'taste.md'), 'utf-8');
    res.json({ status: 'ok', taste });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/taste - 更新用户品味
 */
app.put('/api/taste', async (req, res) => {
  try {
    const { taste } = req.body;
    const { writeFileSync } = await import('fs');
    writeFileSync(join(config.userDir, 'taste.md'), taste, 'utf-8');
    res.json({ status: 'ok', message: '品味已更新' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/plan/today - 获取今日计划
 */
app.get('/api/plan/today', (req, res) => {
  try {
    const plan = state.getTodayPlan();
    res.json({ status: 'ok', plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/history - 获取播放历史
 */
app.get('/api/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const plays = state.getRecentPlays(limit);
    res.json({ status: 'ok', plays });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tts - 文字转语音
 */
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: '需要 text 字段' });
    }
    const audio = await tts.synthesize(text);
    if (audio) {
      res.set('Content-Type', 'audio/mpeg');
      res.send(audio);
    } else {
      res.status(503).json({ error: 'TTS 服务不可用' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/transition - 获取歌曲过渡播报
 */
app.post('/api/transition', async (req, res) => {
  try {
    const { currentSong, nextSong } = req.body;
    if (!currentSong || !nextSong) {
      return res.status(400).json({ error: '需要 currentSong 和 nextSong 字段' });
    }
    const response = await router.handleTransition(currentSong, nextSong);
    res.json({ status: 'ok', data: response });
  } catch (err) {
    console.error('[API] /api/transition 错误:', err);
    res.status(500).json({ error: err.message });
  }
});

// === WebSocket ===

/**
 * WS /stream - 实时通信
 */
app.ws('/stream', (ws, req) => {
  console.log('[WS] 新连接');

  // 注册 scheduler 广播监听
  const removeListener = scheduler.addListener((message) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  });

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);

      switch (data.type) {
        case 'chat': {
          const response = await router.handle(data.message);
          ws.send(JSON.stringify({ type: 'response', data: response }));
          break;
        }
        case 'play_event': {
          // 记录播放事件
          if (data.song) {
            state.addPlay(
              data.song.id || '',
              data.song.name,
              data.song.artist,
              data.song.duration || 0,
              data.song.skipped || false
            );
          }
          break;
        }
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        default:
          ws.send(JSON.stringify({ type: 'error', message: '未知消息类型' }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => {
    console.log('[WS] 连接关闭');
    removeListener();
  });
});

// === 启动服务器 ===

(async () => {
  // 先启动 NeteaseCloudMusicApi
  await startNeteaseApi();

  app.listen(config.port, config.host, () => {
    console.log(`
╔══════════════════════════════════════════╗
║       🎵 MusicAgent 已启动              ║
║                                          ║
║  地址: http://${config.host}:${config.port}          ║
║  API:  http://${config.host}:${config.port}/api      ║
║  WS:   ws://${config.host}:${config.port}/stream     ║
╚══════════════════════════════════════════╝
  `);

    // 启动定时调度
    scheduler.start();
  });
})();
