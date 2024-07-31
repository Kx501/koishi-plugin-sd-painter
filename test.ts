import { Schema, Logger } from 'koishi';

enum RuleType {
    PLATFORM = '$platform',
    BOT = '$bot',
    USER = '$user',
    GROUP = '$group',
    CHANNEL = '$channel',
    CONTENT = '$content',
    LENGTH = '$length',
    COMMAND = '$command',
}

enum RuleComputed {
    REGEXP = 0,
    EQUAL = 1,
    NOT_EQUAL = 2,
    CONTAIN = 3,
    NOT_CONTAIN = 4,
    MATH = 5,
}

enum CacheModel {
    NATIVE = 'native',
    CACHE = 'cache',
}

export interface Config {
    quality: number
    regroupement: boolean
    pagepool: number
    advanced: boolean
    rules?: ImageRule[][]
    cache: {
        enable: boolean
        databased: boolean
        driver: CacheModel
        threshold: number
        rule: CacheRule[]
    }
    templates: string[]
    maxLineCount?: number
    maxLength?: number
    background: string
    blur: number
    style: string
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        quality: Schema.number().min(20).default(80).max(100).description('生成的图片质量').experimental(),
        regroupement: Schema.boolean().default(false).description('并发渲染（这会显著提高内存占用）'),
        cache: Schema.intersect([
            Schema.object({
                enable: Schema.boolean().default(false).description('启用缓存').experimental(),
            }),
            Schema.union([
                Schema.intersect([
                    Schema.object({
                        enable: Schema.const(true).required(),
                        driver: Schema.union([
                            Schema.const(CacheModel.NATIVE).description('由 imagify 自行管理').experimental(),
                            Schema.const(CacheModel.CACHE).description('由 Cache 服务管理（需要 Cache 服务）'),
                        ]).default(CacheModel.CACHE).description('缓存存储方式，推荐使用 cache 服务'),
                        rule: Schema.array(Schema.object({})).role('table').description('缓存命中规则，点击右侧「添加行」添加规则。').hidden(),
                    }),
                    Schema.union([
                        Schema.object({
                            driver: Schema.const(CacheModel.NATIVE).required(),
                            databased: Schema.boolean().default(true).description('使用数据库代替本地文件（需要 database 服务）').disabled(),
                            threshold: Schema.number().min(1).default(FREQUENCY_THRESHOLD).description('缓存阈值，当缓存命中次数超过该值时，缓存将被提升为高频缓存'),
                        }),
                        Schema.object({}),
                    ]),
                ]),
                Schema.object({}),
            ]),
        ]),
    }),
    Schema.union([
        Schema.object({
            regroupement: Schema.const(true).required(),
            pagepool: Schema.number().min(1).default(5).max(128).description('初始化页面池数量'),
        }),
        Schema.object({})
    ]),
    Schema.object({
        advanced: Schema.boolean().default(false).description('是否启用高级模式')
    }),
    Schema.union([
        Schema.object({
            // @ts-ignore
            advanced: Schema.const(false),
            maxLineCount: Schema.number().min(1).default(20).description('当文本行数超过该值时转为图片'),
            maxLength: Schema.number().min(1).default(648).description('当返回的文本字数超过该值时转为图片'),
        }),
        Schema.object({
            advanced: Schema.const(true).required(),
            rules: Schema.array(Schema.array(Schema.object({
                type: Schema.union([
                    Schema.const(RuleType.PLATFORM).description('平台名'),
                    Schema.const(RuleType.USER).description('用户ID'),
                    Schema.const(RuleType.GROUP).description('群组ID'),
                    Schema.const(RuleType.CHANNEL).description('频道ID'),
                    Schema.const(RuleType.BOT).description('机器人ID'),
                    Schema.const(RuleType.COMMAND).description('命令名'),
                    Schema.const(RuleType.CONTENT).description('内容文本'),
                    Schema.const(RuleType.LENGTH).description('内容字数'),
                ]).description('类型'),
                computed: Schema.union([
                    Schema.const(RuleComputed.REGEXP).description('正则'),
                    Schema.const(RuleComputed.EQUAL).description('等于'),
                    Schema.const(RuleComputed.NOT_EQUAL).description('不等于'),
                    Schema.const(RuleComputed.CONTAIN).description('包含'),
                    Schema.const(RuleComputed.NOT_CONTAIN).description('不包含'),
                    Schema.const(RuleComputed.MATH).description('数学（高级）'),
                ]).description('计算'),
                righthand: Schema.string().description('匹配'),
            })).role('table').description('AND 规则，点击右侧「添加行」添加 OR 规则。')).description('规则列表，点击右侧「添加项目」添加 AND 规则。详见<a href="https://imagify.koishi.chat/rule">文档</a>'),
            templates: Schema.array(Schema.string().role('textarea')).description('自定义模板，点击右侧「添加行」添加模板。').disabled(),
        }).description('高级设置'),
    ]),
    Schema.intersect([
        Schema.object({
            background: Schema.string().role('link').description('背景图片地址，以 http(s):// 开头'),
            blur: Schema.number().min(1).max(50).default(10).description('文本卡片模糊程度'),
            customize: Schema.boolean().default(false).description('自定义样式'),
        }).description('样式设置'),
        Schema.union([
            Schema.object({
                customize: Schema.const(true).required(),
                style: Schema.string().role('textarea').default(css).description('直接编辑样式， class 见<a href="https://imagify.koishi.chat/style">文档</a>'),
            }),
            Schema.object({}),
        ])
    ]),
]) as Schema<Config>