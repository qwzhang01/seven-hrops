/**
 * 天气服务 - 支持 OpenWeather 和和风天气 (QWeather)
 * 和风天气在国内访问更稳定，免费版 1000 次/天够用
 * https://dev.qweather.com/
 */

import fetch from 'node-fetch';
import config from '../config.js';

class WeatherService {
  constructor() {
    this.cache = null;
    this.cacheTime = 0;
    this.CACHE_DURATION = 30 * 60 * 1000; // 30分钟缓存
    this.TIMEOUT = 8000; // 8秒超时
  }

  /**
   * 带超时的 fetch 封装
   */
  async _fetchWithTimeout(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.TIMEOUT);
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
   * 获取当前天气（自动选择 provider）
   */
  async getCurrentWeather() {
    // 检查缓存
    if (this.cache && Date.now() - this.cacheTime < this.CACHE_DURATION) {
      return this.cache;
    }

    // 优先使用和风天气（国内访问更稳定）
    if (config.qweatherApiKey) {
      try {
        const weather = await this._getQWeather();
        this.cache = weather;
        this.cacheTime = Date.now();
        console.log(`[Weather] 和风天气: ${weather.city} ${weather.description} ${weather.temp}°C`);
        return weather;
      } catch (err) {
        console.warn('[Weather] 和风天气失败，尝试 OpenWeather:', err.message);
        // fallback 到 OpenWeather
      }
    }

    // 使用 OpenWeather（带超时）
    if (config.openweatherApiKey) {
      try {
        const res = await this._fetchWithTimeout(
          `https://api.openweathermap.org/data/2.5/weather?q=${config.weatherCity}&appid=${config.openweatherApiKey}&units=metric&lang=zh_cn`
        );
        const data = await res.json();

        const weather = {
          city: data.name,
          temp: Math.round(data.main.temp),
          feels_like: Math.round(data.main.feels_like),
          humidity: data.main.humidity,
          description: data.weather[0]?.description || '未知',
          icon: data.weather[0]?.icon || '',
          condition: this._mapCondition(data.weather[0]?.main),
          wind_speed: data.wind?.speed || 0,
        };

        this.cache = weather;
        this.cacheTime = Date.now();
        console.log(`[Weather] OpenWeather: ${weather.city} ${weather.description} ${weather.temp}°C`);
        return weather;
      } catch (err) {
        console.error('[Weather] OpenWeather 获取失败:', err.message);
        // fallback 到 mock
      }
    }

    // 两个 API 都失败，返回模拟数据
    console.warn('[Weather] 所有天气 API 均失败，使用模拟数据');
    const mock = this._mockWeather();
    this.cache = mock;
    this.cacheTime = Date.now();
    return mock;
  }

  /**
   * 调用和风天气 API
   */
  async _getQWeather() {
    // Step 1: 根据城市名获取 location ID
    const geoUrl = `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(config.weatherCity)}&key=${config.qweatherApiKey}&lang=zh`;
    const geoRes = await this._fetchWithTimeout(geoUrl);
    const geoData = await geoRes.json();

    if (geoData.code !== '200' || !geoData.location?.[0]?.id) {
      throw new Error(`和风天气城市查询失败: ${geoData.message || geoData.code}`);
    }
    const locationId = geoData.location[0].id;
    const cityName = geoData.location[0].name;

    // Step 2: 获取实时天气
    const weatherUrl = `https://devapi.qweather.com/v7/weather/now?location=${locationId}&key=${config.qweatherApiKey}&lang=zh`;
    const weatherRes = await this._fetchWithTimeout(weatherUrl);
    const weatherData = await weatherRes.json();

    if (weatherData.code !== '200') {
      throw new Error(`和风天气查询失败: ${weatherData.message || weatherData.code}`);
    }

    const now = weatherData.now;
    return {
      city: cityName,
      temp: parseInt(now.temp),
      feels_like: parseInt(now.feelsLike || now.temp),
      humidity: parseInt(now.humidity || '60'),
      description: now.text,
      icon: now.icon || '',
      condition: this._mapQWeatherCondition(now.text),
      wind_speed: parseInt(now.windSpeed || '0'),
    };
  }

  /**
   * 映射 OpenWeather 天气条件到简单分类
   */
  _mapCondition(main) {
    const map = {
      'Clear': 'sunny',
      'Clouds': 'cloudy',
      'Rain': 'rainy',
      'Drizzle': 'rainy',
      'Snow': 'snowy',
      'Thunderstorm': 'stormy',
      'Mist': 'foggy',
      'Fog': 'foggy',
    };
    return map[main] || 'cloudy';
  }

  /**
   * 映射和风天气中文描述到简单分类
   */
  _mapQWeatherCondition(text) {
    if (!text) return 'cloudy';
    const t = text.trim();
    // 晴
    if (t === '晴') return 'sunny';
    // 云
    if (['多云', '阴', '少云', '晴间多云'].includes(t)) return 'cloudy';
    // 雨
    if (['小雨', '中雨', '大雨', '暴雨', '小到中雨', '中到大雨', '大到暴雨', '雨'].includes(t)) return 'rainy';
    // 雪
    if (t.includes('雪')) return 'snowy';
    // 雷暴
    if (t.includes('雷') || t.includes('暴')) return 'stormy';
    // 雾 / 霾
    if (t.includes('雾') || t.includes('霾')) return 'foggy';
    return 'cloudy';
  }

  /**
   * 无 API key 时的模拟天气
   */
  _mockWeather() {
    return {
      city: config.weatherCity,
      temp: 22,
      feels_like: 21,
      humidity: 60,
      description: '多云',
      icon: '03d',
      condition: 'cloudy',
      wind_speed: 3,
    };
  }
}

export default new WeatherService();
