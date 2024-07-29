import { Context, Logger } from 'koishi';
import {} from '@koishijs/translator'
import { Config, log } from './config';

const{maxPrompt, excessProcessing}=config;

export async function translateZH(ctx: Context, text: string): Promise < string > {
  // 检查输入是否有效
  if (!text || typeof text !== 'string') return;

  // 计算耗时
  let start = performance.now();

  // 正则表达式匹配中文字符
  const chineseRegex = /[\u4e00-\u9fa5]+/;

  // 按 ',' 或 '，' 分割字符串
  const parts = text.split(/[,，]/).map(part => part.trim());

  // 记录中文元素的位置
  const chineseParts: string[] = [];
  const positions: number[] = [];

  parts.forEach((part, index) => {
    if (chineseRegex.test(part)) {
      chineseParts.push(part);
      positions.push(index);
    }
  });

  if (chineseParts.length === 0) {
    return text; // 没有中文部分直接返回原文
  }

  // 使用翻译接口翻译中文部分
  const translatedText = await ctx.translator.translate({
    input: chineseParts.join(','),
    target: 'en'
  });

  // 分割翻译后的字符串为数组
  const translatedArray = translatedText.split(',');

  // 将翻译后的文本替换回原数组
  positions.forEach((pos, index) => {
    parts[pos] = translatedArray[index] || '';
  });

  // 重新拼接成字符串
  let result = parts.join(',');

  // 去掉非英文字母后的空格
  result = result.replace(/[^a-zA-Z]\s+/g, match => match.trim());

  // 去掉非英文字母前的空格
  result = result.replace(/\s+[^a-zA-Z]/g, match => match.trim());


  let end = performance.now();
  log.debug(`翻译耗时: ${end - start} ms`);
  return result;


  export function promptProcessing(ctx: Context, text: string): Promise < string > {
    // 检查输入是否有效
    if (!text || typeof text !== 'string') return;

  }
}