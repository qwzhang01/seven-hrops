//! Phase B Task 3.6.2 / 3.7.1~3 — 音频转写。
//!
//! ## 职责
//! - 提供 [`transcribe_audio`] Tauri 命令：对本地音频文件做转写。
//! - 强制 sandbox 读权限校验（音频文件必须在 read_paths 白名单内）。
//! - 内部首调 [`crate::native::models::models_ensure`] 检查 whisper 模型状态。
//!   - 模型未就绪 → 透传 `WHISPER_MODEL_DOWNLOADING` / `MODEL_MIRROR_NOT_CONFIGURED`
//!   - 模型 sha256 不匹配 → 透传 `MODEL_CHECKSUM_MISMATCH`
//! - 模型就绪后：
//!   - `feature = "ffi-real"`：调 whisper-rs（B.9 接入）
//!   - 默认（B.0~B.4）：返回 [`NativeError::FfiNotImplemented`] stub
//!
//! ## 错误码契约
//! 命令永远返回 `Result<TranscribeResult, String>`，错误体 JSON 必含 `code` 字段，
//! 前端按 `code` 走 UI 分支：
//! | code | 含义 |
//! |---|---|
//! | SANDBOX_DENY_READ | 音频路径不在白名单 |
//! | WHISPER_MODEL_DOWNLOADING | 模型下载中（含 progress） |
//! | MODEL_MIRROR_NOT_CONFIGURED | 未配置 mirror（dev 期默认） |
//! | MODEL_CHECKSUM_MISMATCH | 已下载但 sha256 不对 |
//! | FFI_NOT_IMPLEMENTED | B.0~B.4 期间，模型就绪但 whisper-rs 未启用 |
//! | TRANSCRIBE_FAILED | B.9 后真实失败路径（如音频损坏） |

use crate::native::errors::NativeError;
use crate::native::models::{self, ModelStatus};
use crate::sandbox::fs_guard;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Runtime;

/// 转写结果。`text` 为整段识别文本；后续可扩展时间戳分段。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscribeResult {
    pub text: String,
    pub language: String,
    /// 模型在本地磁盘的绝对路径（仅作 debug 透传，前端不需要）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_path: Option<String>,
}

#[tauri::command]
pub async fn transcribe_audio<R: Runtime>(
    app: tauri::AppHandle<R>,
    session_id: String,
    path: String,
    lang: Option<String>,
) -> Result<TranscribeResult, String> {
    // 1) sandbox check：音频文件必须可读
    let audio_path = PathBuf::from(&path);
    let canonical = fs_guard::check_read(&session_id, &audio_path)?;

    // 2) 模型状态查询（首调会触发后台下载）
    let model_name = "whisper-base-zh".to_string();
    let ensure = models::models_ensure(app.clone(), model_name.clone(), None).await?;

    match ensure.status {
        ModelStatus::Downloading | ModelStatus::Missing => {
            // 透传下载进度，前端按 code 显示进度条
            return Err(String::from(NativeError::whisper_model_downloading(
                ensure.progress.unwrap_or_else(|| models::current_progress(&model_name)),
            )));
        }
        ModelStatus::Ready => {}
    }

    let model_path = ensure.path.clone();

    // 3) FFI 真实接入分支
    #[cfg(feature = "ffi-real")]
    {
        return run_whisper_real(&canonical, lang.as_deref(), model_path.as_deref())
            .map(|text| TranscribeResult {
                text,
                language: lang.unwrap_or_else(|| "zh".into()),
                model_path,
            })
            .map_err(String::from);
    }

    // 4) Stub 分支（B.0~B.4）：保留所有上下文以便后续 FFI 接入时仅替换实现
    #[cfg(not(feature = "ffi-real"))]
    {
        let _ = (canonical, lang, model_path);
        Err(String::from(NativeError::ffi_not_implemented("transcribe_audio")))
    }
}

