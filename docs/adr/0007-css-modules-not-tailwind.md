# ADR-0007 样式方案：CSS Modules + 设计令牌，不用 Tailwind

- **状态**：已接受
- **日期**：2026-09-29
- **相关**：SPEC §4 视觉规范、SPEC §6 技术栈、PRD §5.1

> 本条推翻了 SPEC §6 原定的「Tailwind CSS v4」。

## 背景

SPEC 最初定的样式方案是 Tailwind CSS v4（配 `@tailwindcss/vite`）。但在此期间，可点击原型 `prototype/index.html` 已经用**手写 CSS + CSS 自定义属性**把整套视觉做完了：约 450 行，包含设计令牌、月格布局、周视图竖排行、底部 sheet 动效、内联表单、弹层、响应式断点。（注：**原型仍是 v5.2，早于 v6 决策**——v6 已取消手机端 sheet、改为三视图；这里描述的是原型当时的事实，不是正式版要照搬的结构。但"手写 CSS 已经跑通"这个论据不受影响。）

也就是说，"要不要 Tailwind"这个问题在原型阶段已经被实践回答了一半：**这套设计是用手写 CSS 做出来的，而且做出来了。**

## 决策

**用 CSS Modules + 原生 CSS 自定义属性（设计令牌）。不引入 Tailwind。**

### 1. 设计令牌集中在一个全局文件

原型的 `:root` 块原样迁移到 `src/ui/tokens.css`：

```css
:root {
  --accent: #2E4BA6;
  --bg: #FFFFFF;         --bg-subtle: #FAFAFA;   --bg-hover: #F5F5F5;
  --ink: #1A1A1A;        --ink-2: #5C5C5C;       --ink-3: #9C9C9C;   --ink-4: #C4C4C4;
  --line: #EBEBEB;       --line-2: #F4F4F4;
  --accent-soft: color-mix(in srgb, var(--accent) 8%, #fff);
  --accent-line: color-mix(in srgb, var(--accent) 28%, #fff);
  --font: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
          "Microsoft YaHei", system-ui, sans-serif;
}
```

强调色切换（PRD C1）只需改 `--accent` 一个变量，`color-mix` 派生的 soft/line 自动跟随。

### 2. 组件样式用 CSS Modules

`MonthCell.tsx` + `MonthCell.module.css`，类名编译期哈希，零运行时、零全局污染。

### 3. 少数需要跨组件选择器的地方保留全局类

`body[data-device="phone"] .detail { ... }` 这类"父级状态影响子组件"的规则，CSS Modules 的局部作用域表达不了。用 `:global()` 或放在一个小的全局文件里，**但要有注释说明为什么必须是全局的**。

## 理由

**原型已经证明手写 CSS 能承载这套设计**。这不是理论推演——**298 行手写 CSS、约 209 条规则**（原型 v6.1，`prototype/index.html`）就在那儿，跑在浏览器里，由 `node smoke.cjs` 的 **218 项断言**覆盖。
（v6.1 移除顶部快捷录入行后 CSS 反而更短了：删掉 `.quick` / `.qtypes` / `.qfield` / `.qbadge` / `.qadd` / `.qcat` 六组规则，只补回一条 `.daybar`。**少一个 UI 面 = 少一批样式**，这也是 PRD D18 的附带收益。）

**这套设计里 Tailwind 帮不上忙的部分恰好是最难的部分**：

| 样式难点 | Tailwind 的表现 |
|---|---|
| 月格 7 列 × 6 行、格内三行布局、各元素不同的截断与优先级 | 需要一长串 utility，可读性反而不如 12 行语义化 CSS |
| 三视图整屏切换的 `transform` 转场 + 键盘弹起避让（`visualViewport` 高度写进 CSS 变量）+ 分区表单 `scroll-margin-bottom`（ADR-0005 v6） | arbitrary value 满天飞，`[scroll-margin-bottom:56px]` 这种写法失去 Tailwind 的意义 |
| ~~底部 sheet 的 `max-height: 90%` + 遮罩联动~~ | **v6 已取消 sheet**，此论据作废；上一行是替代它的同类场景 |
| `color-mix()` 派生的强调色 soft/line | Tailwind v4 支持，但和 CSS 变量方案没有区别 |
| 心情色阶（5 档 `color-mix` 渐变） | 已在 v5 移除，不再是需求 |

