import type { ASRConfig, ASRProvider } from './types';
import { IFlyTekASR } from './iflytek';
import { AliyunASR } from './aliyun';
import { DeepgramASR } from './deepgram';
import { CustomASR } from './custom';

/**
 * ASR 供应商工厂函数
 * 根据配置中的 provider 字段创建对应实例
 * 新增供应商只需添加一个 case，业务代码无需修改
 */
export function createASRProvider(config: ASRConfig): ASRProvider {
  switch (config.provider) {
    case 'iflytek':
      return new IFlyTekASR();
    case 'aliyun':
      return new AliyunASR();
    case 'deepgram':
      return new DeepgramASR();
    case 'custom':
      return new CustomASR();
    default:
      throw new Error(`不支持的 ASR 供应商: ${config.provider}`);
  }
}
