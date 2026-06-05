import { useState } from 'react';

interface SettingsModalProps {
  onClose: () => void;
}

type SettingsTab = 'general' | 'appearance' | 'about';

/**
 * SettingsModal — system settings dialog.
 * Tabs: General, Appearance, About.
 */
export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [language, setLanguage] = useState('zh-CN');
  const [autoSave, setAutoSave] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [theme, setTheme] = useState('dark');
  const [fontSize, setFontSize] = useState('medium');

  const tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'general', label: '通用', icon: '⚙️' },
    { id: 'appearance', label: '外观', icon: '🎨' },
    { id: 'about', label: '关于', icon: 'ℹ️' },
  ];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-float-in"
      onClick={onClose}
    >
      <div
        className="flex h-[520px] w-full max-w-2xl overflow-hidden rounded-2xl border border-edge bg-slate-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Sidebar ── */}
        <div className="flex w-44 shrink-0 flex-col border-r border-edge bg-slate-deep">
          {/* Header */}
          <div className="flex h-14 items-center px-4">
            <span className="text-sm font-semibold text-text-primary">系统设置</span>
          </div>
          {/* Tabs */}
          <nav className="flex-1 px-2 py-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-secondary hover:bg-edge hover:text-text-primary',
                ].join(' ')}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* ── Content ── */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Title bar */}
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-edge px-6">
            <h2 className="text-sm font-semibold text-text-primary">
              {tabs.find((t) => t.id === activeTab)?.label}
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-edge hover:text-text-secondary"
              aria-label="关闭"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto scroll-soft px-6 py-5">
            {activeTab === 'general' && (
              <div className="flex flex-col gap-5">
                {/* Language */}
                <SettingRow label="界面语言" description="设置应用显示语言">
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="rounded-lg border border-edge bg-slate-deep px-3 py-1.5 text-sm text-text-primary focus:border-primary/50 focus:outline-none"
                  >
                    <option value="zh-CN">简体中文</option>
                    <option value="en-US">English</option>
                  </select>
                </SettingRow>

                {/* Auto save */}
                <SettingRow label="自动保存" description="自动保存工作区状态">
                  <Toggle value={autoSave} onChange={setAutoSave} />
                </SettingRow>

                {/* Notifications */}
                <SettingRow label="桌面通知" description="任务完成时发送系统通知">
                  <Toggle value={notifications} onChange={setNotifications} />
                </SettingRow>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="flex flex-col gap-5">
                {/* Theme */}
                <SettingRow label="主题" description="选择应用外观主题">
                  <div className="flex gap-2">
                    {[
                      { value: 'dark', label: '深色' },
                      { value: 'light', label: '浅色' },
                      { value: 'system', label: '跟随系统' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setTheme(opt.value)}
                        className={[
                          'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                          theme === opt.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-edge text-text-secondary hover:border-primary/30 hover:text-text-primary',
                        ].join(' ')}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </SettingRow>

                {/* Font size */}
                <SettingRow label="字体大小" description="调整界面文字大小">
                  <div className="flex gap-2">
                    {[
                      { value: 'small', label: '小' },
                      { value: 'medium', label: '中' },
                      { value: 'large', label: '大' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setFontSize(opt.value)}
                        className={[
                          'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                          fontSize === opt.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-edge text-text-secondary hover:border-primary/30 hover:text-text-primary',
                        ].join(' ')}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </SettingRow>
              </div>
            )}

            {activeTab === 'about' && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4 rounded-xl border border-edge bg-slate-deep p-4">
                  <img
                    src="/logo-white.png"
                    alt="Seven HROps"
                    className="h-12 w-12 rounded-xl object-cover"
                    style={{ mixBlendMode: 'screen' }}
                  />
                  <div>
                    <div className="text-sm font-semibold text-text-primary">Seven HROps</div>
                    <div className="text-xs text-text-tertiary">版本 v0.1.0</div>
                    <div className="mt-0.5 text-xs text-text-tertiary">AI HR 智能助手</div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 text-xs text-text-tertiary">
                  <div className="flex justify-between rounded-lg px-3 py-2 hover:bg-edge">
                    <span>构建时间</span>
                    <span>2026-05-26</span>
                  </div>
                  <div className="flex justify-between rounded-lg px-3 py-2 hover:bg-edge">
                    <span>运行环境</span>
                    <span>Tauri + React</span>
                  </div>
                  <div className="flex justify-between rounded-lg px-3 py-2 hover:bg-edge">
                    <span>开发者</span>
                    <span>Seven</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-edge px-6 py-3">
            <button
              onClick={onClose}
              className="rounded-lg border border-edge px-4 py-1.5 text-sm text-text-secondary transition-colors hover:bg-edge hover:text-text-primary"
            >
              取消
            </button>
            <button
              onClick={onClose}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm text-white transition-colors hover:bg-primary/90"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helper components ─────────────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <div className="text-sm text-text-primary">{label}</div>
        {description && <div className="mt-0.5 text-xs text-text-tertiary">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={[
        'relative h-5 w-9 rounded-full transition-colors',
        value ? 'bg-primary' : 'bg-edge',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
          value ? 'translate-x-4' : 'translate-x-0.5',
        ].join(' ')}
      />
    </button>
  );
}
