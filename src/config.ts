import { Schema, Logger } from 'koishi';
import { samplerL, schedulerL, ad_modelL, wd_modelL, labelL, mask_typeL } from './list';

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
    txt2imgSteps: number; // 文生图步骤数
    img2imgSteps: number; // 图生图步骤数
    maxSteps: number; // 最大步骤数（指令允许的最大）
    prompt: string; // 正向提示词
    negativePrompt: string; // 负向提示词
    prePrompt: boolean; // 正向提示词是否前置
    preNegPrompt: boolean; // 负向提示词是否前置
    restoreFaces: boolean; // 是否使用人脸修复
    hiresFix: boolean; // 是否使用高分辨率修复
  };
  AD: {
    ADetailer: {
      enable?: boolean; // 默认开启
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
  useTranslation: {
    enable?: boolean; // 是否使用翻译服务
    pronounCorrect?: boolean; //修正翻译后代词
  };
  maxTasks: number; // 最大任务数
  monetary: {
    enable?: boolean;
    sd?: number;  // 绘画收费
    wd?: number;  // 反推收费
  }; // 启用经济系统
  censor: {
    enable?: boolean;
    endpoint?: string;
    labels?: string[];
    mask?: {
      enable?: boolean;
      type?: string;
      color?: number[];
      maskShape?: string;
      maskScale?: number;
      blurStrength?: number;
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
    timeOut: Schema.number().default(60000).description('请求超时，设置为0关闭').experimental(),
  }).description('基础设置'),
  Schema.object({
    IMG: Schema.object({
      save: Schema.boolean().default(false).description('是否保存图片到本地'),
      sampler: Schema.union(samplerL).default('DPM++ SDE').description('采样器选择'),
      scheduler: Schema.union(schedulerL).default('Automatic').description('调度器选择'),
      imgSize: Schema.tuple([Number, Number]).default([512, 512]).description(`默认宽度和高度(16的倍数)
  - 模板：
  - 256x256、512x512、512x768、832x1216、1024x1024、1280x720、1920x1080
  `),
      cfgScale: Schema.number().min(0).max(30).step(0.1).role('slider').default(7).description('引导系数，用于控制图像对提示词服从程度'),
      txt2imgSteps: Schema.number().min(1).max(150).step(1).role('slider').default(20).description('文生图默认采样步数'),
      img2imgSteps: Schema.number().min(1).max(150).step(1).role('slider').default(20).description('图生图默认采样步数'),
      maxSteps: Schema.number().min(1).max(150).step(1).role('slider').default(40).description('最大允许采样步数'),
      prompt: Schema.string().role('textarea', { rows: [2, 8] }).default('').description('默认正向提示词'),
      negativePrompt: Schema.string().role('textarea', { rows: [2, 8] }).default('').description('默认负向提示词'),
      prePrompt: Schema.boolean().default(true).description('默认正向提示词是否放在最前面'),
      preNegPrompt: Schema.boolean().default(true).description('默认负向提示词是否放在最前面'),
      restoreFaces: Schema.boolean().default(false).description('是否启用人脸修复').disabled(),
      hiresFix: Schema.boolean().default(false).description('是否启用高分辨率修复').disabled(),
    }).collapse(),
  }).description('绘画设置'),
  Schema.object({
    AD: Schema.object({
      ADetailer: Schema.intersect([
        Schema.object({
          enable: Schema.boolean().default(false).description('使用ADetailer修复'),
        }),
        Schema.union([
          Schema.object({
            enable: Schema.const(true).required(),
            models: Schema.array(
              Schema.object({
                name: Schema.union([
                  ...ad_modelL,
                  Schema.string().default('None').description('自定义模型 <填入名称>'),
                ]).default('自定义模型').description('模型选择'),
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
      tagger: Schema.union(wd_modelL).default('wd14-vit-v2-git').description('反推模型选择'),
      threshold: Schema.number().min(0).max(1).step(0.01).role('slider').default(0.3).description('输出提示词的置信度'),
      imgCensor: Schema.intersect([
        Schema.object({
          enable: Schema.boolean().default(false).description('是否用于审核图片').experimental().disabled(),
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
    outputMethod: Schema.union(['仅图片', '关键信息', '详细信息']).default('仅图片').description('输出方式，"详细信息"反推审核将失效'),
    maxPrompt: Schema.number().min(0).max(200).step(1).role('slider').default(0).description('最大提示词数限制，设置为0关闭'),
    excessHandle: Schema.union(['仅提示', '从前删除', '从后删除']).default('从后删除').description('提示词超限处理'),
    setConfig: Schema.boolean().default(false).description('是否启用指令修改SD全局设置'),
  }).description('其他设置'),
  Schema.object({
    useTranslation: Schema.intersect([
      Schema.object({
        enable: Schema.boolean().default(false).description('是否启用翻译服务处理非英文提示词'),
      }),
      Schema.union([
        Schema.object({
          enable: Schema.const(true).required(),
          pronounCorrect: Schema.boolean().default(false).description('启用翻译后代词修正').experimental(),
        }),
        Schema.object({}),
      ]),
    ]),
    maxTasks: Schema.number().min(0).default(3).description('最大任务数限制，设置为0关闭'),
    monetary: Schema.intersect([
      Schema.object({
        enable: Schema.boolean().default(false).description('是否启用经济系统'),
      }),
      Schema.union([
        Schema.object({
          enable: Schema.const(true).required(),
          sd: Schema.number().min(0).max(200).step(1).role('slider').default(20).description('绘画启用经济，设置为0关闭'),
          wd: Schema.number().min(0).max(200).step(1).role('slider').default(10).description('反推启用经济，设置为0关闭'),
        }),
        Schema.object({})
      ]),
    ]),
    censor: Schema.intersect([
      Schema.object({
        enable: Schema.boolean().default(false).description('是否对接外部审核系统'),
      }),
      Schema.union([
        Schema.object({
          enable: Schema.const(true).required(),
          endpoint: Schema.string().default('http://127.0.0.1:5000').description('审核系统地址'),
          labels: Schema.array(Schema.union(labelL)).role('select').default(['FEMALE_BREAST_EXPOSED', 'ANUS_EXPOSED', 'FEMALE_GENITALIA_EXPOSED', 'MALE_GENITALIA_EXPOSED']).description('选择审核内容'),
          mask: Schema.intersect([
            Schema.object({
              enable: Schema.boolean().default(false).description('是否启用遮罩处理'),
            }),
            Schema.union([
              Schema.intersect([
                Schema.object({
                  enable: Schema.const(true).required(),
                  type: Schema.union(mask_typeL).default('gaussian_blur').description('遮罩类型'),
                  maskShape: Schema.union(['rectangle', 'ellipse']).default('ellipse').description('遮罩形状'),
                  maskScale: Schema.number().min(0).max(2).step(0.01).role('slider').default(1.3).description('遮罩放大尺寸'),
                  blurStrength: Schema.number().min(0).max(100).step(1).role('slider').default(40).description('模糊强度'),
                  gradualRatio: Schema.number().min(0).max(1).step(0.01).role('slider').default(0.8).description('从中心到开始渐变的距离'),
                }),
                Schema.union([
                  Schema.object({
                    type: Schema.const('color_block').required(),
                    color: Schema.tuple([Number, Number, Number]).default([0, 0, 0]).description('遮罩颜色(B, G, R)'),
                  }),
                  Schema.object({
                    type: Schema.const('full_color_block').required(),
                    color: Schema.tuple([Number, Number, Number]).default([0, 0, 0]).description('遮罩颜色(B, G, R)'),
                  }),
                  Schema.object({}),
                ]),
              ]),
              Schema.object({}),
            ]),
          ]),
        }),
        Schema.object({}),
      ]),
    ]),
    closingMode: Schema.intersect([
      Schema.object({
        enable: Schema.boolean().default(false).description('开启打烊模式，维护用'),
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
