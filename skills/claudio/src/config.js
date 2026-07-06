import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

export default {
  // 路径
  rootDir: ROOT_DIR,
  userDir: join(ROOT_DIR, 'user'),
  promptsDir: join(ROOT_DIR, 'prompts'),
  dataDir: join(ROOT_DIR, 'data'),
  cacheDir: join(ROOT_DIR, 'data', 'cache'),
  publicDir: join(ROOT_DIR, 'public'),

  // LLM 配置（支持 anthropic / openai 两种协议）
  llmProtocol: process.env.LLM_PROTOCOL || 'anthropic',
  llmApiKey: process.env.LLM_API_KEY || '',
  llmBaseUrl: process.env.LLM_BASE_URL || '',
  llmModel: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',

  // 网易云音乐 API（本地 NeteaseCloudMusicApi 服务）
  neteaseApiBase: process.env.NETEASE_API_BASE || 'http://localhost:3001',
  neteaseApiPort: parseInt(process.env.NETEASE_API_PORT) || 3001,
  // 登录凭证（可选，部分接口需要）
  neteasePhone: process.env.NETEASE_PHONE || '',
  neteasePassword: process.env.NETEASE_PASSWORD || '',

  // Fish TTS
  fishApiKey: process.env.FISH_API_KEY || '',
  fishVoiceId: process.env.FISH_VOICE_ID || '',

  // 天气（优先使用和风天气，备选 OpenWeather）
  qweatherApiKey: process.env.QWEATHER_API_KEY || '',
  openweatherApiKey: process.env.OPENWEATHER_API_KEY || '',
  weatherCity: process.env.WEATHER_CITY || 'Shanghai',

  // 服务器
  port: parseInt(process.env.PORT || '3000'),
  host: process.env.HOST || 'localhost',
};
