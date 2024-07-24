import { Session } from 'inspector';
import { Context, h, Logger, Schema } from 'koishi';

export const name = 'sd-webui-api';
export const inject = {
  required: ['http'],
  optional: ['puppeteer', 'translator']
}
const log = new Logger('sd-webui-api');

interface Config {
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
  useTranslation: boolean; // 是否使用翻译服务
  hiresFix: boolean; // 是否使用高分辨率修复
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
      .default(20).description('图生图的采样步数'),
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


// 插件主函数
export async function apply(ctx: Context, config: Config) {
  // 注册指令
  ctx.command('sd <prompt>', '根据文本生成图像')
    .option('steps', '-t <number> 设置采样步骤数')
    .option('cfg', '-c <number> 设置CFG Scale')
    .option('size', '-si <width>x<height> 设置输出图像尺寸')
    .option('seed', '--se <number> 设置随机种子')
    .option('negative', '--n <tags> 设置负向标签')
    .option('noPositiveTags', '-P 禁用默认正向标签')
    .option('noNegativeTags', '-N 禁用默认负向标签')
    .option('sampler', '-sa <name> 选择采样器')
    .option('scheduler', '-sc <name> 选择调度器')
    .option('modelVae', '-mv <name> [vae_name] [temp] 切换模型 [vae] [临时? Y]')
    .option('hiresFix', '-H 启用高分辨率修复')
    .option('noTranslate', '-T 禁止使用翻译服务')
    .action(async ({ args, options, session }) => {
      try {
        log.debug('Starting command action with args:', args);
        log.debug('Options received:', options);

        // 直接从config对象中读取配置
        const { endpoint, imageSize, sampler, scheduler, clipSkip, cfgScale, txt2imgSteps, maxSteps, positivePrompt, negativePrompt, positivePromptPrepend, negativePromptPrepend, hiresFix, useTranslation } = config;

        // 用户选项覆盖默认配置
        const steps = options.steps || txt2imgSteps;
        const cfg = options.cfg || cfgScale;
        const size = options.size ? options.size.split('x').map(Number) : imageSize;
        const seed = options.seed || -1;
        const samplerName = options.sampler || sampler;
        const schedulerName = options.scheduler || scheduler;
        const hr = options.hiresFix || hiresFix;
        const modelVae = options.modelVae || '';

        // 解析 modelVae 参数
        let [modelName, vaeName, temp] = modelVae.split(' ');
        let isTemporary = temp === 'Y'; // 默认为 true，只有当 temp 为 'Y' 时才为 true

        // 如果 temp 未提供，则 isTemporary 保持默认值 true
        if (temp === undefined) {
          isTemporary = true;
        }

        log.debug('Final parameters:', { steps, cfg, size, samplerName, schedulerName, modelVae });

        // 构建最终的prompt和negativePrompt
        let finalPrompt = positivePromptPrepend ? positivePrompt : '';
        finalPrompt += args;
        finalPrompt += positivePromptPrepend ? '' : positivePrompt;

        let finalNegativePrompt = negativePromptPrepend ? negativePrompt : '';
        finalNegativePrompt += options.negative || '';
        finalNegativePrompt += negativePromptPrepend ? '' : negativePrompt;

        log.debug('Final prompts:', { finalPrompt, finalNegativePrompt });

        // 构建API请求体
        const request = {
          prompt: finalPrompt,
          negative_prompt: finalNegativePrompt,
          steps: Math.min(steps, maxSteps),
          cfg_scale: cfg,
          width: size[0],
          height: size[1],
          seed: seed,
          sampler_name: samplerName,
          scheduler: schedulerName,
          clip_skip: clipSkip,
          enable_hr: hr,
          override_settings: {
            sd_model_checkpoint: modelName,
            ...(vaeName && { sd_vae: vaeName }),  // 只有当提供了 VAE 名称时才添加
          },
          override_settings_restore_afterwards: isTemporary,
        };

        log.debug('API request body:', request);

        // 随机发送一条消息
        const messages = [
          '在画了在画了',
          '你就在此地不要走动，等我给你画一幅',
          '请稍等，马上为您呈现',
          '正在创作中，请耐心等待',
          '笔墨已备好，画卷即将展开'
        ];
        const randomIndex = Math.floor(Math.random() * messages.length);
        const message = messages[randomIndex];
        session.send(message);

        // 调用API
        const response = await ctx.http.post(`${endpoint}/sdapi/v1/txt2img`, request, {
          headers: { 'Content-Type': 'application/json' },
        });

        // log.debug('API response data:', response);

        // 发送图片缓冲区
        const imgBuffer = Buffer.from(response.images[0], 'base64');

        return h.img(imgBuffer, 'image/png');
      } catch (error) {
        log.error('Error in command action:', error);
        return `Error generating image: ${error.message}`;
      }
    });
}
