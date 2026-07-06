/**
 * MusicAgent - PWA 前端应用
 */

class MusicAgentApp {
  constructor() {
    // 状态
    this.queue = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isTransitioning = false; // 是否正在过渡播报
    this.transitionTimeout = null; // 过渡定时器
    this.ttsEnabled = false; // TTS 语音播报是否启用
    this.ws = null;
    this.wsReconnectTimer = null;

    // TTS 音频元素
    this.ttsAudio = new Audio();

    // DOM 元素
    this.audio = document.getElementById('audioPlayer');
    this.djMessage = document.getElementById('djMessage');
    this.songTitle = document.getElementById('songTitle');
    this.songArtist = document.getElementById('songArtist');
    this.albumArt = document.getElementById('albumArt');
    this.progressFill = document.getElementById('progressFill');
    this.currentTime = document.getElementById('currentTime');
    this.totalTime = document.getElementById('totalTime');
    this.btnPlay = document.getElementById('btnPlay');
    this.chatInput = document.getElementById('chatInput');
    this.connStatus = document.getElementById('connStatus');
    this.queueList = document.getElementById('queueList');

    this._bindEvents();
    this._connectWebSocket();
    this._loadStats();
    this._loadSettings(); // 加载 TTS 等设置
    this._registerServiceWorker();
  }

