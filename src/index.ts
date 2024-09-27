import { Context, Dict, h, HTTP, Random, Session } from 'koishi';
import { } from 'koishi-plugin-monetary'
import { checkBalance, promptHandle, download } from './utils'
import { Config, log } from './config';
import { samplerL, schedulerL, ad_modelL, wd_modelL } from './list';

export const name = 'sd-painter';
export const inject = {
  required: ['http'],
  optional: ['translator', 'dvc', 'database', 'monetary']
}
export * from './config'

export const usage = `
---
**免责声明**

感谢您使用我们的插件！请您仔细阅读以下条款，以确保您了解并接受我们的政策：

1. **图片使用**：本插件用于发送由 Stable Diffusion WebUI API 生成的图片。所有图片仅供娱乐和个人使用，不得用于商业目的或侵犯他人的版权。
2. **隐私保护**：本插件不会收集或保存用户的个人信息。请确保上传到插件的图片不包含敏感或个人隐私信息。
3. **法律责任**：使用者必须遵守当地法律法规，尤其是关于版权的规定。若因违反相关规定而产生的任何法律后果，均由使用者自行承担。
4. **禁止不当内容**：严禁使用本插件发送色情、暴力、仇恨言论等非法或不当内容。
5. **技术支持**：我们不对插件的技术问题承担责任，但会尽力提供支持和维护。
6. **免责声明更新**：我们保留随时修改本声明的权利，请及时更新插件以获取最新版本的免责声明。**若因未及时更新插件而导致的责任和损失，本方概不负责**。
7. **解释权归属**：本声明的最终解释权归插件开发者所有。

通过使用本插件，即视为**同意上述条款**。请确保您已经仔细阅读并理解以上内容。

---
### 插件功能
* 功能 1：文/图生图
* 功能 2：中止生成
* 功能 3：HiresFix 部分功能
* 功能 4：WD1.4 Tagger 部分功能
* 功能 5：ADetailer 部分功能
* 功能 6：查询/切换模型
* 功能 7：修改配置(未测试)
* 功能 8：图片审核(测试版)，见 [imgCensor](https://github.com/Kx501/koishi-plugin-imgcensor)

### 注意事项
1. 子指令只能直接调用
2. 默认使用的是秋葉整合包
3. 翻译服务只测试了 [百度翻译](https://api.fanyi.baidu.com/api/trans/product/desktop)
4. dvc 只测试了 [DeepSeek](https://github.com/Kx501/koishi-plugin-imgcensor) 效果不错
5. 默认指令较多，建议在指令管理中个性化配置
`;

