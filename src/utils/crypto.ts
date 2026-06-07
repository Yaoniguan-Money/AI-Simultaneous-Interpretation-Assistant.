/**
 * 纯 JavaScript / Web Crypto API 加密工具集
 * 零外部依赖，浏览器原生 API，渲染进程可用
 * 供讯飞 RTASR、阿里云 NLS 等 ASR 供应商共用
 *
 * 提取自 src/services/asr/iflytek.ts，消除重复代码
 */

// ---- Base64 编码 ----

/**
 * Uint8Array 转 Base64 字符串
 * 替代 Node.js Buffer.toString('base64')，渲染进程可用
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---- HMAC-SHA1 ----

/**
 * 使用 Web Crypto API 计算 HMAC-SHA1 并返回 Base64 结果
 * 供讯飞 RTASR 签名和阿里云 NLS POP 签名共用
 */
export async function hmacSha1Base64(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const messageData = enc.encode(message);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, messageData);
  return uint8ToBase64(new Uint8Array(sig));
}

// ---- RFC 1321 MD5 纯 JS 实现 ----

/**
 * RFC 1321 MD5 哈希算法，纯 JS 实现
 * 输入 UTF-8 字符串，输出小写 32 位 hex 字符串
 * crypto.subtle 不原生支持 MD5，故自实现，零依赖
 */
export function md5Hex(input: string): string {
  /** 将 UTF-8 字符串转为字节数组 */
  const bytes = utf8Encode(input);
  const len = bytes.length;

  /** 填充：追加 0x80 + 补零 + 8 字节小端序原始长度（位） */
  const padded = new Uint8Array(((len + 8) >>> 6) + 1 << 6);
  padded.set(bytes);
  padded[len] = 0x80;

  /** 在最后 8 字节写入原始消息位长度（小端序，使用 32 位高低位） */
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true);

  /** MD5 初始向量 */
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  /** 每 64 字节（16 个 32 位字）为一组处理 */
  for (let i = 0; i < padded.length; i += 64) {
    const X = new Array(16);
    const chunkView = new DataView(padded.buffer, i, 64);
    for (let j = 0; j < 16; j++) {
      X[j] = chunkView.getUint32(j * 4, true);
    }

    /** 四轮变换（每轮 16 步），每轮返回更新后的 [a,b,c,d] */
    const [r1a, r1b, r1c, r1d] = md5Round1(a, b, c, d, X);
    const [r2a, r2b, r2c, r2d] = md5Round2(r1a, r1b, r1c, r1d, X);
    const [r3a, r3b, r3c, r3d] = md5Round3(r2a, r2b, r2c, r2d, X);
    const [r4a, r4b, r4c, r4d] = md5Round4(r3a, r3b, r3c, r3d, X);

    a = (a + r4a) >>> 0;
    b = (b + r4b) >>> 0;
    c = (c + r4c) >>> 0;
    d = (d + r4d) >>> 0;
  }

  return md5ToHex32(a) + md5ToHex32(b) + md5ToHex32(c) + md5ToHex32(d);
}

// ---- MD5 辅助函数 ----

/** MD5 辅助函数 F, G, H, I */
function F(x: number, y: number, z: number): number { return (x & y) | (~x & z); }
function G(x: number, y: number, z: number): number { return (x & z) | (y & ~z); }
function H(x: number, y: number, z: number): number { return x ^ y ^ z; }
function I(x: number, y: number, z: number): number { return y ^ (x | ~z); }

/** 循环左移 */
function rotl(x: number, n: number): number { return (x << n) | (x >>> (32 - n)); }

/** 32 位无符号整数按 MD5 标准小端序输出（低位字节在前） */
function md5ToHex32(val: number): string {
  return ((val & 0xff).toString(16).padStart(2, '0'))
    + (((val >>> 8) & 0xff).toString(16).padStart(2, '0'))
    + (((val >>> 16) & 0xff).toString(16).padStart(2, '0'))
    + (((val >>> 24) & 0xff).toString(16).padStart(2, '0'));
}

/** UTF-8 编码：字符串 → 字节数组 */
function utf8Encode(str: string): Uint8Array {
  const result: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    if (cp < 0x80) {
      result.push(cp);
    } else if (cp < 0x800) {
      result.push(0xc0 | (cp >>> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0xd800 || cp >= 0xe000) {
      result.push(0xe0 | (cp >>> 12), 0x80 | ((cp >>> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      /** 代理对：UTF-16 高/低位 → 码点 */
      i++;
      const lo = str.charCodeAt(i);
      const full = 0x10000 + ((cp & 0x3ff) << 10) + (lo & 0x3ff);
      result.push(
        0xf0 | (full >>> 18),
        0x80 | ((full >>> 12) & 0x3f),
        0x80 | ((full >>> 6) & 0x3f),
        0x80 | (full & 0x3f),
      );
    }
  }
  return new Uint8Array(result);
}

// ---- MD5 四轮变换 ----

/** 正弦表 T[i] = floor(4294967296 * |sin(i+1)|)，i=0..63 */
const MD5_T: number[] = (() => {
  const t: number[] = [];
  for (let i = 0; i < 64; i++) {
    t[i] = (Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }
  return t;
})();

/** MD5 位移量：每轮 4 个值，各重复 4 次共 16 步 */
const S1 = [7, 12, 17, 22];
const S2 = [5, 9, 14, 20];
const S3 = [4, 11, 16, 23];
const S4 = [6, 10, 15, 21];

type MD5State = [number, number, number, number];

function md5Op(
  func: (x: number, y: number, z: number) => number,
  a: number, b: number, c: number, d: number,
  x: number, t: number,
): number {
  return (a + func(b, c, d) + x + t) >>> 0;
}

function md5Round1(aa: number, bb: number, cc: number, dd: number, X: number[]): MD5State {
  let a = aa; let b = bb; let c = cc; let d = dd;
  for (let i = 0; i < 16; i++) {
    const val = md5Op(F, a, b, c, d, X[i], MD5_T[i]);
    a = d; d = c; c = b;
    b = (b + rotl(val, S1[i % 4])) >>> 0;
  }
  return [a, b, c, d];
}

function md5Round2(aa: number, bb: number, cc: number, dd: number, X: number[]): MD5State {
  let a = aa; let b = bb; let c = cc; let d = dd;
  for (let i = 0; i < 16; i++) {
    const k = (5 * i + 1) % 16;
    const val = md5Op(G, a, b, c, d, X[k], MD5_T[16 + i]);
    a = d; d = c; c = b;
    b = (b + rotl(val, S2[i % 4])) >>> 0;
  }
  return [a, b, c, d];
}

function md5Round3(aa: number, bb: number, cc: number, dd: number, X: number[]): MD5State {
  let a = aa; let b = bb; let c = cc; let d = dd;
  for (let i = 0; i < 16; i++) {
    const k = (3 * i + 5) % 16;
    const val = md5Op(H, a, b, c, d, X[k], MD5_T[32 + i]);
    a = d; d = c; c = b;
    b = (b + rotl(val, S3[i % 4])) >>> 0;
  }
  return [a, b, c, d];
}

function md5Round4(aa: number, bb: number, cc: number, dd: number, X: number[]): MD5State {
  let a = aa; let b = bb; let c = cc; let d = dd;
  for (let i = 0; i < 16; i++) {
    const k = (7 * i) % 16;
    const val = md5Op(I, a, b, c, d, X[k], MD5_T[48 + i]);
    a = d; d = c; c = b;
    b = (b + rotl(val, S4[i % 4])) >>> 0;
  }
  return [a, b, c, d];
}
