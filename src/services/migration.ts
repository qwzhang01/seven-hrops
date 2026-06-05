/**
 * 数据迁移服务
 * 
 * 负责将 localStorage 中的旧数据迁移到 SQLite 数据库。
 * 适用于从旧版本升级的用户。
 */

const MIGRATION_KEY = 'seven-hrops-migration-v1';
const OLD_TASK_STORE_KEY = 'seven-hrops-task-store';

/**
 * 检查是否需要执行迁移
 */
function shouldMigrate(): boolean {
  try {
    // 检查是否已经执行过迁移
    const migrated = localStorage.getItem(MIGRATION_KEY);
    if (migrated === 'completed') {
      return false;
    }

    // 检查是否有旧数据需要迁移
    const oldData = localStorage.getItem(OLD_TASK_STORE_KEY);
    return oldData !== null;
  } catch {
    console.error('[migration] 检查迁移状态时出错');
    return false;
  }
}

/**
 * 标记迁移完成
 */
function markMigrationComplete(): void {
  try {
    localStorage.setItem(MIGRATION_KEY, 'completed');
  } catch {
    console.error('[migration] 标记迁移完成失败');
  }
}

/**
 * 迁移旧的任务数据到 sessions 表
 */
async function migrateTasksToSessions(): Promise<void> {
  try {
    const oldData = localStorage.getItem(OLD_TASK_STORE_KEY);
    if (!oldData) {
      console.log('[migration] 没有找到旧的任务数据');
      return;
    }

    const parsed = JSON.parse(oldData);
    const tasks = parsed.state?.tasks || [];

    if (tasks.length === 0) {
      console.log('[migration] 旧数据中无任务');
      return;
    }

    console.log(`[migration] 开始迁移 ${tasks.length} 个任务到 sessions 表`);

    // 动态导入 db 服务
    const { sessionCreate, sessionUpdateTitle } = await import('./db');

    for (const task of tasks) {
      try {
        // 创建对应的 session
        const sessionId = await sessionCreate(
          task.capabilityId || null,
          task.capabilityName || null
        );

        // 更新标题（如果有的话）
        if (task.title && task.title !== '新会话') {
          await sessionUpdateTitle(sessionId, task.title);
        }

        console.log(`[migration] 已迁移任务 ${task.id} -> 会话 ${sessionId}`);
      } catch (err) {
        console.error(`[migration] 迁移任务 ${task.id} 失败:`, err);
      }
    }

    console.log('[migration] 任务数据迁移完成');
  } catch (err) {
    console.error('[migration] 迁移过程出错:', err);
  }
}

/**
 * 执行所有必要的迁移
 */
export async function runMigrations(): Promise<void> {
  console.log('[migration] 开始检查数据迁移...');

  if (!shouldMigrate()) {
    console.log('[migration] 无需迁移');
    return;
  }

  try {
    // 迁移任务数据到会话表
    await migrateTasksToSessions();

    // 标记迁移完成
    markMigrationComplete();

    // 可选：清理旧的 localStorage 数据
    // localStorage.removeItem(OLD_TASK_STORE_KEY);

    console.log('[migration] 所有迁移已完成');
  } catch (err) {
    console.error('[migration] 迁移失败:', err);
  }
}

/**
 * 重置迁移状态（用于调试）
 */
export function resetMigration(): void {
  localStorage.removeItem(MIGRATION_KEY);
  console.log('[migration] 迁移状态已重置');
}
