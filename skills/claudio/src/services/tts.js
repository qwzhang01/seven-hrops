/**
 * TTS 服务 - Edge TTS（微软免费语音合成）
 * 将 DJ 播报词转为语音，无需 API Key，完全免费
 */

import { EdgeTTS } from 'node-edge-tts';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import config from '../config.js';

class TTSService {
  constructor() {
    this.cacheDir = join(config.cacheDir, 'tts');
    this._ensureCacheDir();

    // Edge TTS 语音配置
    // 中文女声推荐: zh-CN-XiaoyiNeural, zh-CN-XiaoxiaoNeural
    // 中文男声推荐: zh-CN-YunxiNeural, zh-CN-YunjianNeural
    this.voice = process.env.EDGE_TTS_VOICE || 'zh-CN-XiaoxiaoNeural';
    this.rate = process.env.EDGE_TTS_RATE || '+10%';  // 语速稍快，更像电台 DJ
    this.pitch = process.env.EDGE_TTS_PITCH || 'default';
    this.volume = process.env.EDGE_TTS_VOLUME || 'default';

    console.log(`[TTS] Edge TTS 已初始化 | 语音: ${this.voice} | 语速: ${this.rate}`);
  }

  _ensureCacheDir() {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 文字转语音
   * @param {string} text - 要转换的文字
   * @returns {Buffer|null} - 音频数据（MP3）
   */
  async synthesize(text) {
    if (!text || text.trim().length === 0) return null;

    // 清理文本：去掉 emoji 和特殊符号（Edge TTS 对这些处理不好）
    const cleanText = this._cleanText(text);
    if (!cleanText) return null;

    // 检查缓存
    const cacheKey = createHash('md5').update(cleanText).digest('hex');
    const cachePath = join(this.cacheDir, `${cacheKey}.mp3`);

    if (existsSync(cachePath)) {
      console.log(`[TTS] 命中缓存: ${cleanText.slice(0, 30)}...`);
      return readFileSync(cachePath);
    }

    try {
      console.log(`[TTS] 合成中: "${cleanText.slice(0, 50)}${cleanText.length > 50 ? '...' : ''}"`);
      const startTime = Date.now();

      const tts = new EdgeTTS({
        voice: this.voice,
        lang: 'zh-CN',
        outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        pitch: this.pitch,
        rate: this.rate,
        volume: this.volume,
        timeout: 15000,
      });

      // 合成到缓存文件
      await tts.ttsPromise(cleanText, cachePath);

      const elapsed = Date.now() - startTime;

      // 检查文件是否生成成功
      if (existsSync(cachePath)) {
        const buffer = readFileSync(cachePath);
        console.log(`[TTS] ✅ 合成成功 (${elapsed}ms, ${(buffer.length / 1024).toFixed(1)}KB)`);
        return buffer;
      } else {
        console.error('[TTS] 合成失败: 输出文件未生成');
        return null;
      }
    } catch (err) {
      console.error('[TTS] 合成异常:', err.message);
      // 清理可能的残留文件
      if (existsSync(cachePath)) {
        try { unlinkSync(cachePath); } catch {}
      }
      return null;
    }
  }

  /**
   * 清理文本，去掉 emoji 和不必要的特殊字符
   */
  _cleanText(text) {
    return text
      // 去掉 emoji
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '')   // 表情
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')   // 符号和象形文字
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')   // 交通和地图
      .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')   // 旗帜
      .replace(/[\u{2600}-\u{26FF}]/gu, '')      // 杂项符号
      .replace(/[\u{2700}-\u{27BF}]/gu, '')      // Dingbats
      .replace(/[\u{FE00}-\u{FE0F}]/gu, '')      // 变体选择器
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')   // 补充表情
      .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')   // 象棋等
      .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')   // 扩展 A
      .replace(/[\u{200D}]/gu, '')                // 零宽连接符
      .replace(/\s+/g, ' ')                       // 合并多余空格
      .trim();
  }

  /**
   * 获取缓存的音频文件路径
   */
  getCachedPath(text) {
    const cleanText = this._cleanText(text);
    const cacheKey = createHash('md5').update(cleanText).digest('hex');
    const cachePath = join(this.cacheDir, `${cacheKey}.mp3`);
    return existsSync(cachePath) ? cachePath : null;
  }

  /**
   * 获取可用的中文语音列表
   */
  static getAvailableVoices() {
    return [
      { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓（女，温暖）', gender: 'Female' },
      { id: 'zh-CN-XiaoyiNeural', name: '晓伊（女，活泼）', gender: 'Female' },
      { id: 'zh-CN-YunxiNeural', name: '云希（男，阳光）', gender: 'Male' },
      { id: 'zh-CN-YunjianNeural', name: '云健（男，沉稳）', gender: 'Male' },
      { id: 'zh-CN-YunyangNeural', name: '云扬（男，新闻播报）', gender: 'Male' },
      { id: 'zh-CN-liaoning-XiaobeiNeural', name: '晓北（女，东北话）', gender: 'Female' },
      { id: 'zh-TW-HsiaoChenNeural', name: '小陈（女，台湾腔）', gender: 'Female' },
    ];
  }
}

export default new TTSService();
