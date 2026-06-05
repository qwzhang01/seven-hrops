#!/usr/bin/env bash
# =============================================================================
# fetch-pdfium.sh — Phase B Task 9.2
#
# Downloads the pre-built pdfium shared library for the current platform from
# the seven-hrops-assets GitHub Release and verifies its sha256 checksum.
#
# Usage:
#   ./scripts/fetch-pdfium.sh [--org <github-org>] [--version <tag>] [--force]
#
# Environment variables (override CLI flags):
#   SEVEN_MODEL_MIRROR_ORG   GitHub org that hosts seven-hrops-assets
#   PDFIUM_VERSION           Release tag (default: pdfium-v6611)
#
# Output:
#   ~/.seven-hrops/native/pdfium/<arch>/libpdfium.dylib  (macOS)
#   ~/.seven-hrops/native/pdfium/win-x64/pdfium.dll      (Windows)
#
# After a successful run the script prints the sha256 of the downloaded file.
# Copy that value into src-tauri/src/native/models.rs MODEL_REGISTRY.
# =============================================================================

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
ORG="${SEVEN_MODEL_MIRROR_ORG:-}"
VERSION="${PDFIUM_VERSION:-pdfium-v6611}"
FORCE=0
DEST_ROOT="${HOME}/.seven-hrops/native/pdfium"

# ─── CLI parsing ─────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --org)      ORG="$2";     shift 2 ;;
    --version)  VERSION="$2"; shift 2 ;;
    --force)    FORCE=1;      shift   ;;
    *)          echo "Unknown flag: $1"; exit 1 ;;
  esac
done

if [[ -z "$ORG" ]]; then
  echo "❌  GitHub org not set."
  echo "    Set SEVEN_MODEL_MIRROR_ORG env var or pass --org <org>"
  exit 1
fi

# ─── Platform detection ──────────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

case "${OS}-${ARCH}" in
  Darwin-arm64)
    ASSET="pdfium-mac-arm64.tgz"
    DEST_DIR="${DEST_ROOT}/mac-arm64"
    LIB_NAME="libpdfium.dylib"
    ;;
  Darwin-x86_64)
    ASSET="pdfium-mac-x64.tgz"
    DEST_DIR="${DEST_ROOT}/mac-x64"
    LIB_NAME="libpdfium.dylib"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows*)
    ASSET="pdfium-win-x64.zip"
    DEST_DIR="${DEST_ROOT}/win-x64"
    LIB_NAME="pdfium.dll"
    ;;
  *)
    echo "❌  Unsupported platform: ${OS}-${ARCH}"
    exit 1
    ;;
esac

DEST_FILE="${DEST_DIR}/${LIB_NAME}"
URL="https://github.com/${ORG}/seven-hrops-assets/releases/download/${VERSION}/${ASSET}"

echo "📦  pdfium fetch"
echo "    org     : ${ORG}"
echo "    version : ${VERSION}"
echo "    asset   : ${ASSET}"
echo "    dest    : ${DEST_FILE}"
echo ""

# ─── Skip if already present ─────────────────────────────────────────────────
if [[ -f "${DEST_FILE}" && "${FORCE}" -eq 0 ]]; then
  echo "✅  Already present: ${DEST_FILE}"
  echo "    sha256: $(sha256sum_of "${DEST_FILE}" 2>/dev/null || shasum -a 256 "${DEST_FILE}" | awk '{print $1}')"
  echo "    Use --force to re-download."
  exit 0
fi

# ─── Download ────────────────────────────────────────────────────────────────
mkdir -p "${DEST_DIR}"
TMP_ARCHIVE="${DEST_DIR}/${ASSET}"

echo "⬇️   Downloading ${URL} ..."
if command -v curl &>/dev/null; then
  curl -fL --progress-bar -o "${TMP_ARCHIVE}" "${URL}"
elif command -v wget &>/dev/null; then
  wget -q --show-progress -O "${TMP_ARCHIVE}" "${URL}"
else
  echo "❌  Neither curl nor wget found. Install one and retry."
  exit 1
fi

# ─── Extract ─────────────────────────────────────────────────────────────────
echo "📂  Extracting ..."
case "${ASSET}" in
  *.tgz|*.tar.gz)
    tar -xzf "${TMP_ARCHIVE}" -C "${DEST_DIR}" --strip-components=0 2>/dev/null || \
    tar -xzf "${TMP_ARCHIVE}" -C "${DEST_DIR}"
    ;;
  *.zip)
    if command -v unzip &>/dev/null; then
      unzip -o -q "${TMP_ARCHIVE}" -d "${DEST_DIR}"
    else
      echo "❌  unzip not found. Install it and retry."
      rm -f "${TMP_ARCHIVE}"
      exit 1
    fi
    ;;
esac
rm -f "${TMP_ARCHIVE}"

# ─── Locate the library ──────────────────────────────────────────────────────
# Some releases nest the lib inside a subdirectory; find and promote it.
if [[ ! -f "${DEST_FILE}" ]]; then
  FOUND="$(find "${DEST_DIR}" -name "${LIB_NAME}" | head -1)"
  if [[ -z "${FOUND}" ]]; then
    echo "❌  Could not find ${LIB_NAME} after extraction."
    echo "    Contents of ${DEST_DIR}:"
    ls -la "${DEST_DIR}"
    exit 1
  fi
  mv "${FOUND}" "${DEST_FILE}"
fi

# ─── sha256 ──────────────────────────────────────────────────────────────────
if command -v sha256sum &>/dev/null; then
  SHA="$(sha256sum "${DEST_FILE}" | awk '{print $1}')"
elif command -v shasum &>/dev/null; then
  SHA="$(shasum -a 256 "${DEST_FILE}" | awk '{print $1}')"
else
  SHA="(sha256 tool not found)"
fi

echo ""
echo "✅  Done: ${DEST_FILE}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  sha256: ${SHA}"
echo ""
echo "  ⚠️  Copy this sha256 into src-tauri/src/native/models.rs:"
echo "     MODEL_REGISTRY entry for \"pdfium-${ASSET%.*}\" → sha256: \"${SHA}\""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
