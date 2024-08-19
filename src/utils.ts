import { Context, Session, Logger } from 'koishi';
import { } from '@koishijs/translator'
import { } from 'koishi-plugin-davinci-003'
import { Config, log } from './config';


export async function promptHandle(ctx: Context, session: Session, config: Config, text?: any, trans?: boolean, dvc?: boolean): Promise<string> {
  //// 格式化 ////
  // 检查输入是否有效
  if (!text || typeof text !== 'string') return '';

  // 函数功能实现
  const { maxPrompt, excessHandle } = config;
  text = formatInput(text);

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
    log.debug('格式化完成:', JSON.stringify(parts)); // 调试输出格式化结果
    return parts;
  }

  if (!maxPrompt) {
    const exceedingPart = text.length - maxPrompt;
    if (exceedingPart > 0) {
      switch (excessHandle) {
        case '仅提示':
          session.send('提示词长度超限');
          break;
        case '从前删除':
          text = text.slice(exceedingPart);
          break;
        case '从后删除':
          text = text.slice(0, maxPrompt);
          break;
      }
    }
  }


  //// 翻译环节 ////
  // 检查开关
  if (!trans) return text.join(',');
  else if (!ctx.translator) return '请先安装translator服务';
  else return await translateZH(text);



  // 翻译函数
  async function translateZH(text: string[]) {
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
    const combinedChineseText = chineseParts.join('\n');

    // 翻译
    let translatedCombinedText = await ctx.translator.translate({
      input: combinedChineseText,
      source: 'zh',
      target: 'en'
    });
    log.debug('翻译完成:', JSON.stringify(translatedCombinedText));

    // 修正代词
    if (config.useTranslation.pronounCorrect) translatedCombinedText = processText(translatedCombinedText);

    // 分割翻译后的文本为数组
    const translatedParts = translatedCombinedText.split('\n');

    // 用翻译后的英文元素替换原数组中对应的中文元素
    indices.forEach((index, i) => {
      if (translatedParts[i] !== undefined) {
        text[index] = translatedParts[i];
      }
    });

    let txt = text.join(',');
    txt = await ctx.dvc.chat_with_gpt([{
      role: 'system',
      content: `${txt}
这些英文标签描述了一幅画面，请你想象这幅画面并用更多标签描述它，
用碎片化的单词标签而不是句子去描述这幅画，描述词尽量丰富，
每个标签之间用逗号分隔，例如在描述白发猫娘的时候，你应该用: white hair,cat girl,cat ears,cute girl,beautiful,lovely 等英文词汇标签。
你只需要告诉我标签，不要说多余的话。`
    }])

    return txt;
  }
}


// 代词修正
const processText = (text: string): string => {
  // 1. 判断性别
  const gender = determineGender(text);

  // 2. 替换代词
  const replacedText = replacePronouns(text, gender);

  // 3. 返回处理后的文本
  return replacedText;
};

const determineGender = (text: string): string => {
  const textStr = text.toLowerCase();
  if (/she|her|hers/.test(textStr)) return 'female';
  if (/he|his/.test(textStr)) return 'male';
  return 'neutral';
};

const replacePronouns = (text: string, gender: string): string => {
  const replacements = pronounMap[gender];
  return text.replace(/\b(your|you|yours)\b/g, match => replacements[match]);
};

// 性别映射
const pronounMap = {
  female: {
    'your': 'her',
    'you': 'she',
    'yours': 'hers',
  },
  male: {
    'your': 'his',
    'you': 'he',
    'yours': 'his',
  },
  neutral: {
    'your': 'their',
    'you': 'they',
    'yours': 'theirs',
  }
};