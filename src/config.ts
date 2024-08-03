import { Schema, Logger } from 'koishi';
import { parse } from 'path';

export const log = new Logger('sd-webui-api');

export interface Config {
  endpoint: string; // API端点
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
    enable: boolean; // 默认开启
    models: {
      name: string;  // 模型选项
      prompt: string; // 正向提示词
      negativePrompt: string; // 负向提示词
      confidence: number; // 检测置信度
    }[];
  };
  WD: {
    tagger: string; // 图像反推模型
    threshold: number; // 提示词输出置信度
    imgCensor: boolean; // 用于图像审核
    indicators: string[]; // 评估指标
    score: number; // 阈值
  };
  outputMethod: string;  // 输出方式
  maxPrompt: number;  //最大提示词数
  excessHandle: string;  //提示词超限处理方式{
  setConfig: boolean; // 指令修改SD全局设置
  useTranslation: boolean; // 是否使用翻译服务
  maxTasks: number; // 最大任务数
}

// 配置约束
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    endpoint: Schema.string().default('http://127.0.0.1:7860').description('SD-WebUI API的网络地址'),
  }).description('基础设置'),
  Schema.object({
    IMG: Schema.object({
      save: Schema.boolean().default(false).description('是否保存图片到本地'),
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
      ]).default('DPM++ SDE').description('采样器选择'),
      scheduler: Schema.union([
        'Automatic',
        'Uniform',
        'Karras',
        'Exponential',
        'Polyexponential',
        'SGM Uniform'
      ]).default('Automatic').description('调度器选择'),
      imgSize: Schema.tuple([Schema.number(), Schema.number()]).default([512, 512]).description(`默认宽度和高度(16的倍数)
  - 模板：
  - 256x256、512x512、512x768、832x1216、1024x1024、1280x720、1920x1080
  `),
      cfgScale: Schema.number().min(0).max(30).step(0.1).default(7).description('引导系数，用于控制图像对提示词服从程度'),
      txt2imgSteps: Schema.number().min(1).max(150).step(1).default(20).description('文生图默认采样步数'),
      img2imgSteps: Schema.number().min(1).max(150).step(1).default(40).description('图生图默认采样步数'),
      maxSteps: Schema.number().min(1).max(150).step(1).default(60).description('最大允许采样步数'),
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
      enable: Schema.boolean().default(false).description('使用ADetailer修复'),
      models: Schema.array(
        Schema.object({
          name: Schema.union([
            'face_yolov8n.pt',
            'face_yolov8s.pt',
            'hand_yolov8n.pt',
            'person_yolov8nseg.pt',
            'person_yolov8s-seg.pt',
            'yolov8x-worldv2.pt',
            'mediapipe_face_full',
            'mediapipe_face_short',
            'mediapipe_face_mesh',
            'mediapipe face mesh eyes only',
            Schema.string().default('None').description('自定义模型 <填入名称>'),
          ]).default('自定义模型').description('模型选择'),
          prompt: Schema.string().role('textarea', { rows: [2, 8] }).default('').description('默认正向提示词，不输入时使用绘画提示词'),
          negativePrompt: Schema.string().role('textarea', { rows: [2, 8] }).default('').description('默认负向提示词，使用方法同上'),
          confidence: Schema.number().min(0).max(1).step(0.01).role('slider').default(0.3).description('识别对象的置信度'),
        })
      )
    }).collapse(),
  }).description('修复设置'),
  Schema.object({
    WD: Schema.object({
      tagger: Schema.union([
        'wd-convnext-v3',
        'wd-swinv2-v3',
        'wd-vit-v3',
        'wd14-convnext',
        'wd14-convnext-v2',
        'wd14-convnext-v2-git',
        'wd14-convnextv2-v2',
        'wd14-convnextv2-v2-git',
        'wd14-moat-v2',
        'wd14-swinv2-v2',
        'wd14-swinv2-v2-git',
        'wd14-vit',
        'wd14-vit-v2',
        'wd14-vit-v2-git',
      ]).default('wd14-vit-v2-git').description('反推模型选择'),
      threshold: Schema.number().min(0).max(1).step(0.01).role('slider').default(0.3).description('输出提示词的置信度'),
      imgCensor: Schema.boolean().default(false).description('是否用于审核图片'),
      indicators: Schema.array(Schema.union(['sensitive', 'questionable', 'explicit'])).default(['sensitive', 'questionable', 'explicit']).description('选择评估指标').role('checkbox'),
      score: Schema.number().min(0).max(1).step(0.01).role('slider').default(0.8).description('判定敏感图阈值')
    }).collapse(),
  }).description('图生词设置'),
  Schema.object({
    outputMethod: Schema.union([
      '仅图片',
      '关键信息',
      '详细信息'
    ]).default('仅图片').description('输出方式，"详细信息"反推审核将失效'),
    maxPrompt: Schema.number().min(0).default(0).description('最大提示词数限制，设置为0关闭'),
    excessHandle: Schema.union([
      '仅提示',
      '从前删除',
      '从后删除'
    ]).default('从后删除').description('提示词超限处理'),
    setConfig: Schema.boolean().default(false).description('是否启用指令修改SD全局设置'),
  }).description('其他设置'),
  Schema.object({
    useTranslation: Schema.boolean().default(false).description('是否启用翻译服务处理非英文提示词'),
    maxTasks: Schema.number().min(0).default(3).description('最大任务数限制，设置为0关闭'),
  }).description('拓展功能'),
]);