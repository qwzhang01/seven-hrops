/**
 * Claude 大脑适配器
 * 调用 Claude API，解析输出为 {say, play(), reason, seque}
 */

import Anthropic from '@anthropic-ai/sdk';
import config from '../config.js';

class ClaudeBrain {
  constructor() {
    this.client = null;

    // 统一 LLM 配置：有 API Key 就初始化客户端
    if (config.llmApiKey) {
      const options = { apiKey: config.llmApiKey };
      // baseURL 选填，不填则使用 Anthropic 官方默认地址
      if (config.llmBaseUrl) {
        options.baseURL = config.llmBaseUrl;
      }
      this.client = new Anthropic(options);
      this.model = config.llmModel;

      const provider = config.llmBaseUrl ? config.llmBaseUrl : 'Anthropic 官方';
      console.log(`[Claude] 已初始化 | Provider: ${provider} | 模型: ${this.model}`);
    } else {
      console.warn('[Claude] 未配置 LLM_API_KEY，将使用模拟响应（开发模式）');
      console.warn('[Claude] 请检查 .env 文件中的 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL 配置');
    }
  }

  /**
   * 调用 Claude 获取响应
   * @param {string} systemPrompt - 系统提示词
   * @param {Array} messages - 对话消息
   * @returns {Object} - {say, play, reason, seque}
   */
  async compute(systemPrompt, messages) {
    if (!this.client) {
      console.warn('[Claude] 未配置 API Key，使用模拟响应');
      return this._mockResponse();
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages,
      });

      const text = response.content[0]?.text || '';
      return this._parseResponse(text);
    } catch (err) {
      console.error('[Claude] API 调用失败:', err.message);
      return this._mockResponse();
    }
  }

  /**
   * 流式调用 Claude
   */
  async *computeStream(systemPrompt, messages) {
    if (!this.client) {
      yield { type: 'text', text: '未配置 Claude API Key' };
      return;
    }

    try {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.text) {
          yield { type: 'text', text: event.delta.text };
        }
      }
    } catch (err) {
      console.error('[Claude] 流式调用失败:', err.message);
      yield { type: 'error', text: err.message };
    }
  }

  /**
   * 解析 Claude 响应为结构化数据
   */
  _parseResponse(text) {
    // 尝试提取 JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          say: parsed.say || '',
          play: Array.isArray(parsed.play) ? parsed.play : [],
          reason: parsed.reason || '',
          seque: parsed.seque || 'continue',
          raw: text,
        };
      } catch (e) {
        // JSON 解析失败，尝试更宽容的解析
      }
    }

    // 如果无法解析 JSON，将整个文本作为 say
    return {
      say: text.slice(0, 200),
      play: [],
      reason: '',
      seque: 'continue',
      raw: text,
    };
  }

  /**
   * 模拟响应（开发/测试用）
   */
  _mockResponse() {
    const hour = new Date().getHours();
    const mockResponses = {
      morning: {
        say: '早安 ☀️ 新的一天从一首轻柔的歌开始吧',
        play: ['Sunrise - Norah Jones', 'Morning - Beck'],
        reason: '早晨需要轻柔唤醒',
        seque: 'continue',
      },
      work: {
        say: '专注时间到，给你一片宁静的音乐空间 🎵',
        play: ['Intro - The xx', 'Awake - Tycho', 'Opus - Eric Prydz'],
        reason: '工作时段需要不打扰的背景音乐',
        seque: 'continue',
      },
      evening: {
        say: '辛苦一天了，来点放松的 🌙',
        play: ['Weightless - Marconi Union', 'Nuvole Bianche - Ludovico Einaudi'],
        reason: '晚间需要放松型音乐',
        seque: 'continue',
      },
      night: {
        say: '夜深了，让音乐陪你入梦 💤',
        play: ['Clair de Lune - Debussy', 'Gymnopédie No.1 - Erik Satie'],
        reason: '深夜助眠',
        seque: 'wait',
      },
    };

    if (hour >= 6 && hour < 9) return mockResponses.morning;
    if (hour >= 9 && hour < 18) return mockResponses.work;
    if (hour >= 18 && hour < 22) return mockResponses.evening;
    return mockResponses.night;
  }
}

export default new ClaudeBrain();
