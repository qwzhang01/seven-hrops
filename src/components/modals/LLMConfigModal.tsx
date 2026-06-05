import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAIStore } from '@/stores/aiStore';
import {
  BUILT_IN_PROVIDER_IDS,
  ProviderPlugins,
  DYNAMIC_PACKAGE_WHITELIST,
  type ProviderID,
} from '@/agent-runtime/provider/plugins';
import type {
  ProtocolID,
  PromptStyleID,
  DynamicPackage,
} from '@/agent-runtime/provider/_types';

interface LLMConfigModalProps {
  onClose: () => void;
}

// ─── UI metadata ─────────────────────────────────────────────────────
//
// Display names + emoji icons live in this component only. The set of
// supported providers and their default baseURL / protocol / promptStyle
// are pulled from `ProviderPlugins` so the UI can never drift away from
// what the runtime registry actually accepts.

const PROVIDER_DISPLAY: Record<ProviderID, { label: string; icon: string }> = {
  openai: { label: 'OpenAI', icon: '🤖' },
  anthropic: { label: 'Anthropic Claude', icon: '🧠' },
  google: { label: 'Google Gemini', icon: '✨' },
  xai: { label: 'xAI Grok', icon: '🧪' },
  groq: { label: 'Groq', icon: '⚡' },
  mistral: { label: 'Mistral', icon: '🌬️' },
  cohere: { label: 'Cohere', icon: '🪢' },
  perplexity: { label: 'Perplexity', icon: '🔎' },
  togetherai: { label: 'Together AI', icon: '🤝' },
  deepinfra: { label: 'DeepInfra', icon: '🏗️' },
  openrouter: { label: 'OpenRouter', icon: '🛣️' },
  alibaba: { label: '通义千问（阿里云）', icon: '🌟' },
  volcengine: { label: '火山方舟豆包', icon: '🌋' },
  deepseek: { label: 'DeepSeek', icon: '🔍' },
  zhipu: { label: '智谱 GLM', icon: '💡' },
  moonshot: { label: 'Moonshot 月之暗面', icon: '🌙' },
  lingyiwanwu: { label: '零一万物', icon: '🅰️' },
  hunyuan: { label: '腾讯混元', icon: '🐉' },
  ollama: { label: 'Ollama（本地）', icon: '🦙' },
  dynamic: { label: '自定义（npm 动态加载）', icon: '🧩' },
};

/** Providers that don't require an API key. */
const PROVIDERS_WITHOUT_API_KEY = new Set<ProviderID>(['ollama']);

/** Default modelID hint shown in the placeholder for each provider. */
const DEFAULT_MODEL_HINT: Partial<Record<ProviderID, string>> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.0-flash',
  xai: 'grok-3',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-large-latest',
  cohere: 'command-r-plus',
  perplexity: 'sonar-pro',
  togetherai: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  deepinfra: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
  openrouter: 'anthropic/claude-sonnet-4',
  alibaba: 'qwen-plus',
  volcengine: 'doubao-1-5-pro-32k-250115',
  deepseek: 'deepseek-chat',
  zhipu: 'glm-4',
  moonshot: 'moonshot-v1-8k',
  lingyiwanwu: 'yi-large',
  hunyuan: 'hunyuan-pro',
  ollama: 'qwen3:8b',
};

/**
 * Look up plugin metadata for a built-in provider. Returns `undefined`
 * for `dynamic` (which has no static plugin).
 */
function findPlugin(id: ProviderID) {
  if (id === 'dynamic') return undefined;
  return ProviderPlugins.find((p) => p.id === id);
}

// All 19 built-in ids in a stable order plus the dynamic entry.
const ALL_PROVIDER_IDS: ProviderID[] = [...BUILT_IN_PROVIDER_IDS, 'dynamic'];