**转换成本是纯亏**。原型的 CSS 要重写成 utility class，工作量约 1–2 天，产出是**功能完全一样**的界面，同时丢掉"CSS 类名即语义"的可读性（`.wrow.sel` vs `flex gap-3 border-b ...`）。

**包体积**：Tailwind v4 按需生成后通常 10–20 KB gzip，手写 CSS 约 6 KB。在 80 KB 首屏预算（PRD §5.1）里，这 10 KB 不是决定性的，但也没有理由多花。

**少一层构建**。Tailwind v4 需要 Vite 插件、需要 content 扫描配置、需要在 CI 里保证扫描路径正确（漏配就掉样式，且是运行时才发现）。

## 考虑过的替代方案

| 方案 | 为什么否掉 |
|---|---|
| **Tailwind CSS v4**（原方案） | 见上。核心问题不是 Tailwind 不好，而是**这套设计已经用手写 CSS 做完了**，转换是纯成本 |
| styled-components / Emotion | CSS-in-JS 有运行时开销（约 10–15 KB + 每次渲染的样式计算），且与 React 19 的 Server Components 方向不兼容。对一个本地优先的记录应用是纯负担 |
| Vanilla Extract | 类型安全的零运行时 CSS-in-TS，技术上很优雅。但引入一套新范式，学习成本高于收益，且原型的 CSS 无法直接复用 |
| Sass / Less 预处理器 | 原生 CSS 已经有变量、`color-mix()`、嵌套（Chrome 112+/Safari 16.4+ 已支持）。我们的目标浏览器（PRD §5.3，iOS 16.4+）刚好覆盖。**不需要预处理器** |
| 完全不用 CSS Modules，全局 BEM | 可行，但需要人工维护命名纪律。CSS Modules 用编译器免费拿到同样的隔离 |

**关于 CSS 嵌套**：原生 CSS 嵌套在 iOS Safari 16.4+ 与 Chrome 112+ 可用，恰好是我们的最低目标。可以用，但**不要依赖 `&` 的复杂用法**——PostCSS/Lightning CSS 的降级行为在不同版本有差异。保守起见，嵌套只用于一层。

## 后果

**正面**
- 原型的 450 行 CSS **可直接迁移**，改的只是拆分成模块
- 视觉规范（SPEC §4）与实现一一对应，改设计令牌即改全站
- 零运行时开销，包体积最小
- 构建链更短，CI 更快

**负面**
- **失去 Tailwind 的"不用想类名"红利**。组件多了以后，CSS 文件可能重复（比如多处写相似的按钮样式）。缓解：把重复的模式提炼成 tokens.css 里的自定义属性 + 少数几个全局 utility 类
- 团队若有 Tailwind 肌肉记忆，需要适应。**本项目只有一个开发者，不构成问题**
- 没有 Tailwind 的 `dark:` 变体，将来做深色模式（PRD Won't，v0 不做）需要自己写 `[data-theme="dark"]` 覆盖。**但 CSS 变量方案本来就更适合做主题切换**——改一组变量即可

## 实施要点

- Vite 原生支持 CSS Modules（`*.module.css`），**无需任何插件**
- 用 Lightning CSS 做压缩与降级：`css: { transformer: 'lightningcss' }`，比默认 PostCSS 快且产物更小
- `tokens.css` 必须在入口最先 import，保证自定义属性先声明
- 建立**三个全局文件**，其余全部模块化：
  - `tokens.css` —— 设计令牌
  - `reset.css` —— `* { box-sizing: border-box; margin: 0 }` 等
  - `layout.css` —— 断点、三视图容器、日视图滚动区这类跨组件规则（v6 起不再有 sheet 定位）
- 断点只有一个：**900 px**（ADR-0005）。不要引入第二个断点，否则测试矩阵翻倍
- 强调色切换（PRD C1）通过 `document.documentElement.style.setProperty('--accent', v)` 实现，持久化到 `settings` store
- **对比度检查**：`--ink-3: #9C9C9C` 在白底上对比度约 2.8:1，**不满足 PRD §5.5 的 4.5:1**。这个颜色只能用于装饰性元素（占位符、禁用态），正文次要信息必须用 `--ink-2: #5C5C5C`（约 7:1）。原型里有用错的地方，迁移时要修