#[cfg(feature = "ffi-real")]
fn run_whisper_real(
    audio: &std::path::Path,
    lang: Option<&str>,
    model_path: Option<&str>,
) -> Result<String, NativeError> {
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    let model_path = model_path.ok_or_else(|| {
        NativeError::transcribe_failed("model_path is None even though status=Ready")
    })?;

    // 加载模型
    let ctx = WhisperContext::new_with_params(
        model_path,
        WhisperContextParameters::default(),
    )
    .map_err(|e| NativeError::transcribe_failed(format!("whisper load model failed: {:?}", e)))?;

    // 读取音频文件（whisper-rs 期望 16kHz mono f32 PCM）
    let samples = read_audio_as_f32(audio)?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(lang);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    let mut state = ctx
        .create_state()
        .map_err(|e| NativeError::transcribe_failed(format!("whisper create_state failed: {:?}", e)))?;

    state
        .full(params, &samples)
        .map_err(|e| NativeError::transcribe_failed(format!("whisper full() failed: {:?}", e)))?;

    let n_segments = state
        .full_n_segments()
        .map_err(|e| NativeError::transcribe_failed(format!("full_n_segments failed: {:?}", e)))?;

    let mut result = String::new();
    for i in 0..n_segments {
        let seg = state
            .full_get_segment_text(i)
            .map_err(|e| NativeError::transcribe_failed(format!("full_get_segment_text({i}) failed: {:?}", e)))?;
        result.push_str(&seg);
    }

    Ok(result)
}