// 插件主函数
export function apply(ctx: Context, config: Config) {
  ctx.on('message-created', (session: Session) => {
    log.debug(JSON.stringify(session, null, 2))
    log.debug(h.select(session?.elements, 'img')[0]?.attrs?.src)
    log.debug(JSON.stringify(h.select(session?.quote?.elements, 'img'), null, 2))
  }, true)

  ctx.middleware((session, next) => {
    if (config.closingMode.enable) return config.closingMode.tips;
    else return next();
  }, true /* true 表示这是前置中间件 */)

  const { timeOut, outputMethod: outMeth, maxTasks } = config;
  const { sampler, scheduler } = config.IMG;
  const monetary = config.monetary.enable;
  const { enable: censor, endpoint: cEndpoint, labels, threshold: cThreshold } = config.censor;
  const { type: maskType, color, maskShape, maskScale, blurStrength, gradualRatio } = config.censor?.mask ?? {};

  const header1 = {
    'accept': 'application/json',
    'Content-Type': 'application/json',
  };
  const header2 = {
    'accept': 'application/json',
  };

  let taskNum = 0;
  let failProcess = false;
  const servers = config.endpoint;
  const serverStatus = new Map<string, string>();
  const busyServerCounts = new Map<string, number>();
  for (const server of servers) {
    serverStatus.set(server, 'free'); // 默认所有服务器空闲
    busyServerCounts.set(server, 0);
  }

  const servStr = servers.map((_, index) => `服务器 ${index}`).join('、'); // 作消息输出




  // 注册 text2img/img2img 指令
  // k l q u w y, h不可用
  ctx.command('sd [tags]', 'AI画图')
    .option('negative', '-n <tags> 负向提示词')
    .option('img2img', '-i [imgURL] 图生图，@图片|输入链接|发送图片')
    .option('steps', '-s <number> 迭代步数')
    .option('cfgScale', '-c <float> 提示词服从度')
    .option('size', '-z <宽x高> 图像尺寸')
    .option('seed', '-e <number> 随机种子')
    .option('sampler', '-p <name> 采样器')
    .option('scheduler', '-d <name> 调度器')
    .option('translate', '-t 翻译')
    .option('dvc', '-v GPT翻译扩写提示词')
    .option('hiresFix', '-f 高分辨率修复')
    .option('fixAlgorithm', '-m <name> 修复算法')
    .option('secondPassSteps', '-b <number> 修复步数')
    .option('denoisingStrength', '-o <float> 修复降噪强度')
    .option('hrScale', '-r <float> 修复比例') // 目前只写了一种
    .option('adetailer', '-a ADetailer扩展')
    .option('server', '-x <number> 指定服务器编号')
    .option('noPositiveTags', '-G 禁用默认正向提示词')
    .option('noNegativeTags', '-J 禁用默认负向提示词')
    // .option('restoreFaces', '-R 禁用人脸修复')
    // .option('model', '-m <model_name> 单次切换SD模型')
    // .option('vae', '-v <vae_name> 单次切换Vae模型')
    .usage('若参数有空格，首尾用引号括起来\n图生图@图片，-i 放在指令末尾')
    .action(async ({ options, session }, _) => {
      if (!maxTasks || taskNum < maxTasks) {
        log.debug('调用绘图 API');
        log.debug('选择子选项:', options);

        //// 经济系统 ////
        const sdMonetary = config.monetary.sd;
        const userAid = await checkBalance(ctx, session, monetary, sdMonetary);
        if (typeof userAid === 'string') return userAid; // 余额不足

        //// 读取配置 ////
        const { save, imgSize, cfgScale, txt2imgSteps: t2iSteps, img2imgSteps: i2iSteps, maxSteps, prePrompt: preProm, preNegPrompt: preNegProm, restoreFaces: resFaces } = config.IMG;
        const { enable: enableHiresFix, hrUpscaler, hrSecondPassSteps: hrSteps, denoisingStrength, fixWay } = config.IMG?.hiresFix
        const { type: hiresFixType, hrScale, hrResizeX, hrResizeY } = fixWay ?? {}
        const adEnable = config.AD.ADetailer.enable;
        const useTrans = config.useTranslation.enable;

        // 选择服务器
        let endpoint = selectServer(session, options?.server);
        if (endpoint === '离线')
          if (options?.server) return '所选服务器离线';
          else return '所有服务器离线';

        //// 参数处理 ////
        // 检查图生图参数
        let initImages = options?.img2img;
        let imgUrl: string;
        if (options.hasOwnProperty('img2img')) {
          log.debug('获取图片......');
          const hasProtocol = (imgUrl: string): boolean => /^(https?:\/\/)/i.test(imgUrl);  // 直接输入链接
          if (!hasProtocol(initImages)) {
            if (['qq', 'qqguild'].includes(session.platform)) return '该平台暂不支持图生图';
            // else if (session.platform.includes('sandbox')) initImages = h.select(session?.quote?.content, 'img')[0]?.attrs?.src.split(',')[1];   // 沙盒
            else {
              imgUrl = h.select(session?.quote?.elements, 'img')[0]?.attrs?.src;
              if (!imgUrl) imgUrl = h.select(session?.elements, 'img')[0]?.attrs?.src;
            }
          }
          initImages = (await download(ctx, imgUrl)).base64;
          if (initImages.info) return initImages.info;;
          // log.debug('图生图图片参数处理结果:', initImages);
        }

        // 用户选项覆盖默认配置
        const steps = options?.steps || (initImages ? i2iSteps : t2iSteps);
        const cfg = options?.cfgScale || cfgScale;
        const size = options?.size ? options?.size.split('x').map(Number) : imgSize;
        const seed = options?.seed || Math.floor(Math.random() * Math.pow(2, 32));
        const smpName = options?.sampler || sampler;
        const schName = options?.scheduler || scheduler;
        const noPosTags = options?.noPositiveTags;
        const noNegTags = options?.noNegativeTags;
        const Trans = options?.translate && useTrans;
        const DVC = options?.dvc && config.useDVC.enable;
        // const modelName = options?.model;
        // const vaeName = options?.vae;
        const hiresFix = !options?.img2img && options.hiresFix && enableHiresFix;
        const hiresAlgorithm = options?.fixAlgorithm || hrUpscaler;
        const hrFixType = options?.hrScale ? '比例放大' : hiresFixType;
        const hiresSteps = options?.secondPassSteps || hrSteps;
        const hiresDenoising = options?.denoisingStrength || denoisingStrength;
        const hiresScale = options?.hrScale || hrScale;

        // 翻译
        let tmpProm = _ || '';
        let tmpNegProm = options?.negative || '';
        tmpProm = await promptHandle(ctx, session, config, tmpProm, Trans, DVC);
        tmpNegProm = await promptHandle(ctx, session, config, tmpNegProm, Trans, DVC);

        // 确定位置
        let { prompt: prom, negativePrompt: negProm } = config.IMG;

        if (!noPosTags && prom)
          if (tmpProm === '') tmpProm = prom;
          else {
            const nedCom = preProm ? !prom.endsWith(',') && !prom.endsWith('\n') : !tmpProm.endsWith(',') && !tmpProm.endsWith('\n');
            const comma = nedCom ? ',' : '';
            tmpProm = preProm ? prom + comma + tmpProm : tmpProm + comma + prom;
          }

        if (!noNegTags && negProm)
          if (tmpNegProm === '') tmpNegProm = negProm;
          else {
            const nedCom = preNegProm ? !negProm.endsWith(',') && !negProm.endsWith('\n') : !tmpNegProm.endsWith(',') && !tmpNegProm.endsWith('\n');
            const comma = nedCom ? ',' : '';
            tmpNegProm = preNegProm ? negProm + comma + tmpNegProm : tmpNegProm + comma + negProm;
          }


        //// 使用 ADetailer ////
        let payload2 = {};

        if (!options?.adetailer && adEnable) {
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
        };

        // API请求体
        const payload1 = {
          ...(prom !== '' && { prompt: tmpProm }),
          ...(negProm !== '' && { negative_prompt: tmpNegProm }),
          seed: seed,
          sampler_name: smpName,
          scheduler: schName,
          steps: Math.min(steps, maxSteps),
          ...((prom !== '' || negProm !== '') && { cfg_scale: cfg }),
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
        };

        const payload = {
          ...payload1,
          ...payload2
        };

        log.debug('API请求体:', payload);

        if (taskNum === 0) {
          session.send(Random.pick([
            '在画了在画了',
            '你就在此地不要走动，等我给你画一幅',
            '少女绘画中......',
            '正在创作中，请稍等片刻',
            '笔墨已备好，画卷即将展开'
          ]))
        } else session.send(`在画了在画了，当前 ${taskNum + 1} 个任务......`)

        //// 开始请求 ////
        async function process() {
          try {
            //// 调用绘画API ////
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
            // log.debug(imgBase); // 开发其他平台时做参考


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
                  score: cThreshold
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
                if (maskType === 'None' && outMeth !== '详细信息') {
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
              msgCol.children.push(h('message', attrs, `使用 ${servers.indexOf(endpoint)}号 服务器`));
              if (outMeth === '关键信息') {
                msgCol.children.push(h('message', attrs, `步数:${steps}\n尺寸:${size[0]}×${size[1]}\n服从度:${cfg}\n采样器:${smpName}\n调度器:${schName}\n种子:${seed}`));
                if (tmpProm) msgCol.children.push(h('message', attrs, `正向提示词:\n${tmpProm}`));
                if (tmpNegProm) msgCol.children.push(h('message', attrs, `负向提示词:\n${tmpNegProm}`));
              }
              if (outMeth === '详细信息') {
                msgCol.children.push(h('message', attrs, JSON.stringify(response.data.parameters, null, 4)))
                msgCol.children.push(h('message', attrs, JSON.stringify(response2?.data?.detections, null, 4)));
              };
              return msgCol;
            }

          } catch (error) {
            log.error('生成图片出错:', error);
            return handleServerError(error);
          }
        }

        start(endpoint);
        session.send(await process());
        end(endpoint);
        if (monetary && sdMonetary && !failProcess) {
          failProcess = false;
          ctx.monetary.cost(userAid, sdMonetary);
        }
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
        const userAid = await checkBalance(ctx, session, monetary, wdMonetary);
        if (typeof userAid === 'string') return userAid; // 余额不足

        let endpoint = selectServer(session, options?.server);
        if (endpoint === '离线')
          if (options?.server) return '所选服务器离线';
          else return '所有服务器离线';

        // 获取图片
        log.debug('获取图片......');

        let imgUrl: string;
        const hasProtocol = (imgUrl: string): boolean => /^(https?:\/\/)/i.test(imgUrl);  // 直接输入链接
        if (!hasProtocol(_)) {
          // else if (session.platform.includes('sandbox')) initImages = h.select(session?.quote?.content, 'img')[0]?.attrs?.src.split(',')[1];   // 沙盒
          imgUrl = h.select(session?.quote?.elements, 'img')[0]?.attrs?.src;
          if (!imgUrl) imgUrl = h.select(session?.elements, 'img')[0]?.attrs?.src;

        }
        let tmp_ = await download(ctx, imgUrl);
        if (tmp_.info) return tmp_.info;
        else _ = tmp_.base64;

        if (taskNum === 0) {
          session.send(Random.pick([
            '开始反推提示词......',
            '在推了在推了......',
            '让我仔细想想......',
            '我在想想想了......',
          ]))
        } else session.send(`在推了在推了，当前 ${taskNum + 1} 个任务......`)

        // Interrogateapi
        async function process() {
          const { tagger, threshold: wThreshold } = config.WD;

          const payload = {
            image: _,
            model: options?.model || tagger,
            threshold: options?.threshold || wThreshold
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
            log.debug('反推出错：', error);
            return handleServerError(error);
          }
        }

        start(endpoint);
        session.send(await process());
        end(endpoint);
        if (monetary && wdMonetary && !failProcess) {
          failProcess = false;
          ctx.monetary.cost(userAid, wdMonetary);
        }
      } else {
        session.send(Random.pick([
          '这个任务有点难，我不想接>_<',
          '脑子转不过来了，啊吧啊吧--',
          '推导不出来，你来推吧！'
        ]));
      }
    });




  // 注册 Interruptapi 指令
  ctx.command('sd').subcommand('sdstop <server_number:number>', '中断当前操作', {
    checkUnknown: true,
    checkArgCount: true
  })
    .action(async ({ }, server_number) => {
      if (server_number === undefined)`请指定服务器编号，当前可用:\n${servStr}`;
      try {
        log.debug('调用中断 API');

        const endpoint = servers[server_number];

        // Interruptapi
        const response = await ctx.http('post', `${endpoint}/sdapi/v1/interrupt`, {
          timeout: timeOut,
        });

        // log.debug('API响应结果:', response);

        return response.statusText;
      } catch (error) {
        log.error('终止任务出错:', error);
        return handleServerError(error);
      }
    });




  // 注册 GetModels 指令
  ctx.command('sd').subcommand('sdmodel <server_number> [sd_name] [vae_name]', '查询和切换模型，支持单个参数')
    .usage('输入名称时为切换模型，缺失时为查询模型')
    .option('sd', '-s 查询/切换SD模型')
    .option('vae', '-v 查询/切换Vae模型')
    .option('embeddeding', '-e 查询可用的嵌入模型')
    .option('hybridnetwork', '-n 查询可用的超网络模型')
    .option('lora', '-l 查询可用的loras模型')
    .option('wd', '-w 查询可用的WD模型')
    .action(async ({ options, session }, _, _1?, _2?) => {
      log.debug('选择子选项', options)

      if (!Object.keys(options).length) {
        log.debug('没有选择子选项，退回');
        return '请选择指令的选项！';
      }

      if (!_) return `请指定服务器编号，当前可用:\n${servStr}`;

      // 选择服务器
      const endpoint = servers[_];

      let sdName: string, vaeName: string;
      const sd = options?.sd;
      const vae = options?.vae;
      const emb = options?.embeddeding;
      const hybNet = options?.hybridnetwork;
      const lora = options?.lora;
      const wd = options?.wd;

      if (_2 === undefined) {
        if (options?.sd) {
          sdName = _1;
        }
        if (options?.vae) {
          vaeName = _1;
        }
      } else {
        sdName = _1;
        vaeName = _2;
      }

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
                  ...(sdName && { sd_model_checkpoint: sdName }),
                  ...(vaeName && { sd_vae: vaeName }),
                }
                log.debug(`sdmodel: ${sdName}, vaeName: ${vaeName}`);

                session.send('模型切换中......')

                const response = await ctx.http('post', `${endpoint}/sdapi/v1/options`, {
                  timeout: timeOut,
                  headers: header1,
                  data: payload
                });
                log.debug('切换模型API响应状态:', response.statusText);

                if (response.status === 200) return '模型更换成功'; else return `模型更换失败: ${response.statusText}`;
              } catch (error) {
                log.error('切换模型出错:', JSON.stringify(error, null, 4));
                return handleServerError(error);
              }
            }

            start(endpoint);
            session.send(await process());
            end(endpoint);
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
        log.error('查询模型出错:', error);
        return handleServerError(error);
      }
    });




  // 注册 Set Config 指令
  ctx.command('sd').subcommand('sdset <server_number> <settings>', '修改SD全局设置', {
    checkUnknown: true,
    checkArgCount: true
  })
    .action(async ({ options, session }, server_number, settings) => {
      if (config.setConfig) {
        if (taskNum === 0) {

          if (server_number === undefined)`请指定服务器编号，当前可用:\n${servStr}`;

          // 选择服务器
          const endpoint = servers[server_number];

          async function process() {
            try {
              log.debug('调用修改设置 API');
              const response = await ctx.http('post', `${endpoint}/sdapi/v1/options`, {
                timeout: timeOut,
                data: JSON.parse(settings),
                headers: { 'Content-Type': 'application/json' },
              });
              log.debug('API响应状态:', response.statusText);

              return '配置已成功设置。';
            } catch (error) {
              log.error('设置全局配置出错:', JSON.stringify(error, null, 4));
              if (error.response?.status === 422) return '配置数据验证错误，请检查提供的数据格式。';
              return handleServerError(error);
            }
          }

          start(endpoint);
          session.send(await process());
          end(endpoint);
        } else session.send('当前有任务在进行，请等待所有任务完成');
      } else session.send('管理员未启用该设置');
    });




  // 列出可用的基础设置
  ctx.command('sd').subcommand('sdlist [s1s2s3s4s5]', '查询服务器、采样器、调度器、AD模型、WD模型列表，暂不支持自定义模型')
    .action(({ options }, s1s2s3s4s5) => {

      if (!Object.keys(options).includes('server')) {
        return `请指定服务器编号，当前可用:\n${servStr}`;
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




  /**
   * 选择一个空闲的服务器进行轮询。
   * 
   * @param session 当前会话
   * @param servIndex 可选参数，手动指定服务器编号，可以重新激活离线服务器。
   * @returns 空闲服务器的地址/‘离线’
   * 
   * 说明：
   * - 服务器状态包括：
   *   - 空闲：服务器可以接受新任务。
   *   - 忙碌：服务器正在处理任务。
   *   - 离线：服务器不可用，不应接收新任务。
   * 
   * - 如果没有提供 `servIndex` 参数，则进入轮询逻辑。
   * - 如果所有服务器都是离线状态，返回。
   * - 如果所有服务器都是忙碌状态，选择任务数最少的。
   */
  function selectServer(session: Session, servIndex?: number): string {
    // 记录不同状态的服务器
    let freeServers: string[] = [];
    let busyServers: string[] = [];
    let offlineServers: string[] = [];

    // 初始化服务器状态
    for (const server of servers) {
      const status = serverStatus.get(server);
      if (status === 'free') freeServers.push(server);
      else if (status === 'busy') busyServers.push(server);
      else if (status === 'offline') offlineServers.push(server);
    }

    // 检查是否提供了server选项，因为0所以用undifined
    if (servIndex !== undefined)
      if (servIndex < servers.length) {
        const server = servers[servIndex];
        log.debug(`选择 ${servIndex}号 服务器: ${server}`);
        return server;
      } else session.send('不存在该序列节点，自动选择一个空闲服务器');

    // 如果所有服务器都离线，直接返回
    if (offlineServers.length === servers.length) return '离线';

    // 如果有空闲服务器，返回第一个空闲服务器
    if (freeServers.length > 0) {
      const freeServer = freeServers[0];
      log.debug(`选择空闲服务器: ${freeServer}`);
      return freeServer;
    }

    // 如果没有空闲服务器，选择任务数最少的服务器
    let minCount = Infinity;
    let selectedServer = null;
    for (const busyServer of busyServers) {
      const count = busyServerCounts.get(busyServer);
      if (count < minCount) {
        minCount = count;
        selectedServer = busyServer;
      }
    }
    if (selectedServer) {
      busyServerCounts.set(selectedServer, minCount + 1);
      log.debug(`选择忙碌服务器: ${selectedServer}`);
      return selectedServer;
    }

    // 返回错误信息
    throw new Error('轮询时出错，无法分配任务');
  }


  /**
   * 根据错误信息中的 URL 更新服务器状态。
   * @param error 错误对象
   * @returns 处理后的错误消息
   */
  function handleServerError(error: any): string {
    failProcess = true;
    let detail: any;
    if (error?.data?.detail) detail = error.data.detail;
    if (error?.response?.data?.detail) {
      detail = error.response.data.detail;
      if (Array.isArray(detail)) {
        detail = detail.map(item => {
          const { loc, msg, type } = item;
          return `定位: ${loc.join(' -> ')},\n信息: ${msg},\n 类型: ${type}`;
        });
      } else if (typeof detail === 'object') detail = JSON.stringify(detail, null, 4);
      ;
    }
    if (error?.cause?.code) detail = error.cause.code;

    detail = error.message;
    const urlPattern = /(?:https?:\/\/)[^ ]+/g;
    const match = detail.match(urlPattern);

    if (match && match[0]) {
      const fullUrl = match[0];
      const serverAddress = fullUrl.split('/').slice(0, 3).join('/');
      // 确定地址
      const matchingServer = servers.find(s => s === serverAddress);
      if (matchingServer) {
        serverStatus.set(matchingServer, 'offline'); // 标记服务器为离线
        return `${servers.indexOf(matchingServer)}号 服务器已离线`;
      } else {
        // 脱敏处理
        const { protocol, hostname, port } = new URL(fullUrl);
        let maskedHost: string;
        if (/^(\d+(\.\d+){3})$/.test(hostname)) {
          // 处理 IP 地址
          const ipParts = hostname.split('.');
          maskedHost = [ipParts[0], '***', '***', ipParts[3]].join('.');
        } else {
          // 处理域名
          const domainParts = hostname.split('.');
          maskedHost = [domainParts[0], '***', domainParts[domainParts.length - 1]].join('.');
        }
        // 处理端口
        const maskedPort = port.slice(0, -3) + '***';

        const maskedUrl = `${protocol}//${maskedHost}:${maskedPort}`;
        // 替换错误消息中的 URL
        const maskedMessage = detail.replace(urlPattern, maskedUrl);
        return maskedMessage;
      }
    }
    return `请求出错:\n${detail}`;
  }


  // 处理任务
  function start(server: string): void {
    taskNum++;
    serverStatus.set(server, 'busy'); // 先轮询后处理
    busyServerCounts.set(server, (busyServerCounts.get(server)) + 1);
  }


  // 结束任务
  function end(server: string): void {
    taskNum--;
    if (serverStatus.get(server) === 'busy')
      if (busyServerCounts.get(server) === 1) serverStatus.set(server, 'free');
      else busyServerCounts.set(server, (busyServerCounts.get(server)) - 1);
  }

}