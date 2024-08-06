import { Context, Session, Logger } from 'koishi';
import { } from '@koishijs/translator'
import { Config, log } from './config';


export async function promptHandle(ctx: Context, session: Session, config: Config, text?: any, trans?: boolean): Promise<string> {
  // 检查输入是否有效
  if (!text || typeof text !== 'string') return '';

  // 通用格式化逻辑，格式化传入提示词
  function formatInput(text: string): string[] {
    // 计算 ',' 和 '，' 的数量
    const commaCount = (text.match(/,/g) || []).length;
    const chineseCommaCount = (text.match(/，/g) || []).length;

    // 判断 '，' 是否为错误输入，替换为 ','
    if (chineseCommaCount / (commaCount + chineseCommaCount) > 0.5) {
      text = text.replace(/，/g, ',');
    }

    // 删除 ',' 后的空格，但保留 '，' 后的空格
    text = text.replace(/,(\s*)/g, ',');

    // 使用 ',' 分割字符串，并去除每个部分的前导空格
    const parts = text.split(',').map((part) => part.trimStart());

    log.debug('格式化结果:', JSON.stringify(parts)); // 调试输出格式化结果

    return parts;
  }


  // 函数功能实现
  const { maxPrompt, excessHandle } = config;

  text = formatInput(text);
  const exceedingPart = text.length - maxPrompt;
  if (!maxPrompt || (exceedingPart > 0 && excessHandle === '仅提示')) {
    session.send('提示词长度超限');
  } else if (excessHandle === '从前删除') {
    text = text.slice(exceedingPart);
  } else if (excessHandle === '从后删除') {
    text = text.slice(0, maxPrompt);
  }


  // 进入翻译环节
  // 检查开关
  if (!trans) return text.join(',');
  else if (!ctx.translator) return '请先安装translator服务';
  else return await translateZH(ctx, session, text);
}


async function translateZH(ctx: Context, session: Session, text: string[]) {
  // 提取含有中文的数组元素及其索引
  const chineseParts = [];
  const indices = [];

  text.forEach((part, index) => {
    if (/[\u4e00-\u9fa5]/.test(part)) {
      chineseParts.push(part);
      indices.push(index);
    }
  });

  if (chineseParts.length === 0) {
    return text.join(','); // 没有中文部分，直接返回字符串
  }

  // 将中文部分合并为一个字符串
  const combinedChineseText = chineseParts.join('|||');

  // 翻译
  const translatedCombinedText = await ctx.translator.translate({
    input: combinedChineseText,
    source: 'zh',
    target: 'en'
  });
  log.debug('翻译结果1:', translatedCombinedText);

  // 分割翻译后的文本为数组
  const translatedParts = translatedCombinedText.split('|||');

  // 用翻译后的英文元素替换原数组中对应的中文元素
  indices.forEach((index, i) => {
    text[index] = text[index].replace(chineseParts[i], translatedParts[i]);
  });

  return text.join(',');
}