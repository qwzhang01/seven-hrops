/**
 * Context 组装器
 * 每次触发时将 6 片信息组装成完整的 prompt：
 * 1. 系统提示词 (persona.md)
 * 2. 用户资料 (user/*.md)
 * 3. 环境注入 (weather + calendar + now)
 * 4. 已检索记忆 (state.db → plays)
 * 5. 用户输入 / 工具结果
 * 6. 执行轨迹 (scheduler + webhooks)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import config from '../config.js';
import state from './state.js';
import weatherService from '../services/weather.js';

class ContextBuilder {
  constructor() {
    this.personaPath = join(config.promptsDir, 'persona.md');
    this.tastePath = join(config.userDir, 'taste.md');
    this.routinesPath = join(config.userDir, 'routines.md');
    this.moodRulesPath = join(config.userDir, 'mood-rules.md');
  }

  /**
   * 读取文件内容
   */
  _readFile(path) {
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
    return '';
  }

  /**
   * 获取当前时间上下文
   */
  _getTimeContext() {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const day = dayNames[now.getDay()];
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;

    let period = '';
    if (hour >= 6 && hour < 9) period = '早晨';
    else if (hour >= 9 && hour < 12) period = '上午';
    else if (hour >= 12 && hour < 14) period = '中午';
    else if (hour >= 14 && hour < 17) period = '下午';
    else if (hour >= 17 && hour < 19) period = '傍晚';
    else if (hour >= 19 && hour < 22) period = '晚间';
    else period = '深夜';

    return {
      time: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
      day,
      period,
      isWeekend,
      dateStr: now.toLocaleDateString('zh-CN'),
    };
  }

  /**
   * 组装完整的上下文（6 片）
   */
  async build(userInput = '', toolResults = '') {
    const timeCtx = this._getTimeContext();
    const weather = await weatherService.getCurrentWeather();
    const recentPlays = state.getRecentPlays(5);
    const recentMessages = state.getRecentMessages(10);
    const stats = state.getListeningStats();

    // 片1: 系统提示词
    const persona = this._readFile(this.personaPath);

    // 片2: 用户资料
    const taste = this._readFile(this.tastePath);
    const routines = this._readFile(this.routinesPath);
    const moodRules = this._readFile(this.moodRulesPath);

    // 片3: 环境注入
    const environment = `
## 当前环境
- 时间: ${timeCtx.dateStr} ${timeCtx.day} ${timeCtx.time} (${timeCtx.period})
- 是否周末: ${timeCtx.isWeekend ? '是' : '否'}
- 天气: ${weather.city} ${weather.description}, ${weather.temp}°C, 体感${weather.feels_like}°C
- 天气状况: ${weather.condition}
- 湿度: ${weather.humidity}%, 风速: ${weather.wind_speed}m/s
`;

    // 片4: 记忆检索
    const memory = `
## 最近播放记录
${recentPlays.length > 0
  ? recentPlays.map(p => `- ${p.song_name} - ${p.artist} (${p.played_at})${p.skipped ? ' [跳过]' : ''}`).join('\n')
  : '- 暂无播放记录'}

## 今日统计
- 今天播放: ${stats.todayCount} 首
- 总计播放: ${stats.totalCount} 首
`;

    // 片5: 用户输入 (在 messages 数组中传递)

    // 片6: 执行轨迹
    const todayPlan = state.getTodayPlan();
    const execution = todayPlan.length > 0
      ? `\n## 今日计划\n${todayPlan.map(p => `- [${p.status}] ${p.time_slot}: ${p.plan}`).join('\n')}`
      : '';

    // 组装系统提示词
    const systemPrompt = `${persona}

---
${taste}

---
${routines}

---
${moodRules}

---
${environment}

---
${memory}
${execution}`;

    // 组装对话历史
    const messages = recentMessages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // 添加当前用户输入
    if (userInput) {
      messages.push({ role: 'user', content: userInput });
    }

    if (toolResults) {
      messages.push({ role: 'user', content: `[工具结果] ${toolResults}` });
    }

    return { systemPrompt, messages };
  }

  /**
   * 构建歌曲过渡播报的提示词
   * @param {Object} currentSong - 当前播放完的歌曲 {name, artist}
   * @param {Object} nextSong - 下一首要播放的歌曲 {name, artist}
   * @returns {Object} - { systemPrompt, messages }
   */
  async buildTransitionPrompt(currentSong, nextSong) {
    const timeCtx = this._getTimeContext();
    const weather = await weatherService.getCurrentWeather();

    const transitionInstruction = `你是 MusicAgent 的电台 DJ。用户刚听完一首歌，即将播放下一首。
请生成一段简短自然的过渡播报（不超过 30 字），衔接这两首歌。
只返回播报词，不要推荐歌曲，不要解释。

当前歌曲: ${currentSong.name} - ${currentSong.artist}
下一首歌曲: ${nextSong.name} - ${nextSong.artist}
当前时间: ${timeCtx.dateStr} ${timeCtx.day} ${timeCtx.time} (${timeCtx.period})
天气: ${weather.city} ${weather.description}, ${weather.temp}°C

只返回播报词文本，不要 JSON 格式，不超过 30 字。`;

    const systemPrompt = `${this._readFile(this.personaPath)}

---

## 当前任务
生成歌曲过渡播报。只返回播报词文本，不要 JSON 格式，不超过 30 字。`;

    const messages = [
      { role: 'user', content: transitionInstruction }
    ];

    return { systemPrompt, messages };
  }
}

export default new ContextBuilder();
