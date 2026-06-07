/**
 * pack-zip.js
 * 将 electron-builder --dir 输出的 win-unpacked 目录打包为 ZIP 分发包
 * 纯 Node.js，零依赖（使用系统 7za 或内置压缩）
 * 用法：npm run dist
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const releaseDir = join(projectRoot, 'release');
const unpackedDir = join(releaseDir, 'win-unpacked');

// 读取版本号
const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
const version = pkg.version;

// 确保 unpacked 目录存在
if (!existsSync(join(unpackedDir, 'AI 同声传译助手.exe'))) {
  console.error('[pack-zip] Error: win-unpacked not found. Run "npm run build" first.');
  process.exit(1);
}

// 创建输出目录
if (!existsSync(releaseDir)) {
  mkdirSync(releaseDir, { recursive: true });
}

const zipName = `AI-Interpreter-${version}-x64.zip`;
const zipPath = join(releaseDir, zipName);

console.log(`[pack-zip] Creating ${zipName}...`);

try {
  // 使用 PowerShell Compress-Archive（Windows 内置，无需 7za）
  // 路径中的空格需要用单引号包裹
  const psCmd = `Compress-Archive -Path '${unpackedDir}\\*' -DestinationPath '${zipPath}' -Force -CompressionLevel Optimal`;
  execSync(`powershell -Command "${psCmd}"`, { cwd: projectRoot, stdio: 'pipe' });

  const { size } = statSync(zipPath);
  console.log(`[pack-zip] Done: ${zipName} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`[pack-zip] Distribution: ${zipPath}`);
} catch (err) {
  console.error(`[pack-zip] Failed: ${err.message}`);
  process.exit(1);
}
