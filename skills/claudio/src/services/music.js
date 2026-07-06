/**
 * 音乐服务 - 封装网易云音乐 API
 * 功能：搜索、获取歌曲URL、歌词、推荐
 * 依赖：本地运行的 NeteaseCloudMusicApi 服务 (http://localhost:3001)
 */

import fetch from 'node-fetch';
import config from '../config.js';

const NETEASE_API_BASE = config.neteaseApiBase || 'http://localhost:3001';
const TIMEOUT = 8000; // 8秒超时

class MusicService {
  constructor() {
    this.cookie = '';
  }

  /**
   * 带超时的 fetch 封装
   */
  async _fetchWithTimeout(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  /**
   * 安全解析 JSON，非 JSON 响应会抛出清晰错误
   */
  async _parseJson(res) {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      throw new Error(`API 返回了非 JSON 响应 (status ${res.status})，请确认 NeteaseCloudMusicApi 服务已启动。响应内容: ${text.slice(0, 100)}`);
    }
    const data = await res.json();
    return data;
  }

  /**
   * 检查 Netease API 是否可访问
   */
  async checkHealth() {
    try {
      const res = await this._fetchWithTimeout(`${NETEASE_API_BASE}/search?keywords=test&limit=1`);
      await this._parseJson(res);
      console.log(`[Music] Netease API 连接正常: ${NETEASE_API_BASE}`);
      return true;
    } catch (err) {
      console.error(`[Music] Netease API 不可访问 (${NETEASE_API_BASE}):`, err.message);
      console.error('[Music] 请确认已启动 NeteaseCloudMusicApi 服务，或检查 .env 中 NETEASE_API_BASE 配置');
      return false;
    }
  }

  /**
   * 搜索歌曲
   */
  async search(keyword, limit = 10) {
    try {
      const res = await this._fetchWithTimeout(
        `${NETEASE_API_BASE}/search?keywords=${encodeURIComponent(keyword)}&limit=${limit}`
      );
      const data = await this._parseJson(res);
      if (data.code === 200 && data.result?.songs) {
        return data.result.songs.map(song => ({
          id: song.id,
          name: song.name,
          artist: song.artists?.map(a => a.name).join('/') || '未知',
          album: song.album?.name || '未知',
          duration: song.duration,
        }));
      }
      return [];
    } catch (err) {
      console.error('[Music] 搜索失败:', err.message);
      return [];
    }
  }

  /**
   * 获取歌曲播放 URL
   */
  async getSongUrl(id) {
    try {
      const res = await this._fetchWithTimeout(
        `${NETEASE_API_BASE}/song/url?id=${id}&br=320000`
      );
      const data = await this._parseJson(res);
      if (data.code === 200 && data.data?.[0]?.url) {
        return data.data[0].url;
      }
      return null;
    } catch (err) {
      console.error('[Music] 获取URL失败:', err.message);
      return null;
    }
  }

  /**
   * 获取歌词
   */
  async getLyric(id) {
    try {
      const res = await this._fetchWithTimeout(`${NETEASE_API_BASE}/lyric?id=${id}`);
      const data = await this._parseJson(res);
      if (data.code === 200) {
        return {
          lyric: data.lrc?.lyric || '',
          translation: data.tlyric?.lyric || '',
        };
      }
      return null;
    } catch (err) {
      console.error('[Music] 获取歌词失败:', err.message);
      return null;
    }
  }

  /**
   * 获取推荐歌曲（基于歌曲ID）
   */
  async getRecommend(songId) {
    try {
      const res = await this._fetchWithTimeout(
        `${NETEASE_API_BASE}/simi/song?id=${songId}`
      );
      const data = await this._parseJson(res);
      if (data.code === 200 && data.songs) {
        return data.songs.map(song => ({
          id: song.id,
          name: song.name,
          artist: song.artists?.map(a => a.name).join('/') || '未知',
          album: song.album?.name || '未知',
        }));
      }
      return [];
    } catch (err) {
      console.error('[Music] 获取推荐失败:', err.message);
      return [];
    }
  }

  /**
   * 获取热门歌单
   */
  async getTopPlaylist(category = '全部', limit = 5) {
    try {
      const res = await this._fetchWithTimeout(
        `${NETEASE_API_BASE}/top/playlist?cat=${encodeURIComponent(category)}&limit=${limit}`
      );
      const data = await this._parseJson(res);
      if (data.code === 200 && data.playlists) {
        return data.playlists.map(p => ({
          id: p.id,
          name: p.name,
          trackCount: p.trackCount,
          playCount: p.playCount,
        }));
      }
      return [];
    } catch (err) {
      console.error('[Music] 获取歌单失败:', err.message);
      return [];
    }
  }

  /**
   * 获取歌单详情
   */
  async getPlaylistDetail(id) {
    try {
      const res = await this._fetchWithTimeout(
        `${NETEASE_API_BASE}/playlist/detail?id=${id}`
      );
      const data = await this._parseJson(res);
      if (data.code === 200 && data.playlist) {
        return {
          name: data.playlist.name,
          tracks: data.playlist.tracks?.slice(0, 20).map(t => ({
            id: t.id,
            name: t.name,
            artist: t.ar?.map(a => a.name).join('/') || '未知',
          })) || [],
        };
      }
      return null;
    } catch (err) {
      console.error('[Music] 获取歌单详情失败:', err.message);
      return null;
    }
  }
}

const musicService = new MusicService();

// 启动时自动检查 Netease API 健康状态
musicService.checkHealth();

export default musicService;
