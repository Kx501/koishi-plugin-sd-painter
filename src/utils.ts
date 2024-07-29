import { Context, Logger } from 'koishi';
import { } from '@koishijs/translator'
import { Config, log } from './config';


export function promptHandle(ctx: Context, config: Config, text?: string, options?: any): string {
  // 检查输入是否有效
  if (!text || typeof text !== 'string') return '';

  // 通用格式化逻辑，格式化传入提示词
  function formatInput(text: string) {
    // 使用逗号和中文逗号分割字符串
    const partsComma = text.split(',');
    const partsChineseComma = text.split('，');

    // 计算逗号和中文逗号的数量
    const commaCount = partsComma.length - 1;
    const chineseCommaCount = partsChineseComma.length - 1;

    // 计算最大元素数量
    const elementCount = Math.max(partsComma.length, partsChineseComma.length);

    // 检查是否为错误输入
    let isErrorInput = false;
    if (chineseCommaCount / elementCount > commaCount / elementCount) {
      // 将所有中文逗号替换为逗号
      text = text.replace(/，/g, ',');
      isErrorInput = true;
    }

    // 计算逗号和中文逗号后的空格总数
    let spaceCount = 0;
    text.replace(/[,，]\s*/g, (match) => {
      spaceCount += match.length - 1; // 记录空格数量，减去逗号或中文逗号自身的长度
      return match;
    });

    // 检查空格数量是否过多
    if (spaceCount / elementCount > 0.7) {
      // 删除逗号和中文逗号后面的多余空格
      text = text.replace(/([,，])\s+/g, '$1');
    }

    // 使用逗号分割字符串，并去除尾部空格
    const parts = text.split(',').map((part) => part.trimStart());
    return parts.join(',');
  }


  // 函数功能实现
  const { maxPrompt, excessHandle, useTranslation } = config;

  const exceedingPart = text.length - maxPrompt;
  if (!maxPrompt || exceedingPart > 0 && excessHandle === '仅提示') {
    text = formatInput(text);
  } else if (excessHandle === '从前删除') {
    text.slice(exceedingPart);
  } else if (excessHandle === '从后删除') {
    text.slice(0, maxPrompt);
  }
  log.debug('格式化结果', text);


  // 进入翻译环节
  // 检查开关
  if (!useTranslation) return text;
  else if (!ctx.translator) return '请先安装translator服务';
  else translateZH(ctx, text);
}


async function translateZH(ctx: Context, text: string) {
  // 计算耗时
  let start = performance.now();

  // 匹配所有中文字符的正则表达式
  const chineseRegex = /[\u4e00-\u9fa5]+/g;

  // 提取所有中文部分并合并为一个字符串
  const chineseParts = text.match(chineseRegex);
  if (!chineseParts) {
    return text; // 没有中文部分，直接返回原文本
  }

  // 将中文部分合并为一个字符串，用特定分隔符隔开
  const combinedChineseText = chineseParts.join('|||');

  // 翻译合并后的中文部分
  const translatedCombinedText = await ctx.translator.translate({
    input: combinedChineseText,
    target: 'en'
  });

  // 将翻译后的文本按分隔符分割为数组
  const translatedParts = translatedCombinedText.split('|||');

  // 用翻译后的英文部分替换原中文部分
  let translatedText = text;
  chineseParts.forEach((part, index) => {
    translatedText = translatedText.replace(part, translatedParts[index] || part);
  });

  log.debug('翻译完成')
  let end = performance.now();
  log.debug(`翻译耗时: ${end - start} ms`);
  return translatedText;
}
