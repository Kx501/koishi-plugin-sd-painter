import { Schema, Logger } from 'koishi';
import { samplerL, schedulerL, hr_modelL, ad_modelL, wd_modelL, labelL, mask_typeL } from './list';

export const log = new Logger('sd-webui-api');

export interface Config {
  endpoint: string[]; // API端点
  timeOut: number;
  IMG: {
    save: boolean; // 是否保存到本地
    sampler: string; // 采样器选项
    scheduler: string; // 调度器选项
    imgSize: number[]; // 图片尺寸
    cfgScale: number; // CFG Scale
    // img2img: boolean; // 图生图重绘幅度
    txt2imgSteps: number; // 文生图步骤数
    img2imgSteps: number; // 图生图步骤数
    maxSteps: number; // 最大步骤数（指令允许的最大）
    prompt: string; // 正向提示词
    negativePrompt: string; // 负向提示词
    prePrompt: boolean; // 正向提示词是否前置
    preNegPrompt: boolean; // 负向提示词是否前置
    restoreFaces: boolean; // 人脸修复
    hiresFix: {
      enable?: boolean; // 高分辨率修复
      hrUpscaler?: string; // 修复算法
      hrSecondPassSteps?: number; // 修复步数
      denoisingStrength?: number; // 修复强度
      fixWay?: {
        type?: string; // 缩放方式
        hrScale?: number; // 缩放比例,
        hrResizeX?: number; // 缩放宽度
        hrResizeY?: number; // 缩放高度
      };
    }
  };
  AD: {
    ADetailer: {
      enable?: boolean; // AD修复
      models?: {
        name: string;  // 模型选项
        prompt: string; // 正向提示词
        negativePrompt: string; // 负向提示词
        confidence: number; // 检测置信度
      }[];
    };
  };
  WD: {
    tagger: string; // 图像反推模型
    threshold: number; // 提示词输出置信度
    imgCensor: {
      enable?: boolean; // 用于图像审核
      indicators?: string[]; // 评估指标
      score?: number; // 阈值
    }
  };
  outputMethod: string;  // 输出方式
  maxPrompt: number;  //最大提示词数
  excessHandle: string;  //提示词超限处理方式{
  setConfig: boolean; // 指令修改SD全局设置
  maxTasks: number; // 最大任务数
  monetary: {
    enable?: boolean; // 启用经济系统
    sd?: number;  // 绘画收费
    wd?: number;  // 反推收费
  };
  useTranslation: {
    enable?: boolean; // 是否使用翻译服务
    pronounCorrect?: boolean; //修正翻译后代词
  };
  useDVC: {
    enable?: boolean;
    text?: string;
    rollbackPrompt?: boolean;
  };
  censor: {
    enable?: boolean;
    endpoint?: string;
    labels?: string[];
    threshold?: number;
    mask?: {
      type?: string;
      color?: number[];
      blurStrength?: number;
      maskShape?: string;
      maskScale?: number;
      gradualRatio?: number;
    }
  };
  closingMode: {
    enable?: boolean;
    tips?: string;
  };
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    endpoint: Schema.array(String).role('table').description('SD-WebUI API的地址，可以填多个').experimental(),
    timeOut: Schema.number().default(60000).description('请求超时，设置为0关闭，毫秒').experimental(),
  }).description('基础设置'),
  Schema.object({
    IMG: Schema.object({
      save: Schema.boolean().default(false).description('SD后端保存图片'),
      sampler: Schema.union([
        ...samplerL,
        Schema.string().default('None').description('自定义 <填入名称>'),
      ]).default('DPM++ SDE').description('采样器'),
      scheduler: Schema.union([
        ...schedulerL,
        Schema.string().default('None').description('自定义 <填入名称>'),
      ]).default('Automatic').description('调度器'),
      imgSize: Schema.tuple([Number, Number]).default([512, 512]).description(`宽度和高度(16的倍数)
  - 模板：
  - 256x256、512x512、512x768、768x1280、832x1216、1024x1024、1280x720
  `),
      cfgScale: Schema.number().min(0).max(30).step(0.1).role('slider').default(7).description('引导系数，用于控制图像对提示词服从程度'),
      txt2imgSteps: Schema.number().min(1).max(150).step(1).role('slider').default(20).description('文生图步数'),
      img2imgSteps: Schema.number().min(1).max(150).step(1).role('slider').default(20).description('图生图步数'),
      maxSteps: Schema.number().min(1).max(150).step(1).role('slider').default(40).description('最大允许步数'),
      prompt: Schema.string().role('textarea', { rows: [2, 8] }).default('').description('默认正向提示词'),
      negativePrompt: Schema.string().role('textarea', { rows: [2, 8] }).default('').description('默认负向提示词'),
      prePrompt: Schema.boolean().default(true).description('默认正向提示词是否放在最前面'),
      preNegPrompt: Schema.boolean().default(true).description('默认负向提示词是否放在最前面'),
      restoreFaces: Schema.boolean().default(false).description('人脸修复').disabled(),
      hiresFix: Schema.intersect([
        Schema.object({
          enable: Schema.boolean().default(false).description('高分辨率修复'),
        }),
        Schema.union([
          Schema.object({
            enable: Schema.const(true).required(),
            hrUpscaler: Schema.union([
              ...hr_modelL,
              Schema.string().default('None').description('自定义 <填入名称>'),
            ]).default('Latent').description('修复算法'),
            hrSecondPassSteps: Schema.number().min(0).max(150).step(1).role('slider').default(0).description('步数'),
            denoisingStrength: Schema.number().min(0).max(1).step(0.01).role('slider').default(0.7).description('降噪强度'),
            fixWay: Schema.intersect([
              Schema.object({
                type: Schema.union(['比例放大', '重设尺寸']).description('修复方式'),
              }),
              Schema.union([
                Schema.object({
                  type: Schema.const('比例放大').required(),
                  hrScale: Schema.number().min(1).max(4).step(0.01).role('slider').default(2).description('缩放比例'),
                }),
                Schema.object({
                  type: Schema.const('重设尺寸').required(),
                  hrResizeX: Schema.number().min(0).max(2048).step(16).role('slider').default(0).description('缩放宽度'),
                  hrResizeY: Schema.number().min(0).max(2048).step(16).role('slider').default(0).description('缩放高度'),
                }),
                Schema.object({}),
              ]),
            ]),
          }),
          Schema.object({}),
        ]),
      ]),
    }).collapse(),
  }).description('绘画设置'),
  Schema.object({
    AD: Schema.object({
      ADetailer: Schema.intersect([
        Schema.object({
          enable: Schema.boolean().default(false).description('ADetailer扩展'),
        }),
        Schema.union([
          Schema.object({
            enable: Schema.const(true).required(),
            models: Schema.array(
              Schema.object({
                name: Schema.union([
                  ...ad_modelL,
                  Schema.string().default('None').description('自定义 <填入名称>'),
                ]).default('自定义').description('模型选择'),
                prompt: Schema.string().role('textarea', { rows: [2, 8] }).default('').description('默认正向提示词，不输入时使用绘画提示词'),
                negativePrompt: Schema.string().role('textarea', { rows: [2, 8] }).default('').description('默认负向提示词，使用方法同上'),
                confidence: Schema.number().min(0).max(1).step(0.01).role('slider').default(0.3).description('识别对象的置信度'),
              }),
            ),
          }),
          Schema.object({}),
        ]),
      ]),
    }).collapse(),
  }).description('修复设置'),
  Schema.object({
    WD: Schema.object({
      tagger: Schema.union([
        ...wd_modelL,
        Schema.string().default('None').description('自定义 <填入名称>'),
      ]).default('wd14-vit-v2-git').description('反推模型'),
      threshold: Schema.number().min(0).max(1).step(0.01).role('slider').default(0.3).description('输出提示词的置信度'),
      imgCensor: Schema.intersect([
        Schema.object({
          enable: Schema.boolean().default(false).description('是否用于审核图片').deprecated().disabled(),
        }),
        Schema.union([
          Schema.object({
            enable: Schema.const(true).required(),
            indicators: Schema.array(Schema.union(['sensitive', 'questionable', 'explicit'])).role('select').default(['sensitive', 'questionable', 'explicit']).description('选择评估指标'),
            score: Schema.number().min(0).max(1).step(0.01).role('slider').default(0.8).description('判定敏感图阈值')
          }),
          Schema.object({}),
        ]),
      ]),
    }).collapse(),
  }).description('图生词设置'),
  Schema.object({
    outputMethod: Schema.union(['仅图片', '关键信息', '详细信息']).default('仅图片').description('输出方式，"详细信息"仅用于调试，且*审核将失效*'),
    maxPrompt: Schema.number().min(0).max(200).step(1).role('slider').default(0).description('最大提示词数限制，设置为0关闭'),
    excessHandle: Schema.union(['仅提示', '从前删除', '从后删除']).default('从后删除').description('提示词超限处理'),
    setConfig: Schema.boolean().default(false).description('启用指令修改SD全局设置'),
  }).description('其他设置'),
  Schema.object({
    maxTasks: Schema.number().min(0).default(3).description('最大任务数限制，设置为0关闭'),
    monetary: Schema.intersect([
      Schema.object({
        enable: Schema.boolean().default(false).description('启用经济系统'),
      }),
      Schema.union([
        Schema.object({
          enable: Schema.const(true).required(),
          sd: Schema.number().min(0).max(200).step(1).role('slider').default(20).description('绘画费用，设置为0关闭'),
          wd: Schema.number().min(0).max(200).step(1).role('slider').default(10).description('反推费用，设置为0关闭'),
        }),
        Schema.object({})
      ]),
    ]),
    useTranslation: Schema.intersect([
      Schema.object({
        enable: Schema.boolean().default(false).description('翻译非英文提示词'),
      }),
      Schema.union([
        Schema.object({
          enable: Schema.const(true).required(),
          pronounCorrect: Schema.boolean().default(false).description('翻译后代词修正').experimental(),
        }),
        Schema.object({}),
      ]),
    ]),
    useDVC: Schema.intersect([
      Schema.object({
        enable: Schema.boolean().default(false).description('使用DVC服务扩写提示词'),
      }),
      Schema.union([
        Schema.object({
          enable: Schema.const(true).required(),
          text: Schema.string().role('textarea', { rows: [2, 8] }).default('下面这些标签描绘了一个场景，如果标签是中文，请翻译成英文。请你想象这个场景，并添加更多英文标签来描述它。使用零散的单词或短语，每个标签之间用逗号隔开。比如，在描述一个白发猫娘时，您应该使用: white hair,cat girl,cat ears,cute girl,beautiful,lovely 等英文标签。在回答时，请包含原始标签，并且只需回答标签，无需额外说明。').description('发送给GPT的第一条消息'),
          rollbackPrompt: Schema.boolean().default(false).description('防止GPT不加上之前的提示词'),
        }),
        Schema.object({}),
      ])
    ]),
    censor: Schema.intersect([
      Schema.object({
        enable: Schema.boolean().default(false).description('对接外部审核系统').experimental(),
      }),
      Schema.union([
        Schema.object({
          enable: Schema.const(true).required(),
          endpoint: Schema.string().default('http://127.0.0.1:15000').description('审核系统地址'),
          labels: Schema.array(Schema.union(labelL)).role('select').default(['FEMALE_BREAST_EXPOSED', 'ANUS_EXPOSED', 'FEMALE_GENITALIA_EXPOSED', 'MALE_GENITALIA_EXPOSED']).description('审核内容'),
          threshold: Schema.number().min(0).max(1).step(0.01).role('slider').default(0.45).description('判定敏感阈值'),
          mask: Schema.intersect([
            Schema.object({
              type: Schema.union(mask_typeL).default('None').description('遮罩类型'),
            }),
            Schema.union([
              Schema.object({
                type: Schema.const('color_block').required(),
                color: Schema.tuple([Number, Number, Number]).default([0, 0, 0]).description('遮罩颜色(B, G, R)'),
                gradualRatio: Schema.number().min(0).max(1).step(0.01).role('slider').default(0.2).description('边缘羽化距离'),
                maskShape: Schema.union(['rectangle', 'ellipse']).default('ellipse').description('遮罩形状'),
                maskScale: Schema.number().min(0).max(3).step(0.01).role('slider').default(1.3).description('遮罩放大尺寸'),
              }),
              Schema.object({
                type: Schema.const('full_color_block').required(),
                color: Schema.tuple([Number, Number, Number]).default([0, 0, 0]).description('遮罩颜色(B, G, R)'),
              }),
              Schema.object({
                type: Schema.const('gaussian_blur').required(),
                blurStrength: Schema.number().min(0).max(10).step(1).role('slider').default(4).description('模糊强度'),
                gradualRatio: Schema.number().min(0).max(1).step(0.01).role('slider').default(0.2).description('边缘羽化距离'),
                maskShape: Schema.union(['rectangle', 'ellipse']).default('ellipse').description('遮罩形状'),
                maskScale: Schema.number().min(0).max(3).step(0.01).role('slider').default(1.4).description('遮罩放大尺寸'),
              }),
              Schema.object({
                type: Schema.const('full_gaussian_blur').required(),
                blurStrength: Schema.number().min(0).max(10).step(1).role('slider').default(7).description('模糊强度'),
              }),
              Schema.object({
                type: Schema.const('mosaic').required(),
                blurStrength: Schema.number().min(0).max(10).step(1).role('slider').default(4).description('模糊强度'),
                maskShape: Schema.union(['rectangle', 'ellipse']).default('ellipse').description('遮罩形状'),
                maskScale: Schema.number().min(0).max(3).step(0.01).role('slider').default(1.3).description('遮罩放大尺寸'),
              }),
              Schema.object({}),
            ]),
          ]),
        }),
        Schema.object({}),
      ]),
    ]),
    closingMode: Schema.intersect([
      Schema.object({
        enable: Schema.boolean().default(false).description('打烊模式，维护用'),
      }),
      Schema.union([
        Schema.object({
          enable: Schema.const(true).required(),
          tips: Schema.string().default('打烊了，稍后再来吧......').description('自定义提示语'),
        }),
        Schema.object({})
      ]),
    ]),
  }).description('拓展功能'),
])
