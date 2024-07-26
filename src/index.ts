import { Context, h, Random, Session } from 'koishi';
import { translateZH } from './utils'
import { Config, log } from './config';

export const name = 'sd-webui-api';
export const inject = {
  required: ['http'],
  optional: ['puppeteer', 'translator']
}

export * from './config'

// 插件主函数
export async function apply(ctx: Context, config: Config) {
  // 并发控制
  const queue: (() => void)[] = [];
  let activeCount = 0;

  async function runWithConcurrencyLimit(fn: () => Promise<any>, session: Session): Promise<any> {
    if (queue.length >= config.maxConcurrency) {
      session.send(Random.pick([
        '等会再约稿吧，我已经忙不过来了……',
        '是数位板没电了，才…才不是我不想画呢！',
        '那你得先教我画画（理直气壮',
      ]));
      return;
    }

    if (activeCount === 0 && queue.length === 0) {
      activeCount++;
      const result = await fn();
      activeCount--;
      if (queue.length > 0) {
        const nextFn = queue.shift();
        if (nextFn) nextFn();
      }
      return result;
    } else {
      session.send(`在画了在画了，不过前面还有 ${queue.length} 个稿……`);
      return new Promise((resolve) => {
        queue.push(async () => {
          activeCount++;
          const result = await fn();
          activeCount--;
          if (queue.length > 0) {
            const nextFn = queue.shift();
            if (nextFn) nextFn();
          }
          resolve(result);
        });
      });
    }
  }

  // 注册指令
  ctx.command('sd <prompt:text>', '提示词，首尾用引号括起来或放在参数最后')
    .option('negative', '-n <tags:text> 负向提示词，首尾用引号括起来或放在参数最后')
    .option('steps', '-t <number> 采样步数')
    .option('cfg', '-c <number> 控制图像与提示词相似程度')
    .option('size', '-si <宽x高:string> 图像尺寸')
    .option('seed', '-se <number> 随机种子')
    .option('noPositiveTags', '-P 禁用默认正向提示词')
    .option('noNegativeTags', '-N 禁用默认负向提示词')
    .option('sampler', '-sa <name> 采样器')
    .option('scheduler', '-sc <name> 调度器')
    .option('modelVae', '-mv <model_name> [vae_name] [temp] 切换模型、[vae], [临时切换? :Y]')
    .option('hiresFix', '-H 启用高分辨率修复')
    .option('noTranslate', '-T 禁止使用翻译服务')
    .action(async ({ options, session }, pPrompt) => {
      return runWithConcurrencyLimit(async () => {
        // 计算耗时
        let start = performance.now();
        try {
          log.debug('传入提示词:', pPrompt);
          log.debug('调用子指令:', options);

          // 直接从config对象中读取配置
          const { endpoint, imageSize, sampler, scheduler, clipSkip, cfgScale, txt2imgSteps, maxSteps, prompt, negativePrompt, promptPrepend, negativePromptPrepend, hiresFix, save, useTranslation } = config;

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

          log.debug('最终参数:', { steps, cfg, size, samplerName, schedulerName, modelVae });

          let tempPrompt = pPrompt,
            tempNegativePrompt = options.negative;

          // 构建最终的prompt和negativePrompt
          if (useTranslation && !options.noTranslate && ctx.translator) {
            // 翻译
            tempPrompt = await translateZH(ctx, tempPrompt);

            log.debug('提示词翻译为:', tempPrompt);

            if (options.negative !== undefined) {
              tempNegativePrompt = await translateZH(ctx, tempNegativePrompt);

              log.debug('负向提示词翻译为:', tempNegativePrompt);
            }
            log.debug('所有翻译任务完成');
          }

          let finalPrompt = promptPrepend ? prompt : '';
          finalPrompt += tempPrompt;
          finalPrompt += promptPrepend ? '' : prompt;

          let finalNegativePrompt = negativePromptPrepend ? negativePrompt : '';
          finalNegativePrompt += tempNegativePrompt || '';
          finalNegativePrompt += negativePromptPrepend ? '' : negativePrompt;

          log.debug('最终提示词:', finalPrompt, '负向:', finalNegativePrompt);

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
            save_images: save,
            override_settings: {
              sd_model_checkpoint: modelName,
              ...(vaeName && { sd_vae: vaeName }),  // 只有当提供了 VAE 名称时才添加
            },
            override_settings_restore_afterwards: isTemporary,
          }

          log.debug('API请求体:', request);

          // 随机发送一条消息
          if (queue.length === 0 && activeCount === 0) {
            session.send(Random.pick([
              '在画了在画了',
              '你就在此地不要走动，等我给你画一幅',
              '少女绘画中……',
              '正在创作中，请稍等片刻',
              '笔墨已备好，画卷即将展开'
            ]));
          }

          // 调用API
          const response = await ctx.http.post(`${endpoint}/sdapi/v1/txt2img`, request, {
            headers: { 'Content-Type': 'application/json' },
          });

          // log.debug('API response data:', response);

          // 发送图片缓冲区
          const imgBuffer = Buffer.from(response.images[0], 'base64');

          if (config.outputMethod === '图片和关键信息') {
            session.send(`步数:${steps}, 引导:${cfg}, 尺寸:${size}, 采样:${samplerName}, 调度:${schedulerName}`);
            session.send(`正向: ${finalPrompt}`);
            if (options.negative !== undefined) {
              session.send(`负向: ${finalNegativePrompt}`);
            }
          } else if (config.outputMethod === '详细信息') {
            session.send(JSON.stringify(request, null, 4))
          }

          let end = performance.now();
          log.debug(`总耗时: ${end - start} ms`);

          return h.img(imgBuffer, 'image/png');

        } catch (error) {
          log.error('错误:', error);

          let end = performance.now();
          log.debug(`总耗时: ${end - start} ms`);

          return `错误: ${error.message}`;
        }
      }, session);
    });
}
