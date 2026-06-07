/**
 * convert-to-ico.js
 * 将 assets/icon.png 转换为 assets/icon.ico
 * ICO 格式：6 字节头 + 16 字节目录项 + PNG 数据
 * 嵌入单张 256x256 PNG，Windows 自动处理缩放
 * 纯 Node.js，零依赖
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const assetsDir = join(projectRoot, 'assets');
const pngPath = join(assetsDir, 'icon.png');
const icoPath = join(assetsDir, 'icon.ico');

if (!existsSync(assetsDir)) {
  mkdirSync(assetsDir, { recursive: true });
}

const pngBuffer = readFileSync(pngPath);

// ICO 文件结构
// 头（6 字节）: reserved(2) + type(2=ICO) + count(2)
// 目录项（16 字节）: w(1) + h(1) + colors(1) + reserved(1) + planes(2) + bpp(2) + size(4) + offset(4)
// 图像数据: PNG 二进制
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);          // reserved
header.writeUInt16LE(1, 2);          // type = ICO
header.writeUInt16LE(1, 4);          // 1 image

const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0);              // 256px width (ICO 用 0 表示 256)
entry.writeUInt8(0, 1);              // 256px height
entry.writeUInt8(0, 2);              // no color palette
entry.writeUInt8(0, 3);              // reserved
entry.writeUInt16LE(1, 4);           // color planes
entry.writeUInt16LE(32, 6);          // bits per pixel (PNG 数据自带色深)
entry.writeUInt32LE(pngBuffer.length, 8);   // image size
entry.writeUInt32LE(22, 12);         // offset = header(6) + entry(16)

const icoBuffer = Buffer.concat([header, entry, pngBuffer]);
writeFileSync(icoPath, icoBuffer);

console.log(`icon.ico written: ${icoBuffer.length} bytes (256x256 PNG)`);
