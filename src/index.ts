import { Context, h, Logger, Random, Schema, Session} from 'koishi';
import { Config } from './config';

export const name = 'sd-webui-api';
export const inject = {
  required: ['http'],
  optional: ['puppeteer', 'translator']
}
const log = new Logger('sd-webui-api');

export * from './config'

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
        session.send(Random.pick([
          '在画了在画了',
          '你就在此地不要走动，等我给你画一幅',
          '少女绘画中……',
          '正在创作中，请稍等片刻',
          '笔墨已备好，画卷即将展开'
        ]));

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
