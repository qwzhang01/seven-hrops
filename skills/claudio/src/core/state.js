/**
 * 状态管理 - SQLite 数据库
 * 存储：messages、plays、plan、prefs、测量值
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import config from '../config.js';

class StateDB {
  constructor() {
    const dbDir = config.dataDir;
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(join(dbDir, 'state.db'));
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id TEXT,
        song_name TEXT NOT NULL,
        artist TEXT,
        played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        duration INTEGER DEFAULT 0,
        skipped INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        time_slot TEXT NOT NULL,
        plan TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS prefs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // === Messages ===
  addMessage(role, content) {
    this.db.prepare(
      'INSERT INTO messages (role, content) VALUES (?, ?)'
    ).run(role, content);
  }

  getRecentMessages(limit = 20) {
    return this.db.prepare(
      'SELECT role, content, timestamp FROM messages ORDER BY id DESC LIMIT ?'
    ).all(limit).reverse();
  }

  // === Plays ===
  addPlay(songId, songName, artist, duration = 0, skipped = false) {
    this.db.prepare(
      'INSERT INTO plays (song_id, song_name, artist, duration, skipped) VALUES (?, ?, ?, ?, ?)'
    ).run(songId, songName, artist, duration, skipped ? 1 : 0);
  }

  getRecentPlays(limit = 10) {
    return this.db.prepare(
      'SELECT song_name, artist, played_at, skipped FROM plays ORDER BY id DESC LIMIT ?'
    ).all(limit);
  }

  getTodayPlays() {
    return this.db.prepare(
      "SELECT song_name, artist, played_at FROM plays WHERE date(played_at) = date('now') ORDER BY id"
    ).all();
  }

  // === Plans ===
  setPlan(date, timeSlot, plan) {
    this.db.prepare(
      'INSERT OR REPLACE INTO plans (date, time_slot, plan) VALUES (?, ?, ?)'
    ).run(date, timeSlot, plan);
  }

  getTodayPlan() {
    const today = new Date().toISOString().split('T')[0];
    return this.db.prepare(
      "SELECT time_slot, plan, status FROM plans WHERE date = ? ORDER BY time_slot"
    ).all(today);
  }

  // === Preferences ===
  setPref(key, value) {
    this.db.prepare(
      'INSERT OR REPLACE INTO prefs (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).run(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  getPref(key) {
    const row = this.db.prepare('SELECT value FROM prefs WHERE key = ?').get(key);
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  // === 统计 ===
  getListeningStats() {
    const today = this.db.prepare(
      "SELECT COUNT(*) as count FROM plays WHERE date(played_at) = date('now')"
    ).get();
    const total = this.db.prepare('SELECT COUNT(*) as count FROM plays').get();
    const topArtists = this.db.prepare(
      "SELECT artist, COUNT(*) as count FROM plays GROUP BY artist ORDER BY count DESC LIMIT 5"
    ).all();

    return {
      todayCount: today.count,
      totalCount: total.count,
      topArtists,
    };
  }
}

export default new StateDB();
