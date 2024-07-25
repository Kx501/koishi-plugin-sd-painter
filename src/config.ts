import { Schema } from 'koishi';

export interface Config {
    sampler: any; // 采样器选项
    scheduler: any; // 调度器选项
    clipSkip: number; // CLIP模型skip层数
    imageSize: any; // 图片尺寸
    cfgScale: number; // CFG Scale
    txt2imgSteps: number; // 文生图步骤数
    img2imgSteps: number; // 图生图步骤数
    maxSteps: number; // 最大步骤数（指令允许的最大）
    positivePrompt: string; // 正向提示词
    negativePrompt: string; // 负向提示词
    positivePromptPrepend: boolean; // 正向提示词是否前置
    negativePromptPrepend: boolean; // 负向提示词是否前置
    outputMethod: any;
    hiresFix: boolean; // 是否使用高分辨率修复
    useTranslation: boolean; // 是否使用翻译服务
    endpoint: string; // API端点
    maxConcurrency?: number; // 最大并发数
    requestInterval?: number; // 请求间隔
  }
  
  // 配置约束
  export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
      sampler: Schema.union([
        'DPM++ 2M',
        'DPM++ SDE',
        'DPM++ 2M SDE',
        'DPM++ 2M SDE Heun',
        'DPM++ 2S a',
        'DPM++ 3M SDE',
        'Euler a',
        'Euler',
        'LMS',
        'Heun',
        'DPM2',
        'DPM2 a',
        'DPM fast',
        'DPM adaptive',
        'Restart',
        'DDIM',
        'PLMS',
        'UniPC',
        'LCM'
      ])
        .default('DPM++ SDE').description('采样器选项'),
      scheduler: Schema.union([
        'Automatic',
        'Uniform',
        'Karras',
        'Exponential',
        'Polyexponential',
        'SGM Uniform'
      ])
        .default('Automatic').description('调度器选项'),
      clipSkip: Schema.number()
        .default(2)
        .description('跳过CLIP模型的前几层，以减少计算成本'),
      imageSize: Schema.tuple([Schema.number(), Schema.number()])
        .default([512, 512]).description(`生成图像的宽度和高度(16的倍数)
  - 模板：
  - 256x256
  - 512x512
  - 512x768
  - 832x1216
  - 1024x1024
  - 1280x720
  - 1920x1080
  `),
      cfgScale: Schema.number()
        .default(7).description('提示词引导系数，用于控制生成图像与提示词的相似程度'),
      txt2imgSteps: Schema.number()
        .default(20).description('文生图的采样步数'),
      img2imgSteps: Schema.number()
        .default(40).description('图生图的采样步数'),
      maxSteps: Schema.number()
        .default(60).description('最大允许的采样步数'),
      positivePrompt: Schema.string()
        .default('').description('默认的正向提示词'),
      negativePrompt: Schema.string()
        .default('').description('默认的负向提示词'),
      positivePromptPrepend: Schema.boolean()
        .default(true).description('正向提示词是否添加在指令提示词之前'),
      negativePromptPrepend: Schema.boolean()
        .default(true).description('负向提示词是否添加在指令提示词之前'),
    }).description('基础设置'),
    Schema.object({
      outputMethod: Schema.union([
        '仅图片',
        '图片和关键信息',
        '全部信息'
      ]).default('仅图片').description('输出方式'),
      hiresFix: Schema.boolean()
        .default(false).description('是否启用高分辨率修复'),
      useTranslation: Schema.boolean()
        .default(false).description('是否启用翻译服务以处理非英文提示词'),
    }).description('拓展功能'),
    Schema.object({
      endpoint: Schema.string()
        .default('http://127.0.0.1:7860').description('SD-WebUI API的网络地址'),
      maxConcurrency: Schema.number()
        .min(0).default(3).description('同时处理的最大请求数量'),
      requestInterval: Schema.number()
        .min(0).default(0).description('请求间隔(毫秒)'),
    }).description('网络配置'),
  ]);