const PROTOCOL_OPTIONS: { value: ProtocolID; label: string }[] = [
  { value: 'openai-native', label: 'OpenAI Native（含 reasoning-delta）' },
  { value: 'openai-compatible', label: 'OpenAI Compatible（兼容大多数自托管/国产 SDK）' },
  { value: 'anthropic-messages', label: 'Anthropic Messages（块式 SSE）' },
];

/** PromptStyle UI tristate: 'auto' (undefined) / 'off' (null) / 'doubao' / 'qwen' */
type PromptStyleSelection = 'auto' | 'off' | PromptStyleID;

function readPromptStyleSelection(
  value: PromptStyleID | null | undefined,
): PromptStyleSelection {
  if (value === undefined) return 'auto';
  if (value === null) return 'off';
  return value;
}

function writePromptStyleSelection(
  selection: PromptStyleSelection,
): PromptStyleID | null | undefined {
  if (selection === 'auto') return undefined;
  if (selection === 'off') return null;
  return selection;
}

/**
 * LLMConfigModal — configure AI model provider, model ID, API key, base URL,
 * and (for advanced users) protocol / promptStyle / dynamic package.
 */
export function LLMConfigModal({ onClose }: LLMConfigModalProps) {
  const { modelConfig, setModelConfig } = useAIStore(
    useShallow((s) => ({
      modelConfig: s.modelConfig,
      setModelConfig: s.setModelConfig,
    })),
  );

  const [providerID, setProviderID] = useState<ProviderID>(modelConfig.providerID);
  const [modelID, setModelID] = useState(modelConfig.modelID);
  const [apiKey, setApiKey] = useState(modelConfig.apiKey ?? '');
  const [baseURL, setBaseURL] = useState(modelConfig.baseURL ?? '');
  const [protocol, setProtocol] = useState<ProtocolID | undefined>(modelConfig.protocol);
  const [promptStyleSel, setPromptStyleSel] = useState<PromptStyleSelection>(
    readPromptStyleSelection(modelConfig.promptStyle),
  );
  const [dynamicPackage, setDynamicPackage] = useState<string>(modelConfig.dynamicPackage ?? '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Per-provider derivations from plugin metadata. Re-computed when the user
  // switches providers so the placeholder/hint text follows the registry.
  const plugin = useMemo(() => findPlugin(providerID), [providerID]);
  const display = PROVIDER_DISPLAY[providerID];
  const isDynamic = providerID === 'dynamic';
  const needsApiKey = !PROVIDERS_WITHOUT_API_KEY.has(providerID);
  const defaultBaseURL = plugin?.defaultBaseURL;
  const defaultProtocol = plugin?.defaultProtocol;
  const defaultPromptStyle = plugin?.promptStyle;

  // Validate dynamic npm package name client-side. Single source of truth:
  // the `DYNAMIC_PACKAGE_WHITELIST` regex re-exported from the dynamic
  // plugin module — keeping the UI guard and the runtime guard in lockstep.
  const dynamicPackageError = useMemo(() => {
    if (!isDynamic) return null;
    if (!dynamicPackage.trim()) return '请输入 npm 包名（@ai-sdk/<name>）';
    if (!DYNAMIC_PACKAGE_WHITELIST.test(dynamicPackage.trim())) {
      return '包名必须匹配 @ai-sdk/<lowercase-name>，仅允许小写字母、数字、连字符';
    }
    return null;
  }, [isDynamic, dynamicPackage]);

  const handleProviderChange = (id: ProviderID) => {
    setProviderID(id);
    // Reset per-provider fields so we don't leak prior state into the new
    // provider's namespace.
    const nextPlugin = findPlugin(id);
    setModelID(DEFAULT_MODEL_HINT[id] ?? '');
    setBaseURL(nextPlugin?.defaultBaseURL ?? '');
    setApiKey('');
    setProtocol(undefined);
    setPromptStyleSel('auto');
    setDynamicPackage('');
  };

  const canSave =
    !saving &&
    !!modelID &&
    (!isDynamic || (!dynamicPackageError && !!protocol)) &&
    (!needsApiKey || isDynamic || !!apiKey || !!modelConfig.apiKey);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      // setModelConfig reloads the runtime internally — no need to call
      // initializeRuntime separately. Goes through the store action so the
      // component layer never reaches into services directly.
      await setModelConfig({
        providerID,
        modelID,
        apiKey: apiKey || undefined,
        baseURL: baseURL || undefined,
        protocol,
        promptStyle: writePromptStyleSelection(promptStyleSel),
        dynamicPackage: isDynamic ? (dynamicPackage as DynamicPackage) : undefined,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[LLMConfigModal] Failed to apply model config:', err);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-float-in"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-edge bg-slate-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-edge px-6">
          <div className="flex items-center gap-2">
            <span className="text-base">🤖</span>
            <h2 className="text-sm font-semibold text-text-primary">大模型配置</h2>
          </div>
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

        {/* Content */}
        <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto scroll-soft px-6 py-5">
          {/* Provider selection */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-text-secondary">模型提供商</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {ALL_PROVIDER_IDS.map((id) => {
                const meta = PROVIDER_DISPLAY[id];
                return (
                  <button
                    key={id}
                    onClick={() => handleProviderChange(id)}
                    className={[
                      'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-all',
                      providerID === id
                        ? 'border-primary bg-primary/25 text-white shadow-[0_0_0_1px_var(--color-primary)]'
                        : 'border-edge text-text-secondary hover:border-primary/30 hover:bg-edge hover:text-text-primary',
                    ].join(' ')}
                  >
                    <span className="text-base leading-none">{meta.icon}</span>
                    <span className="truncate text-xs font-medium">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dynamic-only: npm package name */}
          {isDynamic && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary">
                npm 包名 <span className="ml-1 text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={dynamicPackage}
                onChange={(e) => setDynamicPackage(e.target.value)}
                placeholder="@ai-sdk/cerebras"
                className={[
                  'rounded-lg border bg-slate-deep px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none',
                  dynamicPackageError
                    ? 'border-rose-500/60 focus:border-rose-500'
                    : 'border-edge focus:border-primary/50',
                ].join(' ')}
              />
              <p className={['text-xs', dynamicPackageError ? 'text-rose-400' : 'text-text-tertiary'].join(' ')}>
                {dynamicPackageError ?? '仅允许 @ai-sdk/<name> 形式，首次加载会弹出二次确认'}
              </p>
            </div>
          )}

          {/* Model ID */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">模型 ID</label>
            <input
              type="text"
              value={modelID}
              onChange={(e) => setModelID(e.target.value)}
              placeholder={DEFAULT_MODEL_HINT[providerID] ?? '请输入模型 ID'}
              className="rounded-lg border border-edge bg-slate-deep px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-primary/50 focus:outline-none"
            />
            <p className="text-xs text-text-tertiary">
              {providerID === 'ollama'
                ? '本地 Ollama 模型名称，如 qwen3:8b、llama3.2 等'
                : `${display.label} 模型标识符`}
            </p>
          </div>

          {/* API Key */}
          {needsApiKey && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary">API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="请输入 API Key"
                  className="w-full rounded-lg border border-edge bg-slate-deep px-3 py-2 pr-10 text-sm text-text-primary placeholder-text-tertiary focus:border-primary/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                  aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                >
                  {showApiKey ? '🙈' : '👁'}
                </button>
              </div>
              <p className="text-xs text-text-tertiary">API Key 仅保存在本地，不会上传到任何服务器</p>
            </div>
          )}

          {/* Base URL */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">
              Base URL
              <span className="ml-1 text-text-tertiary font-normal">（可选）</span>
            </label>
            <input
              type="text"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder={defaultBaseURL ?? '使用默认地址'}
              className="rounded-lg border border-edge bg-slate-deep px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-primary/50 focus:outline-none"
            />
            <p className="text-xs text-text-tertiary">
              {providerID === 'ollama'
                ? '本地 Ollama 服务地址，默认 http://localhost:11434/v1'
                : '自定义 API 代理地址，留空使用官方默认地址'}
            </p>
          </div>

          {/* Protocol — required for dynamic, optional for built-in */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">
              协议家族
              {isDynamic ? (
                <span className="ml-1 text-rose-400">*</span>
              ) : (
                <span className="ml-1 text-text-tertiary font-normal">
                  （默认：{defaultProtocol ?? '自动'}）
                </span>
              )}
            </label>
            <select
              value={protocol ?? ''}
              onChange={(e) => setProtocol((e.target.value || undefined) as ProtocolID | undefined)}
              className="rounded-lg border border-edge bg-slate-deep px-3 py-2 text-sm text-text-primary focus:border-primary/50 focus:outline-none"
            >
              {!isDynamic && (
                <option value="">默认（{defaultProtocol ?? '自动'}）</option>
              )}
              {PROTOCOL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Prompt Style — automatic from plugin metadata, user-overridable */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">
              Prompt Style 工具调用装饰器
              <span className="ml-1 text-text-tertiary font-normal">
                （默认：{defaultPromptStyle ?? '关闭'}）
              </span>
            </label>
            <select
              value={promptStyleSel}
              onChange={(e) => setPromptStyleSel(e.target.value as PromptStyleSelection)}
              className="rounded-lg border border-edge bg-slate-deep px-3 py-2 text-sm text-text-primary focus:border-primary/50 focus:outline-none"
            >
              <option value="auto">默认（自动随 provider）</option>
              <option value="off">关闭（强制不使用装饰器）</option>
              <option value="doubao">doubao —— 火山豆包专属 token</option>
              <option value="qwen">qwen —— Qwen tool_call 标记</option>
            </select>
            <p className="text-xs text-text-tertiary">
              Prompt-style 装饰器把模型输出的 token 还原为 tool-call 事件。火山方舟豆包默认开启 doubao。
            </p>
          </div>

          {/* Current config hint */}
          <div className="rounded-xl border border-edge bg-slate-deep px-4 py-3">
            <div className="mb-1.5 text-xs font-medium text-text-secondary">当前配置</div>
            <div className="flex flex-col gap-1 text-xs text-text-tertiary">
              <div className="flex justify-between">
                <span>提供商</span>
                <span className="text-text-secondary">{display.label}</span>
              </div>
              <div className="flex justify-between">
                <span>模型</span>
                <span className="text-text-secondary font-mono">{modelID || '—'}</span>
              </div>
              {(baseURL || defaultBaseURL) && (
                <div className="flex justify-between gap-4">
                  <span className="shrink-0">地址</span>
                  <span className="truncate text-right text-text-secondary font-mono">
                    {baseURL || defaultBaseURL}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span>协议</span>
                <span className="text-text-secondary font-mono">
                  {protocol ?? defaultProtocol ?? '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Prompt Style</span>
                <span className="text-text-secondary font-mono">
                  {writePromptStyleSelection(promptStyleSel) ?? defaultPromptStyle ?? '关闭'}
                </span>
              </div>
              {isDynamic && (
                <div className="flex justify-between">
                  <span>npm 包</span>
                  <span className="text-text-secondary font-mono">{dynamicPackage || '—'}</span>
                </div>
              )}
            </div>
          </div>
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
            onClick={handleSave}
            disabled={!canSave}
            className={[
              'flex min-w-[80px] items-center justify-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all',
              saved
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : !canSave
                ? 'cursor-not-allowed bg-primary/50 text-white/70'
                : 'bg-primary text-white hover:bg-primary/90',
            ].join(' ')}
          >
            {saved ? '已保存 ✓' : saving ? '保存中...' : '保存并应用'}
          </button>
        </div>
      </div>
    </div>
  );
}
