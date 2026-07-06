/**
 * 节律调度器
 * 在关键时间点触发主动推荐：
 * - 07:00 早间唤醒
 * - 09:00 工作开始
 * - 12:00 午休
 * - 14:00 下午开始
 * - 18:00 下班
 * - 22:00 睡前
 */

import cron from 'node-cron';
import router from './router.js';

class Scheduler {
  constructor() {
    this.jobs = [];
    this.listeners = []; // WebSocket 广播监听器
  }

  /**
   * 启动所有定时任务
   */
  start() {
    // 早间唤醒 07:00
    this.jobs.push(
      cron.schedule('0 7 * * *', () => this._trigger('morning_wake'))
    );

    // 工作开始 09:00
    this.jobs.push(
      cron.schedule('0 9 * * 1-5', () => this._trigger('work_start'))
    );

    // 午休 12:00
    this.jobs.push(
      cron.schedule('0 12 * * *', () => this._trigger('lunch_break'))
    );

    // 下午开始 14:00
    this.jobs.push(
      cron.schedule('0 14 * * 1-5', () => this._trigger('afternoon_start'))
    );

    // 下班 18:00
    this.jobs.push(
      cron.schedule('0 18 * * 1-5', () => this._trigger('work_end'))
    );

    // 睡前 22:00
    this.jobs.push(
      cron.schedule('0 22 * * *', () => this._trigger('sleep_prep'))
    );

    console.log('[Scheduler] ✅ 定时任务已启动 (6个时间点)');
  }

  /**
   * 触发推荐并广播
   */
  async _trigger(trigger) {
    console.log(`[Scheduler] 🔔 触发: ${trigger}`);
    try {
      const response = await router.proactiveRecommend(trigger);
      // 广播给所有 WebSocket 连接
      this._broadcast({
        type: 'proactive',
        trigger,
        data: response,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[Scheduler] 触发失败 (${trigger}):`, err.message);
    }
  }

  /**
   * 注册 WebSocket 广播监听
   */
  addListener(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  /**
   * 广播消息给所有监听者
   */
  _broadcast(message) {
    this.listeners.forEach(listener => {
      try {
        listener(message);
      } catch (err) {
        console.error('[Scheduler] 广播失败:', err.message);
      }
    });
  }

  /**
   * 停止所有定时任务
   */
  stop() {
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    console.log('[Scheduler] 定时任务已停止');
  }
}

export default new Scheduler();
