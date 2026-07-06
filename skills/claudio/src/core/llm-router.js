/**
 * LLM 路由层
 * 根据 LLM_PROTOCOL 配置，路由到 Anthropic (Claude) 或 OpenAI 实现
 * 对外暴露统一接口：compute / computeStream
 */

import config from '../config.js';

// 直接导入两个实现（均为单例，无 API Key 时不初始化客户端，无副作用）
import claudeBrain from './claude.js';
import openaiBrain from './openai.js';

/**
 * 根据配置获取当前使用的 brain
 */
function getBrain() {
  const protocol = (config.llmProtocol || 'anthropic').toLowerCase();
  return protocol === 'openai' ? openaiBrain : claudeBrain;
}

/**
 * 调用 LLM 获取响应（统一接口）
 * @param {string} systemPrompt - 系统提示词
 * @param {Array} messages - 对话消息
 * @returns {Object} - {say, play, reason, seque}
 */
export async function compute(systemPrompt, messages) {
  const brain = getBrain();
  return brain.compute(systemPrompt, messages);
}

/**
 * 流式调用 LLM（统一接口）
 */
export async function* computeStream(systemPrompt, messages) {
  const brain = getBrain();
  yield* brain.computeStream(systemPrompt, messages);
}

export default { compute, computeStream };
