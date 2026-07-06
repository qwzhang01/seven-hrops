/**
 * OpenAI 大脑适配器
 * 调用 OpenAI 兼容 API，解析输出为 {say, play(), reason, seque}
 */

import OpenAI from 'openai';
import config from '../config.js';

class OpenAIBrain {
  constructor() {
    this.client = null;

    if (config.llmApiKey) {
      const options = {
        apiKey: config.llmApiKey,
      };
      // baseURL 选填，不填则使用 OpenAI 官方默认地址
      if (config.llmBaseUrl) {
        options.baseURL = config.llmBaseUrl;
      }
      this.client = new OpenAI(options);
      this.model = config.llmModel;

      const provider = config.llmBaseUrl ? config.llmBaseUrl : 'OpenAI 官方';
      console.log(`[OpenAI] 已初始化 | Provider: ${provider} | 模型: ${this.model}`);
    } else {
      console.warn('[OpenAI] 未配置 LLM_API_KEY，将使用模拟响应（开发模式）');
      console.warn('[OpenAI] 请检查 .env 文件中的 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL 配置');
    }
  }

  /**
   * 调用 OpenAI 获取响应
   * @param {string} systemPrompt - 系统提示词
   * @param {Array} messages - 对话消息
   * @returns {Object} - {say, play, reason, seque}
   */
  async compute(systemPrompt, messages) {
    if (!this.client) {
      console.warn('[OpenAI] 未配置 API Key，使用模拟响应');
      return this._mockResponse();
    }

    try {
      // OpenAI 的 messages 格式：system 作为第一条消息
      const openaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
      ];

      // 打印提示词日志
      console.log('\n' + '='.repeat(80));
      console.log('[OpenAI] 📤 请求提示词:');
      console.log('='.repeat(80));
      console.log('\n[系统提示词]:\n', systemPrompt);
      console.log('\n[对话历史]:');
      messages.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m.role}: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`);
      });
      console.log('\n[完整 Messages]:\n', JSON.stringify(openaiMessages, null, 2));
      console.log('='.repeat(80) + '\n');

      const startTime = Date.now();
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1024,
        messages: openaiMessages,
      });
      const endTime = Date.now();

      const text = response.choices[0]?.message?.content || '';

      // 打印返回信息日志
      console.log('\n' + '='.repeat(80));
      console.log(`[OpenAI] 📥 返回信息 (耗时: ${endTime - startTime}ms):`);
      console.log('='.repeat(80));
      console.log('\n[原始返回]:\n', text);
      console.log('\n[使用情况]:', {
        model: response.model,
        prompt_tokens: response.usage?.prompt_tokens,
        completion_tokens: response.usage?.completion_tokens,
        total_tokens: response.usage?.total_tokens,
      });
      console.log('='.repeat(80) + '\n');

      return this._parseResponse(text);
    } catch (err) {
      console.error('[OpenAI] API 调用失败:', err.message);
      console.error('[OpenAI] 错误详情:', err);
      return this._mockResponse();
    }
  }

  /**
   * 流式调用 OpenAI
   */
  async *computeStream(systemPrompt, messages) {
    if (!this.client) {
      yield { type: 'text', text: '未配置 LLM API Key' };
      return;
    }

    try {
      const openaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
      ];

      // 打印提示词日志
      console.log('\n' + '='.repeat(80));
      console.log('[OpenAI] 📤 流式请求提示词:');
      console.log('='.repeat(80));
      console.log('\n[系统提示词]:\n', systemPrompt);
      console.log('\n[对话历史]:');
      messages.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m.role}: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`);
      });
      console.log('\n[完整 Messages]:\n', JSON.stringify(openaiMessages, null, 2));
      console.log('='.repeat(80) + '\n');

      const startTime = Date.now();
      const stream = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 1024,
        messages: openaiMessages,
        stream: true,
      });

      let fullText = '';
      const endTime = Date.now();

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) {
          fullText += text;
          yield { type: 'text', text };
        }
      }

      // 打印返回信息日志
      console.log('\n' + '='.repeat(80));
      console.log(`[OpenAI] 📥 流式返回信息 (耗时: ${endTime - startTime}ms):`);
      console.log('='.repeat(80));
      console.log('\n[完整返回文本]:\n', fullText);
      console.log('='.repeat(80) + '\n');

    } catch (err) {
      console.error('[OpenAI] 流式调用失败:', err.message);
      console.error('[OpenAI] 错误详情:', err);
      yield { type: 'error', text: err.message };
    }
  }

  /**
   * 解析 OpenAI 响应为结构化数据（与 Claude 同接口）
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
   * 模拟响应（开发/测试用，与 Claude 一致）
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

export default new OpenAIBrain();
