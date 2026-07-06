#!/bin/bash
# MusicAgent 一键启动脚本

echo "🎵 MusicAgent 启动中..."
echo ""

# 检查 .env 文件
if [ ! -f .env ]; then
  echo "⚠️  未找到 .env 文件，正在从模板创建..."
  cp .env.example .env
  echo "📝 请编辑 .env 文件配置你的 API Keys"
  echo ""
fi

# 检查 node_modules
if [ ! -d node_modules ]; then
  echo "📦 安装依赖..."
  npm install
  echo ""
fi

# 检查网易云音乐 API 是否运行
echo "🔍 检查网易云音乐 API (localhost:3001)..."
if curl -s http://localhost:3001 > /dev/null 2>&1; then
  echo "✅ 网易云音乐 API 已运行"
else
  echo "⚠️  网易云音乐 API 未运行"
  echo "   请在另一个终端运行: npx NeteaseCloudMusicApi"
  echo "   或使用 Docker: docker run -p 3001:3000 binaryify/netease_cloud_music_api"
  echo ""
  echo "   按 Enter 继续启动（音乐搜索功能将不可用）..."
  read
fi

echo ""
echo "🚀 启动服务器..."
node src/server.js