  // === 事件绑定 ===
  _bindEvents() {
    // 播放控制
    this.btnPlay.addEventListener('click', () => this.togglePlay());
    document.getElementById('btnPrev').addEventListener('click', () => this.playPrev());
    document.getElementById('btnNext').addEventListener('click', () => this.playNext());

    // 音频事件
    this.audio.addEventListener('timeupdate', () => this._updateProgress());
    this.audio.addEventListener('ended', () => this.playNext());
    this.audio.addEventListener('play', () => this._onPlay());
    this.audio.addEventListener('pause', () => this._onPause());

    // 进度条点击
    document.querySelector('.progress-bar').addEventListener('click', (e) => {
      const rect = e.target.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      if (this.audio.duration) {
        this.audio.currentTime = percent * this.audio.duration;
      }
    });

    // 聊天输入
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this._sendMessage();
    });
    document.getElementById('btnSend').addEventListener('click', () => this._sendMessage());

    // 导航切换
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => this._switchView(item.dataset.view));
    });

    // 保存品味
    document.getElementById('btnSaveTaste').addEventListener('click', () => this._saveTaste());
  }

  // === WebSocket ===
  _connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/stream`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WS] 已连接');
        this.connStatus.classList.add('connected');
        this.connStatus.title = '已连接';
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this._handleWSMessage(data);
      };

      this.ws.onclose = () => {
        console.log('[WS] 连接关闭');
        this.connStatus.classList.remove('connected');
        // 重连
        this.wsReconnectTimer = setTimeout(() => this._connectWebSocket(), 3000);
      };

      this.ws.onerror = (err) => {
        console.error('[WS] 错误:', err);
      };
    } catch (err) {
      console.error('[WS] 连接失败:', err);
      this.wsReconnectTimer = setTimeout(() => this._connectWebSocket(), 5000);
    }
  }

  _handleWSMessage(data) {
    switch (data.type) {
      case 'response':
        this._handleAIResponse(data.data);
        break;
      case 'proactive':
        this._handleProactive(data);
        break;
      case 'pong':
        break;
      default:
        console.log('[WS] 未知消息:', data);
    }
  }

  // === 消息发送 ===
  async _sendMessage() {
    const message = this.chatInput.value.trim();
    if (!message) return;

    this.chatInput.value = '';
    this._showDJThinking();

    // 优先通过 WebSocket 发送
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat', message }));
    } else {
      // 降级为 HTTP
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });
        const result = await res.json();
        if (result.status === 'ok') {
          this._handleAIResponse(result.data);
        }
      } catch (err) {
        this._showDJMessage('网络似乎有点问题，稍后再试试？');
      }
    }
  }

  // === AI 响应处理 ===
  _handleAIResponse(data) {
    // 显示 DJ 播报
    if (data.say) {
      this._showDJMessage(data.say);
      // 如果 TTS 已启用，自动播放语音
      this._playTTSAudio(data.say);
    }

    // 处理动作
    if (data.action === 'pause') {
      this.audio.pause();
      return;
    }
    if (data.action === 'next') {
      this.playNext();
      return;
    }

    // 添加歌曲到队列
    if (data.songs && data.songs.length > 0) {
      data.songs.forEach(song => {
        if (song.url) {
          this.queue.push(song);
        }
      });
      this._renderQueue();

      // 如果当前没在播放，自动开始
      if (!this.isPlaying && this.queue.length > 0) {
        this.currentIndex = this.queue.length - data.songs.filter(s => s.url).length;
        this._playCurrent();
      }
    } else if (data.play && data.play.length > 0 && (!data.songs || data.songs.length === 0)) {
      // Claude 推荐了但没有获取到 URL，显示推荐列表
      const songList = data.play.map((s, i) => `${i + 1}. ${s}`).join('\n');
      this._appendDJMessage(`\n推荐列表：\n${songList}`);
    }
  }

  _handleProactive(data) {
    // 主动推荐
    if (data.data) {
      this._handleAIResponse(data.data);
    }
  }

  // === 播放控制 ===
  togglePlay() {
    if (this.isPlaying) {
      this.audio.pause();
    } else {
      if (this.currentIndex >= 0 && this.queue[this.currentIndex]) {
        this.audio.play();
      } else if (this.queue.length > 0) {
        this.currentIndex = 0;
        this._playCurrent();
      }
    }
  }

  playNext() {
    // 防止快速点击
    if (this.isTransitioning) {
      console.log('[Player] 正在过渡中，忽略此次点击');
      return;
    }

    if (this.currentIndex < this.queue.length - 1) {
      // 获取当前歌曲和下一首歌曲信息
      const currentSong = this.queue[this.currentIndex];
      const nextIndex = this.currentIndex + 1;
      const nextSong = this.queue[nextIndex];

      if (currentSong && nextSong) {
        // 设置过渡锁
        this.isTransitioning = true;
        this.currentIndex = nextIndex;

        // 先显示简单过渡词
        this._showDJMessage(`下一首：${nextSong.name} - ${nextSong.artist}`);

        // 异步获取 LLM 生成的过渡播报，然后 TTS 播放
        this._getTransition(currentSong, nextSong).then(async (transitionText) => {
          if (transitionText) {
            this._showDJMessage(transitionText);
            // 用 TTS 播放过渡播报，播完后再播放下一首歌
            const ttsPlayed = await this._playTTSAndWait(transitionText);
            if (ttsPlayed) {
              // TTS 播完了，直接播下一首
              this.isTransitioning = false;
              this._playCurrent();
              return;
            }
          }
          // TTS 未启用或失败，延迟一下再播放
          this.transitionTimeout = setTimeout(() => {
            this.isTransitioning = false;
            this._playCurrent();
          }, 1500);
        }).catch(() => {
          // 出错时也要保证能播放下一首
          this.transitionTimeout = setTimeout(() => {
            this.isTransitioning = false;
            this._playCurrent();
          }, 1500);
        });
      }
    } else {
      // 队列播完，尝试获取新的推荐
      this._showDJMessage('队列播放完毕 🎵 想听什么新的吗？');
      this._requestNewRecommendation();
    }
  }

  playPrev() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this._playCurrent();
    }
  }

  /**
   * 获取歌曲过渡播报
   */
  async _getTransition(currentSong, nextSong) {
    try {
      const res = await fetch('/api/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSong: {
            name: currentSong.name,
            artist: currentSong.artist
          },
          nextSong: {
            name: nextSong.name,
            artist: nextSong.artist
          }
        }),
      });
      const result = await res.json();
      if (result.status === 'ok' && result.data?.say) {
        return result.data.say;
      }
    } catch (err) {
      console.error('获取过渡播报失败:', err);
    }
    return null;
  }

  /**
   * 请求新的推荐（当队列播完时）
   */
  async _requestNewRecommendation() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'chat',
        message: '队列播完了，再来几首吧'
      }));
    } else {
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: '队列播完了，再来几首吧' }),
        });
        const result = await res.json();
        if (result.status === 'ok') {
          this._handleAIResponse(result.data);
        }
      } catch (err) {
        console.error('请求新推荐失败:', err);
      }
    }
  }

  /**
   * 调用 TTS API 并播放语音（不等待播完）
   * @param {string} text - 要转换的文本
   */
  async _playTTSAudio(text) {
    if (!this.ttsEnabled || !text) {
      console.log(`[TTS] 跳过: ttsEnabled=${this.ttsEnabled}, text=${!!text}`);
      return;
    }

    try {
      console.log(`[TTS] 正在合成: "${text.slice(0, 50)}..."`);
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        const audioBlob = await res.blob();
        console.log(`[TTS] 收到音频: ${(audioBlob.size / 1024).toFixed(1)}KB`);
        const audioUrl = URL.createObjectURL(audioBlob);
        this.ttsAudio.src = audioUrl;
        await this.ttsAudio.play();
        console.log('[TTS] ▶ 开始播放');
      } else {
        const errText = await res.text();
        console.warn(`[TTS] API 返回 ${res.status}:`, errText);
      }
    } catch (err) {
      console.error('[TTS] 播放失败:', err);
    }
  }

  /**
   * 调用 TTS API 并等待播放完成
   * @param {string} text - 要转换的文本
   * @returns {Promise<boolean>} - 是否成功播放
   */
  async _playTTSAndWait(text) {
    if (!this.ttsEnabled || !text) {
      console.log(`[TTS] 跳过等待播放: ttsEnabled=${this.ttsEnabled}, text=${!!text}`);
      return false;
    }

    try {
      console.log(`[TTS] 正在合成(等待模式): "${text.slice(0, 50)}..."`);
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        const audioBlob = await res.blob();
        console.log(`[TTS] 收到音频: ${(audioBlob.size / 1024).toFixed(1)}KB`);
        const audioUrl = URL.createObjectURL(audioBlob);
        this.ttsAudio.src = audioUrl;

        return new Promise((resolve) => {
          this.ttsAudio.onended = () => {
            console.log('[TTS] ✅ 播放完成');
            URL.revokeObjectURL(audioUrl);
            resolve(true);
          };
          this.ttsAudio.onerror = (err) => {
            console.error('[TTS] 播放出错:', err);
            URL.revokeObjectURL(audioUrl);
            resolve(false);
          };
          this.ttsAudio.play().then(() => {
            console.log('[TTS] ▶ 开始播放（等待完成）');
          }).catch((err) => {
            console.error('[TTS] 无法播放:', err);
            resolve(false);
          });
        });
      } else {
        const errText = await res.text();
        console.warn(`[TTS] API 返回 ${res.status}:`, errText);
        return false;
      }
    } catch (err) {
      console.error('[TTS] 合成/播放失败:', err);
      return false;
    }
  }

  _playCurrent() {
    const song = this.queue[this.currentIndex];
    if (!song || !song.url) return;

    // 清除过渡定时器（如果存在）
    if (this.transitionTimeout) {
      clearTimeout(this.transitionTimeout);
      this.transitionTimeout = null;
    }
    this.isTransitioning = false;

    this.audio.src = song.url;
    this.audio.play().catch(err => {
      console.error('播放失败:', err);
      this._showDJMessage('这首歌暂时无法播放，试试下一首？');
    });

    this.songTitle.textContent = song.name || '未知歌曲';
    this.songArtist.textContent = song.artist || '未知艺术家';

    // 更新队列高亮
    this._renderQueue();

    // 记录播放
    this._reportPlay(song);
  }

  _onPlay() {
    this.isPlaying = true;
    this.btnPlay.textContent = '⏸';
    this.albumArt.classList.add('playing');
  }

  _onPause() {
    this.isPlaying = false;
    this.btnPlay.textContent = '▶';
    this.albumArt.classList.remove('playing');
  }

  _updateProgress() {
    if (this.audio.duration) {
      const percent = (this.audio.currentTime / this.audio.duration) * 100;
      this.progressFill.style.width = `${percent}%`;
      this.currentTime.textContent = this._formatTime(this.audio.currentTime);
      this.totalTime.textContent = this._formatTime(this.audio.duration);
    }
  }

  _formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  // === UI 更新 ===
  _showDJMessage(text) {
    this.djMessage.innerHTML = `<p>${text}</p>`;
  }

  _appendDJMessage(text) {
    this.djMessage.innerHTML += `<p style="white-space:pre-line;font-size:13px;color:var(--text-muted)">${text}</p>`;
  }

  _showDJThinking() {
    this.djMessage.innerHTML = `
      <p>思考中 <span class="loading-dots"><span></span><span></span><span></span></span></p>
    `;
  }

  _renderQueue() {
    if (this.queue.length === 0) {
      this.queueList.innerHTML = '<div class="empty-state">还没有歌曲，和 AI DJ 聊聊吧</div>';
      return;
    }

    this.queueList.innerHTML = this.queue.map((song, i) => `
      <div class="queue-item ${i === this.currentIndex ? 'playing' : ''}" data-index="${i}">
        <div class="queue-item-index">${i === this.currentIndex ? '♪' : i + 1}</div>
        <div class="queue-item-info">
          <div class="queue-item-name">${song.name}</div>
          <div class="queue-item-artist">${song.artist}</div>
        </div>
      </div>
    `).join('');

    // 点击队列项播放
    this.queueList.querySelectorAll('.queue-item').forEach(item => {
      item.addEventListener('click', () => {
        this.currentIndex = parseInt(item.dataset.index);
        this._playCurrent();
      });
    });
  }

  // === 视图切换 ===
  _switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    document.getElementById(`view${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`).classList.add('active');
    document.querySelector(`[data-view="${viewName}"]`).classList.add('active');

    // 切换到 profile 时加载数据
    if (viewName === 'profile') this._loadStats();
    if (viewName === 'settings') {
      this._loadTaste();
      this._loadSettings(); // 重新加载设置（确保同步）
    }
  }

  // === 数据加载 ===
  async _loadStats() {
    try {
      const res = await fetch('/api/now');
      const data = await res.json();
      if (data.status === 'ok') {
        document.getElementById('statToday').textContent = data.stats?.todayCount || 0;
        document.getElementById('statTotal').textContent = data.stats?.totalCount || 0;

        // 加载最爱艺术家
        if (data.stats?.topArtists?.length > 0) {
          document.getElementById('artistsList').innerHTML = data.stats.topArtists
            .map(a => `<div class="artist-item"><span>${a.artist}</span><span style="color:var(--accent)">${a.count} 次</span></div>`)
            .join('');
        }
      }

      // 加载历史
      const histRes = await fetch('/api/history?limit=10');
      const histData = await histRes.json();
      if (histData.status === 'ok' && histData.plays?.length > 0) {
        document.getElementById('historyList').innerHTML = histData.plays
          .map(p => `
            <div class="history-item">
              <div>
                <div class="history-item-name">${p.song_name}</div>
                <div style="font-size:12px;color:var(--text-muted)">${p.artist || ''}</div>
              </div>
              <span class="history-item-time">${new Date(p.played_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          `)
          .join('');
      }
    } catch (err) {
      console.error('加载统计失败:', err);
    }
  }

  async _loadTaste() {
    try {
      const res = await fetch('/api/taste');
      const data = await res.json();
      if (data.status === 'ok') {
        document.getElementById('tasteEditor').value = data.taste;
      }
    } catch (err) {
      console.error('加载品味失败:', err);
    }
  }

  /**
   * 加载设置（TTS 开关等）
   */
  _loadSettings() {
    const ttsEnabled = localStorage.getItem('musicagent_tts_enabled');
    this.ttsEnabled = ttsEnabled === 'true';

    const toggleEl = document.getElementById('toggleTTS');
    if (toggleEl) {
      toggleEl.checked = this.ttsEnabled;

      // 只绑定一次事件监听
      if (!this._ttsListenerBound) {
        this._ttsListenerBound = true;
        toggleEl.addEventListener('change', (e) => {
          this.ttsEnabled = e.target.checked;
          localStorage.setItem('musicagent_tts_enabled', this.ttsEnabled.toString());
          console.log(`[TTS] 语音播报已${this.ttsEnabled ? '启用 ✅' : '禁用 ❌'}`);
        });
      }
    }

    console.log(`[TTS] 当前状态: ${this.ttsEnabled ? '已启用' : '未启用'}`);
  }

  async _saveTaste() {
    try {
      const taste = document.getElementById('tasteEditor').value;
      const res = await fetch('/api/taste', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taste }),
      });
      const data = await res.json();
      if (data.status === 'ok') {
        this._showDJMessage('品味档案已更新！我会记住你的新偏好 ✨');
        this._switchView('player');
      }
    } catch (err) {
      console.error('保存品味失败:', err);
    }
  }

  // === 播放上报 ===
  _reportPlay(song) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'play_event',
        song: {
          id: song.id,
          name: song.name,
          artist: song.artist,
          duration: song.duration || 0,
          skipped: false,
        },
      }));
    }
  }

  // === Service Worker ===
  _registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('[SW] 注册成功'))
        .catch(err => console.error('[SW] 注册失败:', err));
    }
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  window.app = new MusicAgentApp();
});
