import { Context, Session } from 'koishi';
import { } from '@koishijs/translator'
import { } from 'koishi-plugin-davinci-003'
import { Config, log } from './config';


export async function promptHandle(ctx: Context, session: Session, config: Config, inputStr?: string, trans?: boolean, dvc?: boolean): Promise<string> {
  // 检查输入是否有效
  if (inputStr === '') return '';

  const { maxPrompt, excessHandle } = config;
  const { text: dvcrole, rollbackPrompt } = config.useDVC;

  //// 格式化 ////
  let text = formatInput(inputStr);


  //// GPT增强 ////
  if (dvc) {
    if (!ctx.dvc) throw new Error('请先安装dvc服务');
    const TransTXT = text.join(','); // 中间量
    let txt = await ctx.dvc.chat_with_gpt([{
      role: 'system',
      content: `${dvcrole}`
    }, {
      role: 'user',
      content: `${TransTXT}`
    }])
    if (rollbackPrompt) txt = TransTXT + ',' + txt;
    text = txt?.split(','); // 不用?会被阻塞
  }


  //// 翻译环节 ////
  // 检查开关
  if (trans) {
    if (!ctx.translator) throw new Error('请先安装translator服务');
    text = await translateZH(text);
  }


  //// 裁剪 ////
  if (maxPrompt && text.length > maxPrompt) {
    const exceedingPart = text.length - maxPrompt;
    if (exceedingPart > 0) {
      log.debug('提示词长度过长');
      switch (excessHandle) {
        case '仅提示':
          session.send('提示词长度过长');
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

  return text.join(',');



  // 格式化函数
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

    // 如果只有一个元素，并且这个元素不为空字符串，则将其包装成数组
    if (parts.length === 1 && parts[0] !== '') {
      return [parts[0]];
    }

    log.debug('格式化完成:', JSON.stringify(parts)); // 调试输出格式化结果
    return parts;
  }



  // 翻译函数
  async function translateZH(text: string[]): Promise<string[]> {
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
      return text; // 没有中文部分
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

    return text;
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