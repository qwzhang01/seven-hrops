/**
 * 路由分流器
 * 判断用户意图：音乐相关 → ncm → 搜歌/播放
 *              自然语言 → claude → 理解意图后执行
 */

import musicService from '../services/music.js';
import llm from './llm-router.js';
import context from './context.js';
import state from './state.js';

class Router {
  constructor() {
    // 音乐相关关键词
    this.musicKeywords = [
      '播放', '放一首', '来首', '听', '换一首', '下一首',
      '搜索', '找', '推荐', '歌单', '暂停', '停止',
      'play', 'next', 'stop', 'pause', 'search',
    ];
  }

  /**
   * 路由处理用户输入
   * @param {string} input - 用户输入
   * @returns {Object} - 处理结果
   */
  async handle(input) {
    // 保存用户消息
    state.addMessage('user', input);

    // 判断是否为直接音乐指令
    const musicIntent = this._detectMusicIntent(input);

    if (musicIntent) {
      return await this._handleMusicCommand(musicIntent, input);
    }

    // 交给 Claude 处理
    return await this._handleWithClaude(input);
  }

  /**
   * 检测音乐意图
   */
  _detectMusicIntent(input) {
    const lower = input.toLowerCase();

    // 搜索歌曲
    if (/搜索|搜|找/.test(input)) {
      const keyword = input.replace(/搜索|搜|找|歌曲|音乐/g, '').trim();
      if (keyword) return { type: 'search', keyword };
    }

    // 直接播放指定歌曲
    if (/播放|放一首|来首|听一下/.test(input)) {
      const keyword = input.replace(/播放|放一首|来首|听一下|听/g, '').trim();
      if (keyword) return { type: 'play', keyword };
    }

    // 下一首
    if (/下一首|next|换一首|切歌/.test(lower)) {
      return { type: 'next' };
    }

    // 暂停
    if (/暂停|pause|停/.test(lower)) {
      return { type: 'pause' };
    }

    return null;
  }

  /**
   * 处理音乐指令
   */
  async _handleMusicCommand(intent, originalInput) {
    switch (intent.type) {
      case 'search': {
        const songs = await musicService.search(intent.keyword, 5);
        const response = {
          say: songs.length > 0
            ? `找到了这些关于"${intent.keyword}"的歌：`
            : `抱歉，没找到"${intent.keyword}"相关的歌曲`,
          play: songs.map(s => `${s.name} - ${s.artist}`),
          songs: songs, // 包含完整信息（ID等）
          reason: `用户搜索: ${intent.keyword}`,
          seque: 'wait',
        };
        state.addMessage('assistant', JSON.stringify(response));
        return response;
      }

      case 'play': {
        const songs = await musicService.search(intent.keyword, 3);
        if (songs.length > 0) {
          const url = await musicService.getSongUrl(songs[0].id);
          const response = {
            say: `正在播放：${songs[0].name} - ${songs[0].artist} 🎵`,
            play: [`${songs[0].name} - ${songs[0].artist}`],
            songs: [{ ...songs[0], url }],
            reason: `用户请求播放: ${intent.keyword}`,
            seque: 'continue',
          };
          state.addPlay(songs[0].id.toString(), songs[0].name, songs[0].artist);
          state.addMessage('assistant', JSON.stringify(response));
          return response;
        }
        return {
          say: `没找到"${intent.keyword}"，要不要换个关键词试试？`,
          play: [],
          reason: '搜索无结果',
          seque: 'ask',
        };
      }

      case 'next':
        return {
          say: '好的，切到下一首 ⏭️',
          play: [],
          action: 'next',
          seque: 'continue',
        };

      case 'pause':
        return {
          say: '已暂停 ⏸️',
          play: [],
          action: 'pause',
          seque: 'wait',
        };

      default:
        return await this._handleWithClaude(originalInput);
    }
  }

  /**
   * 交给 Claude 处理
   */
  async _handleWithClaude(input) {
    const { systemPrompt, messages } = await context.build(input);
    const response = await llm.compute(systemPrompt, messages);

    // 如果 Claude 推荐了歌曲，去搜索获取播放链接
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

  /**
   * 主动推荐（由 scheduler 调用）
   */
  async proactiveRecommend(trigger = 'scheduled') {
    const { systemPrompt, messages } = await context.build(
      `[系统触发: ${trigger}] 请根据当前时间和环境，主动推荐适合现在听的音乐。`
    );
    const response = await llm.compute(systemPrompt, messages);

    // 搜索歌曲获取URL
    if (response.play && response.play.length > 0) {
      const songsWithUrl = [];
      for (const songStr of response.play.slice(0, 5)) {
        const keyword = songStr.split(' - ')[0] || songStr;
        const results = await musicService.search(keyword, 1);
        if (results.length > 0) {
          const url = await musicService.getSongUrl(results[0].id);
          songsWithUrl.push({ ...results[0], url });
        }
      }
      response.songs = songsWithUrl;
    }

    state.addMessage('assistant', `[${trigger}] ${JSON.stringify(response)}`);
    return response;
  }

  /**
   * 处理歌曲过渡播报
   * @param {Object} currentSong - 当前播放完的歌曲 {name, artist}
   * @param {Object} nextSong - 下一首要播放的歌曲 {name, artist}
   * @returns {Object} - {say: 过渡播报词}
   */
  async handleTransition(currentSong, nextSong) {
    try {
      const { systemPrompt, messages } = await context.buildTransitionPrompt(currentSong, nextSong);
      const response = await llm.compute(systemPrompt, messages);

      // 过渡播报只需要 say 字段
      return {
        say: response.say || `接下来播放：${nextSong.name} - ${nextSong.artist}`,
        type: 'transition'
      };
    } catch (err) {
      console.error('[Router] 过渡播报生成失败:', err.message);
      // 返回一个简单的默认过渡词
      return {
        say: `下一首：${nextSong.name} - ${nextSong.artist}`,
        type: 'transition'
      };
    }
  }
}

export default new Router();
