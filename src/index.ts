import { Context, h, HTTP, Random, Session } from 'koishi';
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
  // 调试用
  ctx.on('message-created', (session: Session) => { log.debug(h.select(session.elements, 'img')) }, true)

  const { endpoint, maxTasks } = config;
  let numberOfTasks = 0;

  // 添加任务
  const addTask = () => numberOfTasks++;
  // 移除任务
  const removeTask = () => numberOfTasks--;

  // 注册 text2img/img2img 指令
  ctx.command('sd [prompt]', 'AI画图')
    .option('negative', '-n <tags> 负向提示词，如果有空格首尾用引号括起来')
    .option('img2img', '-i [imgURL] 图生图，@图片或输入链接')
    .option('steps', '-s <number> 采样步数')
    .option('cfgScale', '-c <number> 提示词服从度')
    .option('size', '-si <宽x高> 图像尺寸')
    .option('seed', '-se <number> 随机种子')
    .option('sampler', '-sa <name> 采样器')
    .option('scheduler', '-sc <name> 调度器')
    .option('noPositiveTags', '-P 禁用默认正向提示词')
    .option('noNegativeTags', '-N 禁用默认负向提示词')
    // .option('hiresFix', '-H 禁用高分辨率修复')
    // .option('restoreFaces', '-R 禁用人脸修复')
    .option('noTranslate', '-T 禁止使用翻译服务')
    .option('model', '-m <model_name> 单次切换SD模型')
    .option('vae', '-v <vae_name> 单次切换Vae模型')
    .action(async ({ options, session }, _) => {
      if (!maxTasks || numberOfTasks < maxTasks) {
        addTask();
        // 计算耗时
        let start = performance.now();

        try {
          log.debug('传入提示词:', _);
          log.debug('调用子指令:', options);

          // 直接从config对象中读取配置
          const { imageSize, sampler, scheduler, clipSkip, cfgScale, txt2imgSteps, img2imgSteps, maxSteps, prompt, negativePrompt, promptPrepend, negativePromptPrepend, hiresFix, restoreFaces, useTranslation, save } = config;

          // 用户选项覆盖默认配置
          let initImages = options.img2img;
          const steps = options.steps || (initImages ? img2imgSteps : txt2imgSteps);
          const cfg = options.cfgScale || cfgScale;
          const size = options.size ? options.size.split('x').map(Number) : imageSize;
          const seed = options.seed || -1;
          const samplerName = options.sampler || sampler;
          const schedulerName = options.scheduler || scheduler;
          const modelName = options.model;
          const vaeName = options.vae;

          log.debug('最终参数:', { steps, cfg, size, samplerName, schedulerName, modelName, vaeName });

          let tempPrompt = _,
            tempNegativePrompt = options.negative;

          // 构建最终的 prompt 和 negativePrompt
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

          // 图生图
          if (initImages) {
            const hasProtocol = (url: string): boolean => /^(https?:\/\/)/i.test(url);
            if (!hasProtocol(initImages)) {
              initImages = h.select(session.elements, 'img')[0]?.attrs.src;
              if (initImages === undefined) return '请引用图片消息或检查图片链接';
            }
          }

          // if (hiresFix && !options.hiresFix) { }
          // if (restoreFaces && !options.restoreFaces) { }


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
            save_images: save,
            override_settings: {
              ...(modelName && { sd_model_checkpoint: modelName }), // 只有当提供了模型名称时才添加
              ...(vaeName && { sd_vae: vaeName }),  // 只有当提供了 VAE 名称时才添加
            },
            // override_settings_restore_afterwards: isTemporary,
            ...(initImages && { init_images: [initImages] }), // 只有当提供了 init_images 时才添加
          }

          log.debug('API请求体:', request);

          if (numberOfTasks === 1) {
            session.send(Random.pick([
              '在画了在画了',
              '你就在此地不要走动，等我给你画一幅',
              '少女绘画中……',
              '正在创作中，请稍等片刻',
              '笔墨已备好，画卷即将展开'
            ]))
          } else {
            session.send(`在画了在画了，不过前面还有 ${numberOfTasks} 个任务……`)
          }

          let response: HTTP.Response<any>;
          if (initImages) {
            // 调用 img2imgAPI
            response = await ctx.http('post', `${endpoint}/sdapi/v1/img2img`, {
              data: request,
            });
          } else {
            // 调用 txt2imgAPI
            response = await ctx.http('post', `${endpoint}/sdapi/v1/txt2img`, {
              data: request,
            });
          }

          log.debug('API响应状态:', response.statusText);

          // 发送图片缓冲区
          const imgBuffer = Buffer.from(response.data.images[0], 'base64');

          if (config.outputMethod === '图片和关键信息') {
            session.send(`步数:${steps}\n尺寸:${size}\n服从度:${cfg}\n采样器:${samplerName}\n调度器:${schedulerName}`);
            session.send(`正向提示词:\n${finalPrompt}`);
            if (options.negative !== undefined) {
              session.send(`负向提示词:\n${finalNegativePrompt}`);
            }
          } else if (config.outputMethod === '详细信息') {
            session.send(JSON.stringify(request, null, 4))
          }

          let end = performance.now();
          log.debug(`总耗时: ${end - start} ms`);

          removeTask();
          return h.img(imgBuffer, 'image/png');

        } catch (error) {
          log.error('错误:', error);

          let end = performance.now();
          log.debug(`总耗时: ${end - start} ms`);

          removeTask();
          return `错误: ${error.message}`;
        }
      } else {
        // 超过最大任务数的处理逻辑
        session.send(Random.pick([
          '等会再约稿吧，我已经忙不过来了……',
          '是数位板没电了，才…才不是我不想画呢！',
          '那你得先教我画画（理直气壮',
        ]));
      }
    });


  // 注册 Interruptapi 指令
  ctx.command('sdstop', '中断当前操作')
    .action(async () => {
      try {
        log.debug('调用 Interruptapi');

        // 调用 Interruptapi
        const response = await ctx.http('post', `${endpoint}/sdapi/v1/interrupt`, {
        });

        log.debug('API响应数据:', response);

        removeTask();
        return '已终止一个任务';
      } catch (error) {
        log.error('错误:', error);
        return `错误: ${error.message}`;
      }
    });


  // 注册 Interrogateapi 指令
  ctx.command('sdtag [image]', '图片生成提示词')
    .option('model', '-m <model:string> 使用的模型')
    .action(async ({ options, session }, image) => {
      if (!maxTasks || numberOfTasks < maxTasks) {
        addTask();
        try {
          log.debug('传入图像:', image);
          log.debug('调用子指令:', options);

          const request = {
            image: image || '',
            model: options.model || ''
          };

          log.debug('API请求体:', request);

          if (numberOfTasks === 1) {
            session.send(Random.pick([
              '开始反推提示词',
              '',
              '少女绘画中……',
              '正在创作中，请稍等片刻',
              '笔墨已备好，画卷即将展开'
            ]))
          } else {
            session.send(`在推了在推了，不过前面还有 ${numberOfTasks} 个任务……`)
          }

          // 调用 Interrogateapi
          const response = await ctx.http('post', `${endpoint}/sdapi/v1/interrogate`, {
            data: request,
          });

          log.debug('API响应状态:', response.statusText);

          removeTask();
          return `反推结果:\n${response.data.description}`;
        } catch (error) {
          log.error('错误:', error);

          removeTask();
          return `错误: ${error.message}`;
        }
      } else {
        session.send(Random.pick([
          '任务数上限了，等会儿再来吧...',
          '脑子转不过来了，啊吧啊吧--',
          '推不动了，你来算吧！'
        ]));
      }
    });


  // 提取路径最后一段
  const extractFileName = (path: string) => path.split('\\').pop();

  // 注册 GetSdModels 指令
  ctx.command('sdmodel [sd_name] [vae_name]', '查询和切换模型')
    .usage('输入<model_name>为切换模型，缺失时查询模型')
    .option('sd', '-s 查询/切换SD模型')
    .option('vae', '-v 查询/切换Vae模型')
    .option('embeddeding', '-e 查询可用的嵌入模型')
    .option('hybridnetwork', '-h 查询可用的超网络模型')
    .option('lora', '-l 查询可用的loras模型')
    .action(async ({ session, options }, _1, _2) => {
      if (!maxTasks || numberOfTasks < maxTasks) {
        const sd = options.sd;
        const vae = options.vae;
        const embeddeding = options.embeddeding;
        const hybridnetwork = options.hybridnetwork;
        const lora = options.lora;
        const sdName = _1;
        const vaeName = _2;

        try {
          // 查询
          if ((sd || vae) && !(_1 || _2)) {
            const path = sd ? 'sd-models' : 'sd-vae';
            const response = await ctx.http('get', `${endpoint}/sdapi/v1/${path}`);
            const models = response.data;
            log.debug(`获取${sd ? 'SD' : 'SD VAE'}模型:`, models);

            const result = models.map((model: { filename: string; model_name: string; }) => {
              const fileName = extractFileName(model.filename);
              return `模型名称: ${model.model_name}\n文件名: ${fileName}`;
            }).join('\n\n');

            return result || `未找到可用的${sd ? 'SD' : 'SD VAE'}模型。`;
          }
          // 切换
          else if ((_1 || _2) && (sd || vae)) {
            const request = {
              override_settings: {
                ...(sdName && { sd_model_checkpoint: _1 }), // 只有当提供了模型名称时才添加
                ...(vaeName && { sd_vae: _2 }),  // 只有当提供了 VAE 名称时才添加
              },
              override_settings_restore_afterwards: false,
            }

            const response = await ctx.http('post', `${endpoint}/sdapi/v1/img2img`, {
              data: request,
            });

          }

          if (embeddeding) {
            const response = await ctx.http('get', `${endpoint}/sdapi/v1/embeddings`);
            const embeddings = response.data;
            log.debug('获取嵌入模型:', embeddings);

            const loadedEmbeddings = Object.keys(embeddings.loaded).map(key => `可加载的嵌入: ${key}`).join('\n');
            const skippedEmbeddings = Object.keys(embeddings.skipped).map(key => `不兼容的嵌入: ${key}`).join('\n');

            const result = `${loadedEmbeddings}\n\n${skippedEmbeddings}`;

            return result || '未找到嵌入模型信息。';
          }

          if (hybridnetwork) {
            const response = await ctx.http('get', `${endpoint}/sdapi/v1/hypernetworks`, {
            });
            const hypernetworks = response.data;
            log.debug('获取Hypernetworks模型',);

            const result = hypernetworks.map((hn: { filename: string; model_name: string }) => {
              const filename = extractFileName(hn.filename);
              return `模型名称: ${hn.model_name}\n文件名: ${filename}`;
            }).join('\n\n');

            return result || '未找到超网络模型信息。';
          }

          if (lora) {
            const response = await ctx.http('get', `${endpoint}/sdapi/v1/loras`);
            const loras = response.data;
            log.debug('获取Loras:', loras);

            const result = loras.map((lora: { filename: string; model_name: string; }) => {
              const fileName = extractFileName(lora.filename);
              return `名称: ${lora.model_name}\n文件名: ${fileName}`;
            }).join('\n\n');

            return result || '未找到Loras信息。';
          }

        } catch (error) {
          if (embeddeding || hybridnetwork || lora || sd || vae && !_1 && !_2) {
            log.error('查询模型时出错:', error);
            return `查询模型时出错: ${error.message}`;
          }
        }
      } else {
        session.send(Random.pick([
          '忙不过来了，走开走开！',
          '你怎么那么多事，（恼',
          '要被玩坏啦！'
        ]));
      }
    });


}
