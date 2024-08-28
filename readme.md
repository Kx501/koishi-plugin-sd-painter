# @kx501/koishi-plugin-sd-painter

[![npm](https://img.shields.io/npm/v/@kx501/koishi-plugin-sd-painter?style=flat-square)](https://www.npmjs.com/package/@kx501/koishi-plugin-sd-painter)

## 说明

简单对接 Stable Diffusion WebUI 与 Koishi，参考：[novelai-bot](https://github.com/koishijs/novelai-bot)

### 🌟 插件功能

* **文/图生图**
* **中止生成**
* **HiresFix 部分功能**
* **WD1.4 Tagger 部分功能**
* **ADetailer 部分功能**
* **查询/切换模型(未测试)**
* **修改配置(未测试)**
* **图片审核(测试版)，见：**[imgCensor](https://github.com/Kx501/koishi-plugin-imgcensor)

### ⚠️ 注意事项

1. 子指令只能直接调用
2. 默认使用的是秋葉整合包
3. 翻译服务只测试了 [百度翻译](https://api.fanyi.baidu.com/api/trans/product/desktop)
4. dvc 只测试了 [DeepSeek](https://github.com/Kx501/koishi-plugin-imgcensor) 效果不错
5. 默认指令较多，建议在指令管理中个性化配置

## English Version

Simple integration of Stable Diffusion WebUI with Koishi, reference: [novelai-bot](https://github.com/koishijs/novelai-bot).

### 🌟 Features

* **Text/Image-to-Image Generation**
* **interrupt generation**
* **HiresFix Partial Features**
* **WD1.4 Tagger Partial Features**
* **ADetailer Partial Features**
* **Model Query/Switching** (Experimental)
* **Configuration Editing** (Experimental)
* **Image Censorship (Beta)**: See [imgCensor](https://github.com/Kx501/koishi-plugin-imgcensor)

### ⚠️ Important Notes

1. Sub-commands can only be invoked directly.
2. The default setup uses the 秋葉 integration package.
3. Translation services are only tested with [Baidu Translate](https://api.fanyi.baidu.com/api/trans/product/desktop).
4. dvc has only been tested with [DeepSeek](https://github.com/Kx501/koishi-plugin-imgcensor), which works well.
5. There are many default commands, it's recommended to customize them in the command manager.