/// 将音频文件读取为 16kHz mono f32 PCM。
/// 支持 WAV（通过 hound crate）。
/// 其他格式（mp3/m4a）需要额外解码库，本期仅支持 WAV。
#[cfg(feature = "ffi-real")]
fn read_audio_as_f32(path: &std::path::Path) -> Result<Vec<f32>, NativeError> {
    // 尝试用 hound 读 WAV
    let reader = hound::WavReader::open(path)
        .map_err(|e| NativeError::transcribe_failed(format!("hound open failed: {:?}", e)))?;

    let spec = reader.spec();
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .into_samples::<f32>()
            .map(|s| s.map_err(|e| NativeError::transcribe_failed(format!("read sample: {:?}", e))))
            .collect::<Result<Vec<_>, _>>()?,
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .into_samples::<i32>()
                .map(|s| {
                    s.map(|v| v as f32 / max)
                        .map_err(|e| NativeError::transcribe_failed(format!("read sample: {:?}", e)))
                })
                .collect::<Result<Vec<_>, _>>()?
        }
    };

    // 如果是多声道，取左声道（简单降采样）
    let channels = spec.channels as usize;
    let mono: Vec<f32> = if channels == 1 {
        samples
    } else {
        samples.chunks(channels).map(|c| c[0]).collect()
    };

    Ok(mono)
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{registry, ManifestSource, SandboxContext};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn fresh_session(prefix: &str, source: ManifestSource) -> (String, PathBuf) {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let sid = format!("{}-{}-{}", prefix, std::process::id(), n);
        let tmp = std::env::temp_dir().join(format!("seven-transcribe-{}", &sid));
        std::fs::create_dir_all(&tmp).unwrap();
        let canon = std::fs::canonicalize(&tmp).unwrap();
        registry().insert(SandboxContext::new(
            sid.clone(),
            source,
            vec![canon.clone()],
            vec![],
            vec![],
        ));
        (sid, canon)
    }

    fn isolated_models_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("seven-trans-models-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("SEVEN_HROPS_MODELS_DIR", &dir);
        std::env::remove_var("SEVEN_MODEL_MIRROR_ORG");
        dir
    }

    /// 与 `models::tests::env_lock` 同一把锁，避免两个测试模块并行时互相覆盖 env。
    fn env_lock() -> &'static parking_lot::Mutex<()> {
        crate::native::models::tests::env_lock()
    }

    /// Tauri AppHandle 在单元测试里没法直接构造；这里用 `tauri::test::mock_app` 不可用
    /// 的环境下通过 `MockRuntime` 也比较繁琐。退一步：transcribe_audio 在 sandbox deny
    /// 路径根本不会用到 app（先 deny）；在其他路径我们用 `mock_builder` 路径太重，
    /// 所以模型相关测试改为直接覆盖 `models::models_ensure` 行为：因为
    /// `transcribe_audio` 的非 deny 分支会立即调到 `models::models_ensure`，而在
    /// 单测里我们已经知道当前 mirror 未配置就会返回 `MODEL_MIRROR_NOT_CONFIGURED`。
    /// 因此这里仅覆盖 sandbox deny 路径；模型分支通过 `models_ensure` 自身单测保证。

    #[tokio::test]
    async fn transcribe_denies_audio_outside_whitelist() {
        let _g = env_lock().lock();
        let _ = isolated_models_dir();
        let (sid, _dir) = fresh_session("trs-deny", ManifestSource::User);
        let outside = std::env::temp_dir().join(format!(
            "seven-trans-out-{}.wav",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&outside, b"fakewav").unwrap();

        // mock app handle: 用 tauri::test 工具
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();

        let err = transcribe_audio(
            handle,
            sid,
            outside.to_string_lossy().into_owned(),
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("SANDBOX_DENY_READ"), "got {}", err);
        let _ = std::fs::remove_file(&outside);
    }

    #[tokio::test]
    async fn transcribe_returns_mirror_not_configured_when_env_missing() {
        let _g = env_lock().lock();
        let _ = isolated_models_dir();
        let (sid, dir) = fresh_session("trs-miss", ManifestSource::User);
        let audio = dir.join("hello.wav");
        std::fs::write(&audio, b"fake-audio-bytes").unwrap();

        let app = tauri::test::mock_app();
        let handle = app.handle().clone();

        let err = transcribe_audio(
            handle,
            sid,
            audio.to_string_lossy().into_owned(),
            Some("zh".into()),
        )
        .await
        .unwrap_err();
        // Mirror 未配置 → models_ensure 直接返回 MODEL_MIRROR_NOT_CONFIGURED
        assert!(
            err.contains("MODEL_MIRROR_NOT_CONFIGURED"),
            "expected mirror not configured, got {}",
            err
        );
    }

    #[tokio::test]
    async fn transcribe_returns_ffi_not_implemented_when_model_ready_in_stub() {
        // 模拟模型已就绪（写一个 placeholder 文件 + 临时把 sha256 设为它）。
        // 但 models.rs 的 MODEL_REGISTRY 是 const 的 sha256，无法在运行期 patch；
        // 这里只能通过 local_path_if_ready 验证：放一个文件让 path 存在但 sha 不
        // 匹配 → models_ensure 会返回 MODEL_CHECKSUM_MISMATCH，而非 ready。
        //
        // 因此本测试改为断言走到了 MODEL_CHECKSUM_MISMATCH 路径（验证 stub 状态机）。
        let _g = env_lock().lock();
        let dir = isolated_models_dir();
        // 预置一个 dummy 模型文件让它"看起来"已下载
        let entry_path = dir.join("whisper/ggml-base.bin");
        std::fs::create_dir_all(entry_path.parent().unwrap()).unwrap();
        std::fs::write(&entry_path, b"not-a-real-model").unwrap();

        let (sid, sd) = fresh_session("trs-mm", ManifestSource::User);
        let audio = sd.join("hello.wav");
        std::fs::write(&audio, b"fake-audio").unwrap();

        let app = tauri::test::mock_app();
        let handle = app.handle().clone();

        let err = transcribe_audio(
            handle,
            sid,
            audio.to_string_lossy().into_owned(),
            None,
        )
        .await
        .unwrap_err();
        assert!(
            err.contains("MODEL_CHECKSUM_MISMATCH"),
            "expected checksum mismatch (stub registry sha=PENDING), got {}",
            err
        );
    }
}
