import { Context, h, HTTP, Random, Session } from 'koishi';
import { promptHandle } from './utils'
import { Config, log } from './config';

export const name = 'sd-webui-api';
export const inject = {
  required: ['http'],
  optional: ['translator']
}
export * from './config'

export const usage = `
### 插件功能列表
* 功能 1：文/图生图
* 功能 2：提示词反推
* 功能 3：查询/切换模型

### 注意事项
1. 子指令只能直接调用
2. 默认使用的是秋葉整合包
`;

// 插件主函数
export async function apply(ctx: Context, config: Config) {
  // ctx.on('message-created', (session: Session) => {
  //   log.debug(JSON.stringify(session, null, 2))
  //   log.debug(JSON.stringify(h.select(session?.quote?.elements, 'img'), null, 2))
  // }, true)

  const { endpoint, useTranslation, outputMethod, maxTasks } = config;
  const imgCensor = config.WD.imgCensor;
  const header1 = {
    'accept': 'application/json',
    'Content-Type': 'application/json',
  };
  const header2 = {
    'accept': 'application/json',
  };

  let taskNum = 0;


  // 调用 Interrogateapi
  async function wdProcess(session: Session, image: string, cmd: boolean, options?: any): Promise<boolean | string> {
    let wdResult = false;
    const { tagger, threshold, indicators, score } = config.WD

    const payload = {
      image: image,
      model: options?.model || tagger,
      threshold: cmd ? (options?.threshold || threshold) : 1
    };
    // log.debug('API请求体:', payload);
    try {
      const response = await ctx.http('post', `${endpoint}/tagger/v1/interrogate`, {
        headers: header1,
        data: payload
      });
      // log.debug('响应结果', response);
      log.debug('反推API响应状态:', response.statusText);
      const { general, sensitive, questionable, explicit } = response.data.caption;
      const result = Object.keys(response.data.caption).slice(4).join(', ');

      const toFixed2 = (num: number) => parseFloat(num.toFixed(4));
      const [gen, sen, que, exp] = [general, sensitive, questionable, explicit].map(toFixed2);

      if (!cmd) {
        log.debug('选择指标:', indicators);
        for (const metric of indicators) {
          let value = 0;
          switch (metric) {
            case "que":
              value = que;
              break;
            case "sen":
              value = sen;
              break;
            case "exp":
              value = exp;
              break;
          }
          if (value > score) {
            wdResult = true;
            log.debug(`指标 ${metric} 不通过审核，其值为 ${value}`);
            break;
          }
        }
      }

      if (cmd || outputMethod !== '仅图片') {
        session.send(`普通性: ${gen}\n敏感性: ${sen}\n可疑性: ${que}\n暴露性: ${exp}`);
      }

      if (cmd) return `反推结果:\n${result}`;
      else return wdResult;
    } catch (error) {
      log.error('反推出错:', error);
      if (error?.data?.detail === 'Invalid encoded image') return '请引用自己发送的图片或检查图片链接';
      return `反推出错: ${error.message}`;
    }
  }


  // 注册 text2img/img2img 指令
  ctx.command('sd [tags]', 'AI画图')
    .option('negative', '-n <tags> 负向提示词，如果有空格首尾用引号括起来')
    .option('img2img', '-i [imgURL] 图生图，@图片或输入链接')
    .option('steps', '-s <number> 采样步数')
    .option('cfgScale', '-c <float> 提示词服从度')
    .option('size', '-si <宽x高> 图像尺寸')
    .option('seed', '-se <number> 随机种子')
    .option('sampler', '-sa <name> 采样器')
    .option('scheduler', '-sc <name> 调度器')
    .option('noPositiveTags', '-P 禁用默认正向提示词')
    .option('noNegativeTags', '-N 禁用默认负向提示词')
    // .option('hiresFix', '-H 禁用高分辨率修复')
    // .option('restoreFaces', '-R 禁用人脸修复')
    .option('noAdetailer', '-A 禁用修复器')
    .option('noTranslate', '-T 禁止使用翻译服务')
    .option('model', '-m <model_name> 单次切换SD模型')
    .option('vae', '-v <vae_name> 单次切换Vae模型')
    .action(async ({ options, session }, _) => {
      if (!maxTasks || taskNum < maxTasks) {
        log.debug('调用绘图 API');
        log.debug('选择子选项:', options);

        // 从config对象中读取配置
        const { save, imgSize, sampler, scheduler, cfgScale, txt2imgSteps, img2imgSteps, maxSteps, prePrompt, preNegPrompt, hiresFix, restoreFaces } = config.IMG;

        // 图生图
        let initImages = options?.img2img;
        if (options.hasOwnProperty('img2img')) {
          log.debug('开始获取图片');
          const hasProtocol = (url: string): boolean => /^(https?:\/\/)/i.test(url);
          if (!hasProtocol(initImages)) {
            if (session.platform === 'onebot')
              initImages = h.select(session?.quote?.elements, 'img')[0]?.attrs?.src;
            else if (session.platform.includes('sandbox')) {
              initImages = h.select(session?.quote?.content, 'img')[0]?.attrs?.src.split(',')[1];
            }
            if (!initImages) return '请检查图片链接或引用自己发送的图片消息'
          }
          // log.debug('图生图图片参数处理结果:', initImages);
        }

        // 用户选项覆盖默认配置
        const steps = options?.steps || (initImages ? img2imgSteps : txt2imgSteps);
        const cfg = options?.cfgScale || cfgScale;
        const size = options?.size ? options?.size.split('x').map(Number) : imgSize;
        const seed = options?.seed || -1;
        const smpName = options?.sampler || sampler;
        const schName = options?.scheduler || scheduler;
        const noPosTags = options?.noPositiveTags;
        const noNegTags = options?.noNegativeTags;
        const Tans = options?.noTranslate || useTranslation;
        const modelName = options?.model;
        const vaeName = options?.vae;

        // 翻译
        let tmpPrompt = _;
        let tmpNegPrompt = options?.negative;
        tmpPrompt = await promptHandle(ctx, config, tmpPrompt, Tans);
        log.debug('+提示词翻译为:', tmpPrompt);
        tmpNegPrompt = await promptHandle(ctx, config, tmpNegPrompt, Tans);
        log.debug('-提示词翻译为:', tmpNegPrompt);
        // 确定位置
        let { prompt, negativePrompt } = config.IMG;
        if (!noPosTags) if (prePrompt) {
          prompt += tmpPrompt;
          tmpPrompt = prompt;
        }
        else tmpPrompt += prompt;

        if (!noNegTags) if (preNegPrompt) {
          negativePrompt += tmpNegPrompt;
          tmpNegPrompt = negativePrompt;
        }
        else tmpNegPrompt += negativePrompt;
        log.debug('+提示词:', prompt, '\n-提示词:', negativePrompt);

        // 使用 ADetailer
        const adEnable = config.AD.enable;
        let payload2 = {};

        if (!options?.noAdetailer && adEnable) {
          const tmpList: any[] = [
            adEnable,
            false, // true，直接使用原图
          ];

          config.AD.models.forEach(async model => {
            // ADetailer翻译
            let ADPrompt = await promptHandle(ctx, config, model.prompt, Tans);
            let ADNegPrompt = await promptHandle(ctx, config, model.negativePrompt, Tans);

            const tmpPayload = {
              ad_model: model.name,
              ...(ADPrompt !== '' && { ad_prompt: ADPrompt }),
              ...(ADNegPrompt !== '' && { ad_negative_prompt: ADNegPrompt }),
              ad_confidence: model.confidence
            };
            tmpList.push(tmpPayload);
          });

          // 构建请求体
          payload2 = {
            alwayson_scripts: {
              ADetailer: {
                args: tmpList,
              }
            }
          }
        }

        // 构建API请求体
        const payload1 = {
          ...(prompt !== '' && { prompt: tmpPrompt }),
          ...(negativePrompt !== '' && { negative_prompt: tmpNegPrompt }),
          seed: seed,
          sampler_name: smpName,
          scheduler: schName,
          steps: Math.min(steps, maxSteps),
          ...((prompt !== '' || negativePrompt !== '') && { cfg_scale: cfg }),
          width: size[0],
          height: size[1],
          ...(restoreFaces && { restore_faces: true }),
          save_images: save,
          ...((modelName || vaeName) && {
            override_settings: {
              ...(modelName && { sd_model_checkpoint: modelName }),
              ...(vaeName && { sd_vae: vaeName }),
            }
          }),
          ...(initImages && { init_images: [initImages] }),
        }

        const payload = {
          ...payload1,
          ...payload2
        }

        log.debug('API请求体:', payload);

        if (taskNum === 0) {
          session.send(Random.pick([
            '在画了在画了',
            '你就在此地不要走动，等我给你画一幅',
            '少女绘画中……',
            '正在创作中，请稍等片刻',
            '笔墨已备好，画卷即将展开'
          ]))
        } else {
          session.send(`在画了在画了，不过前面还有 ${taskNum} 个任务……`)
        }

        async function process() {
          try {
            let response: HTTP.Response<any>;
            if (initImages) {
              // 调用 img2imgAPI
              response = await ctx.http('post', `${endpoint}/sdapi/v1/img2img`, {
                headers: header1,
                data: payload
              });
            } else {
              // 调用 txt2imgAPI
              response = await ctx.http('post', `${endpoint}/sdapi/v1/txt2img`, {
                headers: header1,
                data: payload
              });
            }
            log.debug('绘画API响应状态:', response.statusText);
            let image = response.data.images[0];
            // log.debug(image); // 开发其他平台时做参考

            if (outputMethod === '关键信息') {
              session.send(`步数:${steps}\n尺寸:${size}\n服从度:${cfg}\n采样器:${smpName}\n调度器:${schName}`);
              session.send(`正向提示词:\n${prompt}`);
              if (options?.negative !== undefined) session.send(`负向提示词:\n${negativePrompt}`);
            } else if (outputMethod === '详细信息') {
              session.send(JSON.stringify(payload, null, 4))
            }

            if (imgCensor) {
              session.send('进入审核阶段...');
              let censorResult = await wdProcess(session, image, false);
              log.debug('是否过审:', !censorResult);
              if (censorResult) {
                session.send('图片违规');
                if (outputMethod !== '详细信息') return; // 阻止图片输出
              }
            }
            image = Buffer.from(response.data.images[0], 'base64');
            return h.img(image, 'image/png');
          } catch (error) {
            log.error('生成图片出错:', error);
            if (error?.data?.detail === 'Invalid encoded image') return '请引用自己发送的图片或检查图片链接';
            return `生成图片出错: ${error.message}`;
          }
        }

        taskNum++;
        await session.send(await process());
        taskNum--;
      } else {
        // 超过最大任务数的处理逻辑
        session.send(Random.pick([
          '等会再约稿吧，我已经忙不过来了……',
          '是数位板没电了，才…才不是我不想画呢！',
          '那你得先教我画画（理直气壮',
        ]));
      }
    });


  // 注册 Endpoint Interrogate 指令
  ctx.command('sd').subcommand('sdtag [imgURL]', '图片生成提示词')
    .option('model', '-m <model_name> 使用的模型')
    .option('threshold', '-t <number> 提示词输出置信度')
    .action(async ({ options, session }, _) => {
      if (!maxTasks || taskNum < maxTasks) {
        log.debug('调用反推 API');
        log.debug('选择子选项:', options);

        // 获取图片
        log.debug('开始获取图片');

        const hasProtocol = (url: string): boolean => /^(https?:\/\/)/i.test(url);
        if (!hasProtocol(_)) {
          if (session.platform === 'onebot')
            _ = h.select(session?.quote?.elements, 'img')[0]?.attrs?.src;
          else if (session.platform.includes('sandbox'))
            _ = h.select(session?.quote?.content, 'img')[0]?.attrs?.src.split(',')[1];
          if (!_) return '请检查图片链接或引用自己发送的图片消息';
        }

        log.debug('获取图片参数:', _);

        if (taskNum === 0) {
          session.send(Random.pick([
            '开始反推提示词...',
            '在推了在推了...让我仔细想想...',
            '我在想想想了...',
          ]))
        } else {
          session.send(`在推了在推了，不过前面还有 ${taskNum} 个任务……`)
        }

        taskNum++;
        session.send(await wdProcess(session, _, true, options) as string);
        taskNum--;
      } else {
        session.send(Random.pick([
          '这个任务有点难，我不想接>_<',
          '脑子转不过来了，啊吧啊吧--',
          '推导不出来，你来推吧！'
        ]));
      }
    });


  // 注册 Interruptapi 指令
  ctx.command('sd').subcommand('sdstop', '中断当前操作')
    .action(async () => {
      try {
        log.debug('调用中断 API');

        // 调用 Interruptapi
        const response = await ctx.http('post', `${endpoint}/sdapi/v1/interrupt`, {
        });

        // log.debug('API响应结果:', response);

        taskNum--;
        return '已终止一个任务';
      } catch (error) {
        log.error('错误:', error.detail);
        return `错误: ${error.message}`;
      }
    });


  // 注册 GetModels 指令
  ctx.command('sd').subcommand('sdmodel [sd_name] [vae_name]', '查询和切换模型')
    .usage('输入名称时为切换模型，缺失时为查询模型')
    .option('sd', '-s 查询/切换SD模型')
    .option('vae', '-v 查询/切换Vae模型')
    .option('embeddeding', '-e 查询可用的嵌入模型')
    .option('hybridnetwork', '-n 查询可用的超网络模型')
    .option('lora', '-l 查询可用的loras模型')
    .option('wd', '-w 查询可用的WD模型')
    .action(async ({ session, options }, _1, _2) => {
      log.debug('选择子选项', options)

      if (!Object.keys(options).length) {
        log.debug('没有选择子选项，退回');
        return '请选择指令的选项！';
      }
      const sdName = _1;
      const vaeName = _2;
      const sd = options?.sd;
      const vae = options?.vae;
      const embeddeding = options?.embeddeding;
      const hybridnetwork = options?.hybridnetwork;
      const lora = options?.lora;
      const wd = options?.wd;

      // 提取路径最后一段
      const extractFileName = (path: string) => path.split('\\').pop();

      try {
        // 查询
        if ((sd || vae) && !(_1 || _2)) {
          log.debug('调用查询SD/Vae模型 API');
          const path = sd ? 'sd-models' : 'sd-vae';
          const response = await ctx.http('get', `${endpoint}/sdapi/v1/${path}`, { headers: header2 });
          log.debug('查询SD/Vae模型API响应状态:', response.statusText);
          const models = response.data;

          const result = models.map((model: { filename: string; model_name: string; }) => {
            const fileName = extractFileName(model.filename);
            return `模型名称: ${model.model_name}\n文件名: ${fileName}`;
          }).join('\n\n');

          return result || `未找到可用的${sd ? 'SD' : 'SD VAE'}模型。`;
        }
        // 切换
        else if (!maxTasks || taskNum < maxTasks) {
          if ((_1 || _2) && (sd || vae)) {
            async function process() {
              try {
                log.debug('调用切换模型 API');
                const payload = {
                  override_settings: {
                    ...(sdName && { sd_model_checkpoint: _1 }),
                    ...(vaeName && { sd_vae: _2 }),
                  },
                  override_settings_restore_afterwards: false,
                }

                session.send('模型切换中...')

                const response = await ctx.http('post', `${endpoint}/sdapi/v1/img2img`, {
                  headers: header1,
                  data: payload
                });
                log.debug('切换模型API响应状态:', response.statusText);

                return '模型更换成功'
              } catch (error) {
                log.error('切换模型时出错:', error);
                return `切换模型时出错: ${error.message}`;
              }
            }

            session.send(await process());
            taskNum--;
          }
        } else {
          session.send(Random.pick([
            '忙不过来了，走开走开！',
            '你怎么这么多要求，（晕',
            '要被玩坏啦！'
          ]));
        }

        if (embeddeding) {
          log.debug('调用查询嵌入模型 API');
          const response = await ctx.http('get', `${endpoint}/sdapi/v1/embeddings`, { headers: header2 });
          log.debug('查询嵌入模型API响应状态:', response.statusText);
          const embeddings = response.data;

          const loadedEmbeddings = Object.keys(embeddings.loaded).map(key => `可加载的嵌入: ${key}`).join('\n');
          const skippedEmbeddings = Object.keys(embeddings.skipped).map(key => `不兼容的嵌入: ${key}`).join('\n');
          const result = `${loadedEmbeddings}\n\n${skippedEmbeddings}`;

          return result || '未找到嵌入模型信息。';
        }

        if (hybridnetwork) {
          log.debug('调用查询超网络模型 API');
          const response = await ctx.http('get', `${endpoint}/sdapi/v1/hypernetworks`, { headers: header2 });
          log.debug('查询超网络模型API响应状态:', response.statusText);
          const hypernetworks = response.data;

          const result = hypernetworks.map((hn: { filename: string; model_name: string }) => {
            const filename = extractFileName(hn.filename);
            return `模型名称: ${hn.model_name}\n文件名: ${filename}`;
          }).join('\n\n');

          return result || '未找到超网络模型信息。';
        }

        if (lora) {
          log.debug('调用查询Lora模型 API');
          const response = await ctx.http('get', `${endpoint}/sdapi/v1/loras`, { headers: header2 });
          log.debug('查询Lora模型API响应状态:', response.statusText);
          const loras = response.data;

          const result = loras.map((lora: { filename: string; model_name: string; }) => {
            const fileName = extractFileName(lora.filename);
            return `模型名称: ${lora.model_name}\n文件名: ${fileName}`;
          }).join('\n\n');

          return result || '未找到Loras信息。';
        }

        if (wd) {
          log.debug('调用查询WD模型 API');
          const response = await ctx.http('get', `${endpoint}/tagger/v1/interrogators`, { headers: header2 });
          log.debug('查询WD模型API响应状态:', response.statusText);
          const models = response.data.models;

          const result = models.map((modelName: string) => `模型名称: ${modelName}`).join('\n\n');
          return result || '未找到WD信息。';
        }


      } catch (error) {
        log.error('查询模型时出错:', error);
        return `查询模型时出错: ${error.message}`;
      }
    });


  // 注册 Set Config 指令
  ctx.command('sd').subcommand('sdset <configData>', '修改SD全局设置', {
    checkUnknown: true,
    checkArgCount: true
  })
    .action(async ({ session }, configData) => {
      if (config.setConfig) {
        if (taskNum === 0) {
          async function process() {
            try {
              log.debug('调用修改设置 API');
              const response = await ctx.http('post', `${endpoint}/sdapi/v1/options`, {
                data: JSON.parse(configData),
                headers: { 'Content-Type': 'application/json' },
              });
              log.debug('API响应状态:', response.statusText);

              return '配置已成功设置。';
            } catch (error) {
              log.error('设置全局配置时出错:', error);
              if (error.response?.status === 422) {
                return '配置数据验证错误，请检查提供的数据格式。';
              }
              return `设置配置时出错: ${error.message}`;
            }
          }

          taskNum++;
          session.send(await process());
          taskNum--;
        } else {
          session.send('当前有任务在进行，请等待所有任务完成');
        }
      } else {
        session.send('管理员未启用该设置');
      }
    });


}
