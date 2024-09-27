import { arrayBufferToBase64, Context, Dict, Quester, Session } from 'koishi';
import { } from '@koishijs/translator'
import { } from 'koishi-plugin-davinci-003'
import { Config, log } from './config';

/**
 * 处理提示词的异步函数
 * 该函数根据配置参数处理输入的字符串，包括格式化、GPT增强、翻译和裁剪等步骤
 * 
 * @param ctx 上下文对象，包含必要的服务和方法
 * @param session 会话对象，用于发送信息
 * @param config 配置对象，决定处理流程的细节
 * @param inputStr 待处理的输入字符串，默认为空字符串
 * @param trans 布尔值，指示是否进行翻译，默认为false
 * @param dvc 布尔值，指示是否使用GPT增强，默认为false
 * @returns 返回处理后的字符串
 */
export async function promptHandle(ctx: Context, session: Session, config: Config, inputStr?: string, trans?: boolean, dvc?: boolean): Promise<string> {
  // 检查输入是否有效
  if (inputStr === '') return '';

  const { maxPrompt, excessHandle } = config;
  const { text: dvcrole, rollbackPrompt, force } = config.useDVC;

  //// 格式化 ////
  let text = formatInput(inputStr);


  //// GPT增强 ////
  if (dvc || force) {
    if (!ctx.dvc) throw new Error('请先安装dvc服务');
    const TransTXT = text.join(','); // 中间量
    let txt = await ctx.dvc.chat_with_gpt([{
      role: 'system',
      content: `${dvcrole}`
    }, {
      role: 'user',
      content: `${TransTXT}`
    }])
    log.debug('GPT返回：', txt);
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



/**
 * 异步函数：验证用户金额（非扣除！）
 * @param session 用户会话对象，包含用户信息
 * @param cost 扣除的金额，大于0时启用
 */
export async function checkBalance(ctx: Context, session: Session, monetary: boolean, cost: number): Promise<number | string> {
  let userAid: number;
  if (monetary && cost) {
    if (ctx.monetary) {
      // 查询用户的账户ID
      userAid = (await ctx.database.get('binding', { pid: [session.userId] }, ['aid']))[0]?.aid;
      // 查询用户的余额
      let balance = (await ctx.database.get('monetary', { uid: userAid }, ['value']))[0]?.value;
      // 检查余额是否足够，如果不足或未定义，则不扣除并返回提示信息
      if (balance === undefined) ctx.monetary.gain(userAid, 0);
      if (balance < cost) return '当前余额不足，请联系管理员充值VIP /doge/doge'
      else return userAid;
    } else throw new Error('请先安装monetary服务');
  }
}



const MAX_OUTPUT_SIZE = 1048576;
const MAX_CONTENT_SIZE = 10485760;
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];

interface downResult {
  base64?: string
  info?: string
}

export async function download(ctx: Context, url: string, headers = {}): Promise<downResult> {
  try {
    const image = await ctx.http(url, { responseType: 'arraybuffer', headers });

    if (+image.headers.get('content-length') > MAX_CONTENT_SIZE) return { info: '文件太大' };

    const mimetype = image.headers.get('content-type');
    if (!ALLOWED_TYPES.includes(mimetype)) return { info: '不支持的文件类型' };

    const buffer = image.data;
    const base64 = arrayBufferToBase64(buffer);
    return { base64: base64 };
    // return { buffer, base64, dataUrl: `data:${mimetype};base64,${base64}` };
  } catch (e) {
    log.debug('下载图片失败:', e);
    return { info: '获取图片参数失败，可能的错误类型：\n1.错误的图片链接\n2.非本人发送的图片\n3.图片已过期' }
  };
}