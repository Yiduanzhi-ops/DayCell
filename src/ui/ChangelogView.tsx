/**
 * 版本更新页（v8.4）——全屏覆盖层，手机/桌面同构，风格对齐 ShareView/SyncSettings。
 *
 * 数据硬编码在下方 CHANGELOG（每次发版在头部加一条），倒序展示（最新在上）。
 * 每版只列 1–3 条用户可感知的要点（"尽量简洁"），页首显示当前版本号。
 */
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import styles from './ChangelogView.module.css'

const CURRENT_VERSION = 'v8.18'
export { CURRENT_VERSION }

/** 版本要点（倒序：最新在最前）。维护约定：发版时在数组头部插入新条目。 */
const CHANGELOG: { version: string; date: string; items: string[] }[] = [
  {
    version: 'v8.18',
    date: '2026-10-10',
    items: [
      '修复滑动途中侧页内容与落地不一致（松手跳变）：相邻日预取改为每次都重新聚合，侧页永远最新',
      '侧页摘要与落地对齐：待办/想法不再截断显示、补农历与纪念日，途中看到的内容和松手后一致',
    ],
  },
  {
    version: 'v8.17',
    date: '2026-10-10',
    items: [
      '修复日视图滑动翻页落地白屏（真根因）：过渡目标位移计算错误，松手后滑到屏幕外再复位',
      '左滑滑向第 3 页（-66.6667%）、右滑滑向第 1 页（0%），全程内容在屏内，不再闪白',
    ],
  },
  {
    version: 'v8.16',
    date: '2026-10-10',
    items: [
      '修复日视图滑动翻页落地白屏：松手后先等目标日数据就绪再滑过去，不再闪骨架',
      '中间页与待办/想法区块数据源改为缓存优先，翻页落地即显示目标日真实内容（不再闪旧日期）',
    ],
  },
  {
    version: 'v8.15',
    date: '2026-10-10',
    items: [
      '修复今日视图空白：v8.14 修复时误删轨道 flex 容器，三页从横排变垂直堆叠、今天页落到第二屏',
      '轨道恢复 display:flex（横排三页，整屏显示今天，滑动仍可见相邻日）',
    ],
  },
  {
    version: 'v8.14',
    date: '2026-10-10',
    items: [
      '修复今天视图布局错乱：三页轨道宽度被压缩导致昨天/今天/明天同时挤在一屏',
      '轨道固定为 3 屏宽，今天视图恢复整屏显示（滑动途中仍可见相邻两天）',
      '修复从想法列表进日视图时返回按钮文案错误显示「月视图」',
    ],
  },
  {
    version: 'v8.13',
    date: '2026-10-10',
    items: [
      '新增「想法」tab：全部想法按天分组、时间倒序，10 条一页翻页',
      '底部 tab 扩为 5 个：目标 | 想法 | 今天（中间）| 周 | 月，默认仍打开今日视图',
      '点想法条目进入对应日视图（编辑/删除在日视图做），返回精确还原页码与滚动位置',
    ],
  },
  {
    version: 'v8.12',
    date: '2026-10-10',
    items: [
      '日视图滑动翻页重做：三页轨道，滑动途中能同时看到前后两天的真实内容（不再白屏）',
      '相邻日数据预取缓存：手指按下即预加载左右两天，未就绪显示轻骨架，落地自动填充',
    ],
  },
  {
    version: 'v8.11',
    date: '2026-10-10',
    items: [
      '日视图滑动翻页：左右轻扫切换前一天/后一天，整屏跟手、松手两阶段滑入（所有日视图生效，返回仍回原位置）',
      '修复：子任务进度编辑时，填完百分比后点文字输入框不再被关闭，可继续输入进度描述',
    ],
  },
  {
    version: 'v8.10',
    date: '2026-10-10',
    items: [
      '目标与子任务都支持「当前进度」（文本 + 百分比，可只填其一，独立手填）',
      '子任务：进度与描述同级，常驻显示在描述下方（点进度区域就地编辑，百分比 0–100，描述最多 200 字）',
      '目标详情：进度与「目标阐述」同级展示（阐述在上、进度在下），点「编辑」填写',
    ],
  },
  {
    version: 'v8.9',
    date: '2026-10-10',
    items: [
      '子任务支持「描述」：点描述区域（或「＋ 添加描述」）就地编辑，内容常驻显示在子任务标题下方（最多 500 字，多行），完成时随标题一起淡化',
    ],
  },
  {
    version: 'v8.8',
    date: '2026-10-09',
    items: [
      '月视图纪念日名称在手机窄屏下留在格内、一行放不下自然换行，最多显示 3 行（不漂移、不截半行）',
      '确认月/周视图不再显示任何花费相关内容',
    ],
  },
  {
    version: 'v8.6',
    date: '2026-10-08',
    items: [
      '菜单按钮去掉外围框，更简洁',
      '目标详情切换改为「子任务 | 阶段」',
      '「分享与手册」更名「使用手册」：新增 GitHub 仓库链接、反馈入口、一键生成分享图（含二维码与卖点）',
    ],
  },
  {
    version: 'v8.5',
    date: '2026-10-08',
    items: [
      '目标详情支持「阶段 | 子任务」双视图：子任务可勾选完成、点文字就地编辑、删除',
      '子任务进度独立统计，不影响目标卡片进度',
    ],
  },
  {
    version: 'v8.4',
    date: '2026-10-08',
    items: [
      '新增「版本更新」页，每版要点倒序展示',
      '右上角菜单按钮改为更明显的汉堡按钮',
      '移除「关于」占位项；周/月视图不再显示支出汇总',
    ],
  },
  {
    version: 'v8.3',
    date: '2026-10-08',
    items: ['新增「分享与手册」页：一键复制网址、添加到主屏幕指引、三步上手'],
  },
  {
    version: 'v8.2',
    date: '2026-10-08',
    items: ['跨设备同步改走 Gitee 私有仓库：配置一次自动同步，同步即异地备份'],
  },
  {
    version: 'v8.1',
    date: '2026-10-08',
    items: ['新增跨设备同步（坚果云通道）'],
  },
  {
    version: 'v8.0',
    date: '2026-10-08',
    items: [
      '新增习惯模块：今日视图习惯打卡、习惯设置（频率自选）',
      '今日视图移除支出区块（记账走 iCost）',
    ],
  },
  {
    version: 'v7.9',
    date: '2026-10-07',
    items: ['新增「目标」模块：阶段性目标 + 阶段列表 + 阐述总结，底部 tab 进入'],
  },
  {
    version: 'v7.8',
    date: '2026-10-03',
    items: ['logo 高清化重制：更清晰、符合应用图标形状'],
  },
  {
    version: 'v7.7',
    date: '2026-10-01',
    items: ['更换 logo 为用户提供的图标'],
  },
  {
    version: 'v7.6',
    date: '2026-10-01',
    items: [
      '「花费」改为「支出」，添加支出无需指定分类',
      '待办完成后自动移到列表最下方',
      '导出文件时提示保存位置',
      '应用名改为 DayCell',
    ],
  },
  {
    version: 'v7.5',
    date: '2026-10-01',
    items: ['新增右上角菜单：备份导出 / 合并导入 / 一键导出 MD / 纪念日设置 / 夜间模式'],
  },
  {
    version: 'v7.4',
    date: '2026-10-01',
    items: ['录入改为手动弹窗，不再自动弹出', '今日顶栏移除日期与周几（内容区保留）'],
  },
  {
    version: 'v7.3',
    date: '2026-10-01',
    items: ['应用名定为 DayCell，底部新增「今天 / 周 / 月」视图切换器'],
  },
  {
    version: 'v7.2',
    date: '2026-10-01',
    items: ['手机端录入体验打磨：去掉回车保存字样、录入不放大页面'],
  },
  {
    version: 'v7.1',
    date: '2026-09-30',
    items: ['月视图改为三行格布局，新增启动页'],
  },
  {
    version: 'v6.1',
    date: '2026-09-29',
    items: ['移除顶部快捷录入行，录入统一在各区块的内联表单进行'],
  },
  {
    version: 'v6',
    date: '2026-09-29',
    items: [
      '三视图上线：默认「今天」落地页，可切换周 / 月',
      '日视图全屏展示当天记录，翻日不丢当前视图',
      '从周 / 月进入日视图记住来源，返回时精确还原',
    ],
  },
  {
    version: 'v5',
    date: '原型期',
    items: [
      '月 / 周双视图定型：月看密度、周看内容',
      '点日期弹出底部面板查看当天记录',
      '色彩令牌体系（ink + accent），为夜间模式打底',
    ],
  },
  {
    version: 'v3–v4',
    date: '原型期',
    items: [
      '视觉定稿：极简黑白灰 + 单一强调色',
      '数据层与界面隔离（core 纯函数），为将来复用留路',
      '农历库按需加载，不拖慢首屏',
    ],
  },
  {
    version: 'v2',
    date: '原型期',
    items: [
      '周视图改为竖排，更适合手机',
      '探索心情评分控件（后于 v5 移除）',
    ],
  },
  {
    version: 'v0–v1',
    date: '原型期',
    items: [
      '定下核心定位：以「一天」为容器，记录待办 / 想法 / 花费',
      '存储选 IndexedDB，软删除不物理删',
      '金额按整数分存储，杜绝浮点精度问题',
    ],
  },
]

export function ChangelogView(): JSX.Element {
  const closeChangelog = useApp((s) => s.closeChangelog)

  return (
    <div className={styles.overlay}>
      <div className={styles.page}>
        <div className={styles.head}>
          <button className={styles.back} onClick={closeChangelog}>
            ← 返回
          </button>
          <h1 className={styles.h1}>版本更新</h1>
          <span className={styles.headSpacer} />
        </div>

        <div className={styles.body}>
          <div className={styles.current}>
            <span className={styles.currentBadge}>当前版本 {CURRENT_VERSION}</span>
          </div>
          <ul className={styles.list}>
            {CHANGELOG.map((entry) => (
              <li key={entry.version} className={styles.item}>
                <div className={styles.itemHead}>
                  <span className={styles.ver}>{entry.version}</span>
                  <span className={styles.date}>{entry.date}</span>
                </div>
                <ul className={styles.items}>
                  {entry.items.map((it, i) => (
                    <li key={i}>{it}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
