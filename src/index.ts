import { Context, Dict, h, HTTP, Random, Session } from 'koishi';
import { } from 'koishi-plugin-monetary'
import { promptHandle } from './utils'
import { Config, log } from './config';
import { samplerL, schedulerL, ad_modelL, wd_modelL } from './list';

export const name = 'sd-webui-api';
export const inject = {
  required: ['http'],
  optional: ['translator', 'dvc', 'database', 'monetary']
}
export * from './config'

export const usage = `
### 插件功能列表
* 功能 1：文/图生图
* 功能 2：提示词反推
* 功能 3：查询/切换模型
* 功能 4：修改配置(未测试)
* 功能 5：图片审核(测试版)，见 [imgCensor](https://github.com/Kx501/koishi-plugin-imgcensor)

### 注意事项
1. 子指令只能直接调用
2. 默认使用的是秋葉整合包
3. 翻译服务默认百度翻译
4. 默认指令较多，建议在指令管理中个性化配置
`;

// 插件主函数
export function apply(ctx: Context, config: Config) {
  // ctx.on('message-created', (session: Session) => {
  //   log.debug(JSON.stringify(session, null, 2))
  //   log.debug(JSON.stringify(h.select(session?.quote?.elements, 'img'), null, 2))
  // }, true)

  ctx.middleware((session, next) => {
    if (config.closingMode.enable) return config.closingMode.tips;
    else return next();
  }, true /* true 表示这是前置中间件 */)

  const { timeOut, outputMethod: outMeth, maxTasks } = config;
  const { sampler, scheduler } = config.IMG;
  const monetary = config.monetary.enable;
  const { enable: censor, endpoint: cEndpoint, labels } = config.censor;
  const { enable: mask, type: maskType, color, maskShape, maskScale, blurStrength, gradualRatio } = config.censor?.mask ?? {};

  const header1 = {
    'accept': 'application/json',
    'Content-Type': 'application/json',
  };
  const header2 = {
    'accept': 'application/json',
  };

  let taskNum = 0;
  const servers = config.endpoint;
  const servStr = servers.map((_, index) => `服务器 ${index}`).join('、');

  // 简单轮询
  function selectServer() {
    const index = taskNum % servers.length;
    log.debug(`选择服务器: ${index}号: ${servers[index]}`);
    return servers[index];
  }




  // 注册 text2img/img2img 指令
  // k l m q u w y
  ctx.command('sd [tags]', 'AI画图，若提示词有空格，首尾用引号括起来')
    .option('negative', '-n <tags> 负向提示词，若有空格，首尾用引号括起来')
    .option('img2img', '-i [imgURL] 图生图，@图片或输入链接，放在参数末尾')
    .option('steps', '-s <number> 迭代步数')
    .option('cfgScale', '-c <float> 提示词服从度')
    .option('size', '-z <宽x高> 图像尺寸')
    .option('seed', '-e <number> 随机种子')
    .option('sampler', '-p <name> 采样器')
    .option('scheduler', '-d <name> 调度器')
    .option('fixAlgorithm', '-f <name> 高分辨率修复算法')
    .option('secondPassSteps', '-b <number> 修复步数')
    .option('denoisingStrength', '-o <float> 修复降噪强度')
    .option('hrScale', '-r <float> 修复比例')
    .option('dvc', '-v 扩写提示词')
    .option('server', '-x <number> 指定服务器编号')
    .option('noPositiveTags', '-G 禁用默认正向提示词')
    .option('noNegativeTags', '-J 禁用默认负向提示词')
    .option('noHiresFix', '-H 禁用高分辨率修复')
    // .option('restoreFaces', '-R 禁用人脸修复')
    .option('noAdetailer', '-A 禁用ADetailer')
    .option('noTranslate', '-T 禁用翻译')
    // .option('model', '-m <model_name> 单次切换SD模型')
    // .option('vae', '-v <vae_name> 单次切换Vae模型')
    .action(async ({ options, session }, _) => {
      if (!maxTasks || taskNum < maxTasks) {
        log.debug('调用绘图 API');
        log.debug('选择子选项:', options);


        //// 经济系统 ////
        const sdMonetary = config.monetary.sd;
        let userAid: number;
        if (monetary && sdMonetary) {
          userAid = (await ctx.database.get('binding', { pid: [session.userId] }, ['aid']))[0]?.aid;
          let balance = (await ctx.database.get('monetary', { uid: userAid }, ['value']))[0]?.value;
          if (balance < sdMonetary || balance === undefined || !ctx.monetary) {
            ctx.monetary.gain(userAid, 0);
            return '当前余额不足，请联系管理员充值VIP /doge/doge'
          }
        }


        //// 读取配置 ////
        const { save, imgSize, cfgScale, txt2imgSteps: t2iSteps, img2imgSteps: i2iSteps, maxSteps, prePrompt, preNegPrompt, restoreFaces: resFaces } = config.IMG;
        const { enable: enableHiresFix, hrUpscaler, hrSecondPassSteps: hrSteps, denoisingStrength, fixWay } = config.IMG?.hiresFix
        const { type: hiresFixType, hrScale, hrResizeX, hrResizeY } = fixWay ?? {}
        const adEnable = config.AD.ADetailer.enable;
        const useTrans = config.useTranslation.enable;

        // 选择服务器
        let endpoint = selectServer();
        if (options?.server)
          if (options.server < servers.length)
            endpoint = servers[options.server];
          else {
            endpoint = servers[0];
            session.send('不存在该序列节点，自动选择0号节点')
          }


        //// 参数处理 ////
        // 检查图生图参数
        let initImages = options?.img2img;
        if (options.hasOwnProperty('img2img')) {
          log.debug('获取图片......');
          const hasProtocol = (imgUrl: string): boolean => /^(https?:\/\/)/i.test(imgUrl);
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
        const steps = options?.steps || (initImages ? i2iSteps : t2iSteps);
        const cfg = options?.cfgScale || cfgScale;
        const size = options?.size ? options?.size.split('x').map(Number) : imgSize;
        const seed = options?.seed || -1;
        const smpName = options?.sampler || sampler;
        const schName = options?.scheduler || scheduler;
        const noPosTags = options?.noPositiveTags;
        const noNegTags = options?.noNegativeTags;
        const Trans = useTrans && !options?.noTranslate;
        const DVC = options?.dvc && config.useDVC.enable;
        // const modelName = options?.model;
        // const vaeName = options?.vae;
        const hiresFix = !options?.img2img && !options.noHiresFix && enableHiresFix;
        const hiresAlgorithm = options?.fixAlgorithm || hrUpscaler;
        const hrFixType = options?.hrScale ? '比例放大' : hiresFixType;
        const hiresSteps = options?.secondPassSteps || hrSteps;
        const hiresDenoising = options?.denoisingStrength || denoisingStrength;
        const hiresScale = options?.hrScale || hrScale;

        // 翻译
        let tmpPrompt = _ || '';
        let tmpNegPrompt = options?.negative || '';
        tmpPrompt = await promptHandle(ctx, session, config, tmpPrompt, Trans, DVC);
        tmpNegPrompt = await promptHandle(ctx, session, config, tmpNegPrompt, Trans, DVC);

        // 确定位置
        let { prompt, negativePrompt } = config.IMG;
        if (!noPosTags && prompt) {
          if (tmpPrompt === '') tmpPrompt = prompt;
          else {
            // 确定字符串之间是否需要逗号
            const needsComma = prePrompt ? !prompt.endsWith(',') : !tmpPrompt.endsWith(',');
            const comma = needsComma ? ',' : '';
            // 连接
            tmpPrompt = prePrompt ? prompt + comma + tmpPrompt : tmpPrompt + comma + prompt;
          }
        }
        if (!noNegTags && negativePrompt) {
          if (tmpNegPrompt === '') tmpNegPrompt = negativePrompt;
          else {
            // 确定字符串之间是否需要逗号
            const needsComma = preNegPrompt ? !negativePrompt.endsWith(',') : !tmpNegPrompt.endsWith(',');
            const comma = needsComma ? ',' : '';
            // 连接
            tmpNegPrompt = preNegPrompt ? negativePrompt + comma + tmpNegPrompt : tmpNegPrompt + comma + negativePrompt;
          }
        }


        //// 使用 ADetailer ////
        let payload2 = {};

        if (!options?.noAdetailer && adEnable) {
          const tmpList: any[] = [
            adEnable,
            false, // true，直接使用原图
          ];

          await Promise.all(config.AD.ADetailer.models.map(async model => {
            log.debug('处理ADetailer参数...');
            // ADetailer翻译
            let ADPrompt = await promptHandle(ctx, session, config, model.prompt, Trans, DVC);
            let ADNegPrompt = await promptHandle(ctx, session, config, model.negativePrompt, Trans, DVC);

            const tmpPayload = {
              ad_model: model.name,
              ...(ADPrompt !== '' && { ad_prompt: ADPrompt }),
              ...(ADNegPrompt !== '' && { ad_negative_prompt: ADNegPrompt }),
              ad_confidence: model.confidence
            };
            tmpList.push(tmpPayload);
          }));


          //// 构建请求体 ////
          // AD请求体
          payload2 = {
            alwayson_scripts: {
              ADetailer: {
                args: tmpList,
              }
            }
          }
        }

        // API请求体
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
          // ...((modelName || vaeName) && {
          //   override_settings: {
          //     ...(modelName && { sd_model_checkpoint: modelName }),
          //     ...(vaeName && { sd_vae: vaeName }),
          //   }
          // }),
          ...(hiresFix && {
            enable_hr: true,
            hr_upscaler: hiresAlgorithm,
            ...(hrFixType === '比例放大' ? { hr_scale: hiresScale } : { hr_resize_x: hrResizeX, hr_resize_y: hrResizeY }),
            ...(hiresDenoising !== 0 && { denoising_strength: hiresDenoising }),
            ...(hiresSteps !== 0 && { hr_second_pass_steps: hiresSteps }),
          }),
          save_images: save,
          ...(initImages && { init_images: [initImages] })
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
            '少女绘画中......',
            '正在创作中，请稍等片刻',
            '笔墨已备好，画卷即将展开'
          ]))
        } else {
          session.send(`在画了在画了，不过前面还有 ${taskNum} 个任务......`)
        }

        //// 调用绘画API ////
        async function process() {
          try {
            let response: HTTP.Response<any>;
            if (initImages) {
              // img2imgAPI
              response = await ctx.http('post', `${endpoint}/sdapi/v1/img2img`, {
                timeout: timeOut,
                headers: header1,
                data: payload
              });
            } else {
              // txt2imgAPI
              response = await ctx.http('post', `${endpoint}/sdapi/v1/txt2img`, {
                timeout: timeOut,
                headers: header1,
                data: payload
              });
            }
            log.debug('绘画API响应状态:', response.statusText);
            let imgBase: string = response.data.images[0];
            // log.debug(image); // 开发其他平台时做参考


            //// 聊天记录 ////
            const attrs: Dict<any, string> = {
              userId: session.userId,
              nickname: session.author?.nick || session.username,
            };
            const msgCol = h('figure');


            //// 审核 ////
            let response2: HTTP.Response<any>
            let imgBuffer: Buffer
            if (censor) {
              const payload3 = {
                image: imgBase,
                config: {
                  mask_type: maskType,
                  ...(color !== undefined && { color: color }),
                  ...(maskShape !== undefined && { mask_shape: maskShape }),
                  ...(maskScale !== undefined && { mask_scale: maskScale }),
                  ...(blurStrength !== undefined && { blur_strength: blurStrength }),
                  ...(gradualRatio !== undefined && { gradual_ratio: gradualRatio }),
                  labels: labels,
                },
              }

              session.send('审核中......');
              response2 = await ctx.http('POST', `${cEndpoint}/detect`, {
                timeout: timeOut,
                data: payload3,
                headers: header1,
              });
              const boxes = response2.data?.detections?.length;

              log.debug('是否过审:', !boxes);
              if (boxes) {
                if (!mask && outMeth !== '详细信息') {
                  session.send('图片违规');
                  return; // 阻止图片输出
                }
                imgBuffer = Buffer.from(response2.data.image, 'base64');
              } else imgBuffer = Buffer.from(imgBase, 'base64');
            } else imgBuffer = Buffer.from(imgBase, 'base64');


            //// 输出 ////
            if (outMeth === '仅图片') return h.img(imgBuffer, 'image/png');
            else {
              msgCol.children.push(h.img(imgBuffer, 'image/png'));
              if (outMeth === '关键信息') {
                msgCol.children.push(h('message', attrs, `使用 ${servers.indexOf(endpoint)}号 服务器`));
                msgCol.children.push(h('message', attrs, `步数:${steps}\n尺寸:${size[0]}×${size[1]}\n服从度:${cfg}\n采样器:${smpName}\n调度器:${schName}`));
                if (_ !== '') msgCol.children.push(h('message', attrs, `正向提示词:\n${tmpPrompt}`));
                if (options?.negative !== '') msgCol.children.push(h('message', attrs, `负向提示词:\n${tmpNegPrompt}`));
              }
              if (outMeth === '详细信息') {
                msgCol.children.push(h('message', attrs, JSON.stringify(response.data.parameters, null, 4)))
                msgCol.children.push(h('message', attrs, JSON.stringify(response2.data.detections, null, 4)));
              };
              return msgCol;
            }

          } catch (error) {
            log.error('生成图片出错:', error);
            if (error?.data?.detail === 'Invalid encoded image') return '请引用自己发送的图片或检查图片链接';
            if (error?.response?.data?.detail) return `请求出错: ${error.response.data.detail}`;
            if (outMeth === '详细信息') return error;
            return `生成图片出错: ${error.message}`.replace(/(https?:\/\/)?([0-9.]+|[^/:]+):(\d+)/g, (_, protocol, host, port) => {
              let maskedHost: string;
              if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
                // 处理IP
                const ipParts = host.split('.');
                maskedHost = [ipParts[0], '***', '***', ipParts[3]].join('.');
              } else {
                // 处理域名
                const domainParts = host.split('.');
                maskedHost = ['***', domainParts[domainParts.length - 1]].join('.');
              }
              // 处理端口
              const maskedPort = port.slice(0, -3) + '***';
              return `${protocol ? protocol : ''}://${maskedHost}:${maskedPort}`;
            });
          }
        }

        taskNum++;
        session.send(await process());
        taskNum--;
        if (monetary && sdMonetary) ctx.monetary.cost(userAid, sdMonetary);
      } else {
        // 超过最大任务数的处理逻辑
        session.send(Random.pick([
          '等会再约稿吧，我已经忙不过来了......',
          '是数位板没电了，才…才不是我不想画呢！',
          '那你得先教我画画（理直气壮',
        ]));
      }
    });




  // 注册 Endpoint Interrogate 指令
  ctx.command('sd').subcommand('sdtag [imgURL]', '图片生成提示词')
    .option('model', '-m <model_name> 使用的模型')
    .option('threshold', '-t <float> 提示词输出置信度')
    .option('server', '-x <number> 指定服务器编号')
    .action(async ({ options, session }, _) => {
      if (!maxTasks || taskNum < maxTasks) {
        log.debug('调用反推 API');
        log.debug('选择子选项:', options);

        const wdMonetary = config.monetary.wd;
        let userAid: number;
        if (monetary && wdMonetary) {
          userAid = (await ctx.database.get('binding', { pid: [session.userId] }, ['aid']))[0]?.aid;
          const balance = (await ctx.database.get('monetary', { uid: userAid }, ['value']))[0]?.value;
          if (balance < wdMonetary || balance === undefined || !ctx.monetary) {
            ctx.monetary.gain(userAid, 0);
            return '当前余额不足，请联系管理员充值VIP /doge/doge'
          }
        }

        let endpoint = selectServer();
        if (options?.server)
          if (options.server < servers.length)
            endpoint = servers[options.server];
          else {
            endpoint = servers[0];
            session.send('不存在该序列节点，自动选择0号节点')
          }

        // 获取图片
        log.debug('获取图片');

        const hasProtocol = (imgUrl: string): boolean => /^(https?:\/\/)/i.test(imgUrl);
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
            '开始反推提示词......',
            '在推了在推了......',
            '让我仔细想想......',
            '我在想想想了......',
          ]))
        } else {
          session.send(`在推了在推了，不过前面还有 ${taskNum} 个任务......`)
        }

        // Interrogateapi
        async function process() {
          const { tagger, threshold } = config.WD;

          const payload = {
            image: _,
            model: options?.model || tagger,
            threshold: options?.threshold || threshold
          };
          // log.debug('API请求体:', payload);
          try {
            const response = await ctx.http('post', `${endpoint}/tagger/v1/interrogate`, {
              timeout: timeOut,
              headers: header1,
              data: payload
            });
            // log.debug('响应结果', response);
            log.debug('反推API响应状态:', response.statusText);
            const { general, sensitive, questionable, explicit } = response.data.caption;
            const result = Object.keys(response.data.caption).slice(4).join(', ');

            const toFixed2 = (num: number) => parseFloat(num.toFixed(4));
            const [gen, sen, que, exp] = [general, sensitive, questionable, explicit].map(toFixed2);

            log.debug(`普通性: ${gen}\n敏感性: ${sen}\n可疑性: ${que}\n暴露性: ${exp}`);

            // 聊天记录
            const attrs: Dict<any, string> = {
              userId: session.userId,
              nickname: session.author?.nick || session.username,
            };
            const msgCol = h('figure');

            msgCol.children.push(h('message', attrs, `使用 ${servers.indexOf(endpoint)}号 服务器`));
            msgCol.children.push(h('message', attrs, `反推结果:\n${result}`));

            return msgCol;
          } catch (error) {
            log.error('反推出错:', error);
            if (error?.data?.detail === 'Invalid encoded image') return '请引用自己发送的图片或检查图片链接';
            return `反推出错: ${error.message}`.replace(/https?:\/\/[^/]+/g, (url) => {
              return url.replace(/\/\/[^/]+/, '//***');
            });
          }
        }

        taskNum++;
        session.send(await process());
        taskNum--;
        if (monetary && wdMonetary) ctx.monetary.cost(userAid, wdMonetary);
      } else {
        session.send(Random.pick([
          '这个任务有点难，我不想接>_<',
          '脑子转不过来了，啊吧啊吧--',
          '推导不出来，你来推吧！'
        ]));
      }
    });




  // 注册 Interruptapi 指令
  ctx.command('sd').subcommand('sdstop <server_number:number>', '中断当前操作')
    .action(async ({ }, server_number) => {
      if (!server_number) return '请指定服务器编号';
      try {
        log.debug('调用中断 API');

        const endpoint = servers[server_number];

        // Interruptapi
        const response = await ctx.http('post', `${endpoint}/sdapi/v1/interrupt`, {
          timeout: timeOut,
        });

        // log.debug('API响应结果:', response);

        taskNum--;
        return `${response}`;
      } catch (error) {
        log.error('错误:', error.detail);
        return `错误: ${error.message}`.replace(/https?:\/\/[^/]+/g, (url) => {
          return url.replace(/\/\/[^/]+/, '//***');
        });
      }
    });




  // 注册 GetModels 指令
  ctx.command('sd').subcommand('sdmodel [sd_name] [vae_name]', '查询和切换模型')
    .usage('输入名称时为切换模型，缺失时为查询模型')
    .option('server', '-x <number> 指定服务器编号')
    .option('sd', '-s 查询/切换SD模型')
    .option('vae', '-v 查询/切换Vae模型')
    .option('embeddeding', '-e 查询可用的嵌入模型')
    .option('hybridnetwork', '-n 查询可用的超网络模型')
    .option('lora', '-l 查询可用的loras模型')
    .option('wd', '-w 查询可用的WD模型')
    .action(async ({ options, session }, _1?, _2?) => {
      log.debug('选择子选项', options)

      if (!Object.keys(options).length) {
        log.debug('没有选择子选项，退回');
        return '请选择指令的选项！';
      }

      if (!Object.keys(options).includes('server')) {
        return `请指定服务器编号，当前可用:\n${servStr}`;
      }

      // 选择服务器
      let endpoint = selectServer();
      if (options.server < servers.length) endpoint = servers[options.server];
      else {
        endpoint = servers[0];
        session.send('不存在该序列节点，自动选择0号节点')
      }

      const sdName = _1;
      const vaeName = _2;
      const sd = options?.sd;
      const vae = options?.vae;
      const emb = options?.embeddeding;
      const hybNet = options?.hybridnetwork;
      const lora = options?.lora;
      const wd = options?.wd;

      // 聊天记录
      const attrs: Dict<any, string> = {
        userId: session.userId,
        nickname: session.author?.nick || session.username,
      };
      const msgCol = h('figure');

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
            return `模型: ${model.model_name}\n文件: ${fileName}`;
          }).join('\n\n');

          if (result) {
            msgCol.children.push(h('message', attrs, result));
            return msgCol;
          } else return `未查询到可用的${sd ? 'SD' : 'SD VAE'}模型。`;
        }
        // 切换
        else if (!maxTasks || taskNum < maxTasks) {
          if ((_1 || _2) && (sd || vae)) {
            async function process() {
              try {
                log.debug('调用切换模型 API');
                const payload = {
                  ...(sdName && { sd_model_checkpoint: _1 }),
                  ...(vaeName && { sd_vae_checkpoint: _2 }),
                }

                session.send('模型切换中......')

                const response = await ctx.http('post', `${endpoint}/sdapi/v1/options`, {
                  timeout: timeOut,
                  headers: header1,
                  data: payload
                });
                log.debug('切换模型API响应状态:', response.statusText);

                if (response.status === 200) return '模型更换成功'; else return `模型更换失败: ${response.statusText}`;
              } catch (error) {
                log.error('切换模型时出错:', error);
                return `切换模型时出错: ${error.message}`;
              }
            }

            taskNum++;
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

        if (emb) {
          log.debug('调用查询嵌入模型 API');
          const response = await ctx.http('get', `${endpoint}/sdapi/v1/embeddings`, { headers: header2 });
          log.debug('查询嵌入模型API响应状态:', response.statusText);
          const embs = response.data;

          const loadedEmbs = Object.keys(embs.loaded).map(key => `可加载的嵌入: ${key}`).join('\n');
          const skippedEmbs = Object.keys(embs.skipped).map(key => `不兼容的嵌入: ${key}`).join('\n');
          const result = `${loadedEmbs}\n\n${skippedEmbs}`;

          if (result) {
            msgCol.children.push(h('message', attrs, result));
            return msgCol;
          } else return '未查询到嵌入模型信息。';
        }

        if (hybNet) {
          log.debug('调用查询超网络模型 API');
          const response = await ctx.http('get', `${endpoint}/sdapi/v1/hypernetworks`, { headers: header2 });
          log.debug('查询超网络模型API响应状态:', response.statusText);
          const hybNets = response.data;

          const result = hybNets.map((hn: { filename: string; model_name: string }) => {
            const filename = extractFileName(hn.filename);
            return `模型: ${hn.model_name}\n文件: ${filename}`;
          }).join('\n\n');

          if (result) {
            msgCol.children.push(h('message', attrs, result));
            return msgCol;
          } else return '未查询到超网络模型信息。';
        }

        if (lora) {
          log.debug('调用查询Lora模型 API');
          const response = await ctx.http('get', `${endpoint}/sdapi/v1/loras`, { headers: header2 });
          log.debug('查询Lora模型API响应状态:', response.statusText);
          const loras = response.data;

          const result = loras.map((lora: { filename: string; model_name: string; }) => {
            const fileName = extractFileName(lora.filename);
            return `模型: ${lora.model_name}\n文件: ${fileName}`;
          }).join('\n\n');

          if (result) {
            msgCol.children.push(h('message', attrs, result));
            return msgCol;
          } else return `未查询到Lora模型信息。`;
        }

        if (wd) {
          log.debug('调用查询WD模型 API');
          const response = await ctx.http('get', `${endpoint}/tagger/v1/interrogators`, { headers: header2 });
          log.debug('查询WD模型API响应状态:', response.statusText);
          const models = response.data.models;

          const result = models.map((modelName: string) => `模型: ${modelName}`).join('\n\n');
          if (result) {
            msgCol.children.push(h('message', attrs, result));
            return msgCol;
          } else return `未查询到WD模型信息。`;
        }


      } catch (error) {
        log.error('查询模型时出错:', error);
        return `查询模型时出错: ${error.message}`.replace(/https?:\/\/[^/]+/g, (url) => {
          return url.replace(/\/\/[^/]+/, '//***');
        });
      }
    });




  // 注册 Set Config 指令
  ctx.command('sd').subcommand('sdset <configData>', '修改SD全局设置', {
    checkUnknown: true,
    checkArgCount: true
  })
    .option('server', '-x <number> 指定服务器编号')
    .action(async ({ options, session }, configData) => {
      if (config.setConfig) {
        if (taskNum === 0) {

          if (!Object.keys(options).includes('server')) {
            return `请指定服务器编号，当前可用:\n${servStr}`;
          }

          // 选择服务器
          let endpoint = selectServer();
          if (options.server < servers.length) endpoint = servers[options.server];
          else {
            endpoint = servers[0];
            session.send('不存在该序列节点，自动选择0号节点')
          }

          async function process() {
            try {
              log.debug('调用修改设置 API');
              const response = await ctx.http('post', `${endpoint}/sdapi/v1/options`, {
                timeout: timeOut,
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
              return `设置配置时出错: ${error.message}`.replace(/https?:\/\/[^/]+/g, (url) => {
                return url.replace(/\/\/[^/]+/, '//***');
              });;
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




  // 列出可用的基础设置
  ctx.command('sd').subcommand('sdlist [s1s2s3s4s5]', '查询服务器、采样器、调度器、AD模型、WD模型列表')
    .option('server', '-x <number> 指定服务器编号')
    .action(({ options, session }, s1s2s3s4s5) => {

      if (!Object.keys(options).includes('server')) {
        return `请指定服务器编号，当前可用:\n${servStr}`;
      }

      // 选择服务器
      let endpoint = selectServer();
      if (options.server < servers.length) endpoint = servers[options.server];
      else {
        endpoint = servers[0];
        session.send('不存在该序列节点，自动选择0号节点')
      }

      switch (s1s2s3s4s5) {
        case 's1':
          return `服务器列表:\n${servStr}`;
        case 's2':
          return `采样器列表:\n${samplerL.join('\n')}`;
        case 's3':
          return `调度器列表:\n${schedulerL.join('\n')}`;
        case 's4':
          return `AD模型列表:\n${ad_modelL.join('\n')}`;
        case 's5':
          return `WD模型列表:\n${wd_modelL.join('\n')}`;
        default:
          return '请选择s1/s2/s3/s4/s5';
      }
    })

}