/* DayCell 可点击原型的冒烟测试（jsdom，无浏览器依赖）
   跑法：node smoke.cjs
   覆盖 v6（日/周/月三视图、默认日视图、三条返回路径）
     + v6.1（移除顶部快捷录入行、空白日自动展开内联表单、金额按分取整）
   以及历次修复的防回归：v5.2 对比度、v5.1 返回路径、v4 心情移除。

   注意：本文件用 sec() 把每一节包起来单独 try/catch。
   旧版是一整条直线脚本，任何一处 click(null) 抛错就会让后面所有断言全部跳过、
   而且退出码还只看对比度那一项——功能断言失败被静默吞掉。这两个坑都修了。 */
const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('prototype/index.html','utf8');
const CSS=html;
/* 做"某段代码已删除"这类源码断言时，必须先把注释剥掉。
   否则解释"为什么删掉 .qadd / → 今天 徽标"的那段注释自己就会把断言绊倒——
   第一版就踩了这个坑，5 项失败里 4 项是这么来的。 */
const CODE=CSS.replace(/\/\*[\s\S]*?\*\//g,'').replace(/<!--[\s\S]*?-->/g,'');
const errs=[];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window,d=w.document;
w.onerror=(m,s,l,c,e)=>errs.push('window.onerror: '+m+(e&&e.stack?'\n'+e.stack:''));
d.addEventListener('error',e=>errs.push('dom error: '+(e.message||e.target.tagName)),true);

const ok=[],bad=[];
const chk=(n,c,x='')=>(c?ok:bad).push(n+(x?' — '+x:''));
function sec(name,fn){
  try{ fn() }
  catch(e){ bad.push('【'+name+'】脚本自身异常中断: '+(e&&e.message||e)) }
}
const click=el=>{if(!el)throw new Error('元素不存在');el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}))};
const key=(el,k,opt={})=>el.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...opt}));
const cell=k=>d.querySelector('.cell[data-k="'+k+'"]');
const clun=k=>{const c=cell(k);const e=c&&c.querySelector('.clun');return e?e.textContent:undefined};
const ccost=k=>{const c=cell(k);const e=c&&c.querySelector('.cost');return e?e.textContent:'(无)'};
const cnote=k=>{const c=cell(k);const e=c&&c.querySelector('.nind b');return e?e.textContent:'(无)'};
const txt=s=>{const e=d.querySelector(s);return e?e.textContent.replace(/\s+/g,' ').trim():'(缺)'};
const q=s=>d.querySelector(s);
const view=()=>d.body.dataset.view;
const device=()=>d.body.dataset.device;
const S=()=>w.eval('st');
const toView=v=>{if(view()!==v)click(q('.seg button[data-view="'+v+'"]'))};
const toMonth=()=>toView('month'), toWeek=()=>toView('week'), toDay=()=>toView('day');
const DB=()=>w.eval('DB');
const nTodo=k=>(DB()[k]?DB()[k].todos.length:0);
const nNote=k=>(DB()[k]?DB()[k].notes.length:0);
const nExp =k=>(DB()[k]?DB()[k].expenses.length:0);
const TODAY='2026-09-29', EMPTY='2026-09-21', BLANK2='2026-09-16';
/* jsdom 没有 TouchEvent，用普通 Event 挂上 changedTouches 即可触发原型的监听器 */
const touch=(el,type,x,y)=>{const e=new w.Event(type,{bubbles:true});e.changedTouches=[{clientX:x,clientY:y}];el.dispatchEvent(e)};

/* =================================================================== */
sec('1 默认落地', ()=>{
  /* 必须在最前面、任何交互之前跑：这一节验证的就是"刚打开时长什么样" */
  chk('默认视图 = 日视图', view()==='day', view());
  chk('默认设备 = 桌面', device()==='desktop', device());
  chk('默认选中今天', S().sel===TODAY, S().sel);
  chk('默认游标 = 今天', S().cursor===TODAY, S().cursor);
  const seg=[...d.querySelectorAll('.seg button')];
  chk('切换器恰好 3 个按钮', seg.length===3, String(seg.length));
  chk('切换器顺序固定 日→周→月', seg.map(b=>b.dataset.view).join('|')==='day|week|month',
      seg.map(b=>b.textContent).join(''));
  chk('默认高亮「日」', seg[0].classList.contains('on') && !seg[1].classList.contains('on'));
  chk('直接落地时没有来源栈', S().source===null);
  chk('返回条隐藏（无来源）', !q('#daybar').classList.contains('has-source'));
  chk('日详情标题标出「今天」', txt('.dtitle').indexOf('今天')>-1, txt('.dtitle'));
  chk('日详情显示今天的真实内容', d.querySelectorAll('#dscroll .titem').length===4,
      String(d.querySelectorAll('#dscroll .titem').length));
  chk('日视图下日历不生成 DOM（性能）', q('#gridScroll').innerHTML==='',
      q('#gridScroll').innerHTML.slice(0,40));
  /* CSS 静态约束：日视图收起日历、手机非日视图隐藏日详情 */
  chk('CSS: 日视图隐藏日历', /body\[data-view="day"\] \.cal\{display:none\}/.test(CSS));
  chk('CSS: 日视图主区单列', /body\[data-view="day"\] \.main\{grid-template-columns:minmax\(0,1fr\)\}/.test(CSS));
  chk('CSS: 手机非日视图隐藏日详情',
      /body\[data-device="phone"\]:not\(\[data-view="day"\]\) \.detail\{display:none\}/.test(CSS));
  chk('CSS: 手机主区单列', /body\[data-device="phone"\] \.main\{grid-template-columns:minmax\(0,1fr\)\}/.test(CSS));
});

/* =================================================================== */
sec('2 顶部快捷录入行已移除（v6.1）', ()=>{
  /* 这一节全是防回归：删掉的东西不许再长回来 */
  chk('DOM 无 .quick 容器', !q('.quick'));
  for(const id of ['#qInput','#qCat','#qBadge','#qAdd'])
    chk('DOM 无 '+id, !q(id));
  for(const sel of ['.quick{','.qtypes','.qfield','.qbadge','.qadd','.qcat'])
    chk('CSS 无 '+sel+' 规则', CODE.indexOf(sel)===-1, sel);
  chk('JS 无 syncQuickUI 函数', !/function\s+syncQuickUI/.test(CODE));
  chk('JS 无 quickAdd 函数', !/function\s+quickAdd/.test(CODE));
  chk('JS 无 parseCost 一句话解析', !/function\s+parseCost/.test(CODE));
  chk('JS 无 grow 自动增高', !/function\s+grow/.test(CODE));
  chk('state 无 qtype/qcat', S().qtype===undefined && S().qcat===undefined);
  chk('「→ 今天」徽标文案已消失', CODE.indexOf('→ 今天')===-1);
  chk('「始终写入今天」补丁文案已消失', CODE.indexOf('始终写入今天')===-1);
  /* 麦克风按钮在 v3 就去掉了，顺手一起守 */
  chk('无麦克风按钮', !q('#micBtn') && !q('.mic'));
  chk('无 Web Speech 相关代码', CODE.indexOf('SpeechRecognition')===-1);
  /* 唯一录入路径：日详情各区块的内联表单 */
  chk('三个分区各有内联添加按钮',
      ['addTodo','addCost','addNote'].every(a=>!!q('[data-act="'+a+'"]')),
      ['addTodo','addCost','addNote'].map(a=>a+'='+!!q('[data-act="'+a+'"]')).join(' '));
});

/* =================================================================== */
sec('3 金额取整 toCents（v6.1）', ()=>{
  /* 删掉一句话解析后，#ifAmt 成了唯一的花费入口，它的取整必须和 core parseAmount 同规则。
     Math.round(parseFloat('1.005')*100) === 100，会少记一分。 */
  const c=r=>w.eval('toCents('+JSON.stringify(r)+')');
  chk('旧算法确实会错（对照组）', Math.round(parseFloat('1.005')*100)===100);
  chk('上限与 core LIMITS.maxAmountCents 一致', /MAX_CENTS=9999999900/.test(CSS));
  chk("toCents('1.005') = 101 分（round half up）", c('1.005')===101, String(c('1.005')));
  chk("toCents('1.004') = 100 分", c('1.004')===100, String(c('1.004')));
  chk("toCents('45') = 4500 分", c('45')===4500, String(c('45')));
  chk("toCents('28.5') = 2850 分", c('28.5')===2850, String(c('28.5')));
  chk("toCents('0.07') = 7 分", c('0.07')===7, String(c('0.07')));
  /* 下面这几条是拿 core/validate.ts parseAmount 的真实输出逐个对过的，
     原型不许比 core 宽松（第一版自己吃掉了 ¥ 和内部空格，已改回来） */
  chk("千分位逗号被吃掉（core 同）", c('1,280')===128000, String(c('1,280')));
  chk("全角数字被归一化（core 同）", c('４５．５')===4550, String(c('４５．５')));
  chk("全角句点/句号当小数点（core 同）", c('45。5')===4550, String(c('45。5')));
  chk("28.555 第三位 round half up（US-03）", c('28.555')===2856, String(c('28.555')));
  chk("拒绝 ¥ 前缀（core: NOT_A_NUMBER；放宽与否见 PRD Q6）", c('¥45')===null, String(c('¥45')));
  chk("拒绝内部空格（core: NOT_A_NUMBER）", c('1 200')===null, String(c('1 200')));
  chk("拒绝 0", c('0')===null, String(c('0')));
  chk("拒绝负数", c('-5')===null, String(c('-5')));
  chk("拒绝非数字", c('一杯咖啡')===null, String(c('一杯咖啡')));
  chk("拒绝空串", c('   ')===null, String(c('   ')));
  chk("科学计数法 1e3 被接受（US-03 允许，与 core parseAmount 兜底分支一致）",
      c('1e3')===100000, String(c('1e3')));
  chk('JS 里已无 Math.round(parseFloat', CODE.indexOf('Math.round(parseFloat')===-1);
});

/* =================================================================== */
sec('4 心情已彻底移除（v4）', ()=>{
  toMonth();   /* 让 #gridScroll 真的有内容，否则日视图下它是空的，这一节就白查了 */
  chk('无心情选择器', !q('.dmood') && !q('[data-mood]'));
  chk('无心情色点', !q('.mood'));
  chk('数据模型无 mood 字段', !('mood' in (DB()[TODAY]||{})));
  const prod=['#detail','#gridScroll','#daybar','.topbar','#weekbar']
    .map(s=>(q(s)||{innerHTML:''}).innerHTML).join('');
  chk('产品区域无"心情"字样', prod.indexOf('心情')===-1);
});

/* =================================================================== */
sec('5 空白日自动展开待办表单（v6.1 补速机制）', ()=>{
  toMonth();
  chk('前置：09-21 确实是空白日', nTodo(EMPTY)+nNote(EMPTY)+nExp(EMPTY)===0);
  chk('前置：'+BLANK2+' 也是空白日', nTodo(BLANK2)+nNote(BLANK2)+nExp(BLANK2)===0,
      [nTodo(BLANK2),nNote(BLANK2),nExp(BLANK2)].join('/'));

  click(cell(EMPTY));
  chk('选中空白日后表单自动展开', !!q('.iform') && S().edit==='todo', String(S().edit));
  chk('自动展开的是待办表单', !!q('#ifTodo'));
  chk('输入框已自动聚焦（落地即写）', d.activeElement && d.activeElement.id==='ifTodo',
      d.activeElement && d.activeElement.id);
  chk('按钮文字变成「收起」', txt('[data-act="addTodo"]')==='收起', txt('[data-act="addTodo"]'));
  chk('表单展开时不显示大空状态', !q('#dscroll > .empty'));
  chk('分区空状态不再写死「今天」', txt('#dscroll .sect .empty').indexOf('今天')===-1,
      txt('#dscroll .sect .empty'));
  chk('非今天的分区空状态文案', txt('#dscroll .sect .empty')==='还没有记账',
      txt('#dscroll .sect .empty'));

  /* 收起 = 用户明确说"别弹了"，这一天不再自动展开 */
  click(q('[data-act="addTodo"]'));
  chk('点「收起」后表单关闭', !q('.iform') && S().edit===null);
  chk('收起后记录 formDismissed', S().formDismissed[EMPTY]===1);
  chk('收起后显示大空状态', !!q('#dscroll > .empty'));
  chk('非今天的大空状态用「补记」', txt('#dscroll > .empty').indexOf('补记')>-1, txt('#dscroll > .empty'));
  w.eval('selectDay(TODAY,false)'); click(cell(EMPTY));
  chk('回到同一天不再自动弹（不骚扰）', !q('.iform') && S().edit===null);
  chk('但仍可手动点「+ 添加」', (click(q('[data-act="addTodo"]')), !!q('#ifTodo')));
  click(q('[data-edit="cancel"]'));

  /* 换一个空白日：dismissal 是按日期记的，不该传染 */
  click(cell(BLANK2));
  chk('另一个空白日仍然自动展开', !!q('.iform') && S().edit==='todo');
  chk('另一个空白日的大空状态用「开始记录」/「补记」',
      txt('#dscroll > .empty')==='(缺)' || txt('#dscroll > .empty').indexOf('补记')>-1,
      txt('#dscroll > .empty'));
  click(q('[data-edit="cancel"]'));

  /* 非空白的日子不该自动弹 */
  click(cell('2026-09-20'));
  chk('非空白日不自动展开', !q('.iform') && S().edit===null, String(S().edit));
  chk('非空白日正常显示已有内容', d.querySelectorAll('#dscroll .titem').length===3,
      String(d.querySelectorAll('#dscroll .titem').length));

  /* 手机 + 周/月视图：日详情是 display:none，自动展开没有意义 */
  click(q('.proto [data-dev="phone"]'));
  toMonth(); click(cell(EMPTY));
  chk('手机月视图下点格子直接进日视图', view()==='day', view());
  click(q('#backBtn')); toMonth();
  click(q('.proto [data-dev="desktop"]'));
});

/* =================================================================== */
sec('6 内联表单：待办', ()=>{
  toMonth(); click(cell(EMPTY));
  const t0=nTodo(EMPTY), today0=nTodo(TODAY);
  chk('空日子无待办条目', d.querySelectorAll('#dscroll .titem').length===0);
  click(q('[data-act="addTodo"]'));
  chk('点「+ 添加」出现内联表单', !!q('.iform'));
  chk('待办表单是单行 input', q('#ifTodo') && q('#ifTodo').tagName==='INPUT');
  chk('提示回车保存', txt('.if-tip').indexOf('回车保存')>-1, txt('.if-tip'));
  chk('表单自动聚焦', d.activeElement && d.activeElement.id==='ifTodo',
      d.activeElement && d.activeElement.id);

  const it=q('#ifTodo');
  it.value='   '; key(it,'Enter');
  chk('纯空格回车不落库并提示', nTodo(EMPTY)===t0 && txt('#toast').indexOf('不能为空')>-1, txt('#toast'));
  it.value='这是给 9/21 的待办'; key(it,'Enter');
  chk('内联表单写入选中日 9/21', nTodo(EMPTY)===t0+1, t0+' → '+nTodo(EMPTY));
  chk('今天未被误写（顶部框时代的毛病已根除）', nTodo(TODAY)===today0, today0+' → '+nTodo(TODAY));
  chk('保存后表单保留且清空，可连续录入', !!q('#ifTodo') && q('#ifTodo').value==='');
  q('#ifTodo').value='第二条'; key(q('#ifTodo'),'Enter');
  chk('连续录入第二条', nTodo(EMPTY)===t0+2, String(nTodo(EMPTY)));

  key(q('#ifTodo'),'Escape');
  chk('Esc 收起表单', !q('.iform') && txt('[data-act="addTodo"]')==='+ 添加');
  click(q('[data-act="addTodo"]'));
  click(q('[data-edit="cancel"]'));
  chk('取消按钮收起表单', !q('.iform'));
  click(q('[data-act="addTodo"]'));
  click(q('[data-act="addTodo"]'));
  chk('再点一次「收起」可关闭（切换语义）', !q('.iform'));

  /* 切日期时未提交的表单要收起 */
  click(q('[data-act="addTodo"]'));
  chk('表单已打开', !!q('.iform'));
  click(cell('2026-09-20'));   /* 非空白日，不会被自动展开干扰 */
  chk('切换日期后表单自动收起', !q('.iform') && S().edit===null);
  chk('勾选待办可用', (click(cell(EMPTY)), click(q('[data-todo]')), d.querySelectorAll('.titem.done').length>=1));
});

/* =================================================================== */
sec('7 内联表单：花费', ()=>{
  toMonth(); click(cell(EMPTY));
  const e0=nExp(EMPTY);
  click(q('[data-act="addCost"]'));
  chk('花费表单含分类下拉', !!q('#ifCat'));
  chk('分类 8 项', d.querySelectorAll('#ifCat option').length===8,
      String(d.querySelectorAll('#ifCat option').length));
  chk('花费表单含金额框', !!q('#ifAmt'));
  chk('花费表单含备注框', !!q('#ifExpNote'));
  chk('金额框唤起数字键盘', q('#ifAmt').getAttribute('inputmode')==='decimal');
  chk('金额框右对齐 + 等宽数字', /text-align:right/.test(CSS) && /tabular-nums/.test(CSS));

  click(q('[data-edit="save"]'));
  chk('金额为空时拒绝', nExp(EMPTY)===e0 && txt('#toast').indexOf('金额')>-1, txt('#toast'));
  q('#ifAmt').value='0'; click(q('[data-edit="save"]'));
  chk('金额 0 被拒绝', nExp(EMPTY)===e0);
  q('#ifAmt').value='abc'; click(q('[data-edit="save"]'));
  chk('非数字被拒绝', nExp(EMPTY)===e0);

  q('#ifCat').value='交通'; q('#ifAmt').value='28.5'; q('#ifExpNote').value='打车回家';
  key(q('#ifExpNote'),'Enter');
  chk('备注框回车提交成功', nExp(EMPTY)===e0+1, e0+' → '+nExp(EMPTY));
  const last=DB()[EMPTY].expenses[e0];
  chk('金额 28.5 精确落库无浮点误差', last.amount===28.5, String(last.amount));
  chk('分类与备注正确落库', last.cat==='交通' && last.note==='打车回家',
      JSON.stringify({cat:last.cat,note:last.note}));
  chk('保存后表单保留', !!q('#ifAmt') && q('#ifAmt').value==='');
  click(q('[data-edit="cancel"]'));
  click(q('[data-act="addCost"]'));
  chk('分类记住上次选择（交通）', q('#ifCat').value==='交通', q('#ifCat').value);
  click(q('[data-edit="cancel"]'));
  chk('日详情显示这笔花费', txt('#dscroll .eamt')==='28.50', txt('#dscroll .eamt'));
  chk('月格花费随之更新（<100 留一位小数）', ccost(EMPTY)==='¥28.5', ccost(EMPTY));
  chk('删除一笔支出可用',
      (function(){const b=d.querySelectorAll('.eitem').length;click(q('[data-del-exp]'));
                  return d.querySelectorAll('.eitem').length===b-1})());
  chk('删除后月格花费回落', ccost(EMPTY)==='(无)'||ccost(EMPTY).indexOf('28.5')===-1, ccost(EMPTY));
});

/* =================================================================== */
sec('8 内联表单：想法', ()=>{
  toMonth(); click(cell(EMPTY));
  const n0=nNote(EMPTY);
  click(q('[data-act="addNote"]'));
  chk('想法表单是多行 textarea', q('#ifNoteArea') && q('#ifNoteArea').tagName==='TEXTAREA');
  chk('想法表单提示 ⌘/Ctrl+回车保存', txt('.if-tip').indexOf('Ctrl')>-1, txt('.if-tip'));
  const ta=q('#ifNoteArea');
  ta.value='第一行'; key(ta,'Enter');
  chk('想法里普通回车 = 换行，不提交', nNote(EMPTY)===n0, String(nNote(EMPTY)));
  ta.value='这是一段\n多行想法'; key(ta,'Enter',{metaKey:true});
  chk('⌘+回车提交想法成功', nNote(EMPTY)===n0+1, n0+' → '+nNote(EMPTY));
  const note=DB()[EMPTY].notes[n0];
  chk('想法保留换行', note.text.indexOf('\n')>-1);
  chk('想法带时间戳', /^\d{2}:\d{2}$/.test(note.time), note.time);
  chk('月格想法条数 +1', cnote(EMPTY)===String(n0+1), cnote(EMPTY));
  click(q('[data-edit="cancel"]'));
});

/* =================================================================== */
sec('9 月视图既有功能回归', ()=>{
  click(q('#todayBtn')); toMonth();
  chk('月视图 42 格', d.querySelectorAll('.month .cell').length===42,
      String(d.querySelectorAll('.month .cell').length));
  chk('月格无心情点', !q('.cell .mood'));
  chk('中秋显示中秋节', clun('2026-09-25')==='中秋节', clun('2026-09-25'));
  chk('白露显示节气', clun('2026-09-07')==='白露', clun('2026-09-07'));
  chk('次要纪念日已过滤', clun('2026-09-19')==='初九', clun('2026-09-19'));
  chk('当天纪念日优先于农历日', clun('2026-10-02')==='妈妈生日', clun('2026-10-02'));
  chk('普通日只显示农历日，无倒数', clun(TODAY)==='十九', clun(TODAY));
  chk('月格想法条数 09-29 = 3', cnote(TODAY)==='3', cnote(TODAY));
  chk('月格大额取整 09-27 = 500', ccost('2026-09-27')==='¥500', ccost('2026-09-27'));
  chk('月格大额显示 09-24', ccost('2026-09-24').indexOf('2366')>-1, ccost('2026-09-24'));
});

/* =================================================================== */
sec('10 周视图既有功能回归', ()=>{
  toWeek();
  chk('周视图 7 行竖排', d.querySelectorAll('.week .wrow').length===7,
      String(d.querySelectorAll('.week .wrow').length));
  chk('周汇总条显示本周支出', txt('#weekbar').indexOf('本周支出')>-1, txt('#weekbar'));
  chk('周行显示当日花费', !!q('.wrow .wcost'));
  chk('周行显示分类明细', !!q('.wrow .wcats'));
  chk('周行无心情点', !q('.wrow .mood'));
  chk('周视图隐藏七列星期表头', /body\[data-view="week"\] \.wkhead\{display:none\}/.test(CSS));
});

/* =================================================================== */
sec('11 待办顺延', ()=>{
  toDay(); w.eval('selectDay(TODAY,false)');
  const r0=d.querySelectorAll('.titem').length;
  chk('出现顺延提示条', !!q('[data-act="roll"]'));
  click(q('[data-act="roll"]'));
  chk('前一天未完成待办被顺延过来', d.querySelectorAll('.titem').length-r0===2,
      r0+' → '+d.querySelectorAll('.titem').length);
  chk('顺延标记来源日期', txt('.titem .rolled').indexOf('顺延自')>-1, txt('.titem .rolled'));
});

/* =================================================================== */
sec('12 弹层', ()=>{
  click(q('#menuBtn'));
  chk('备份弹层打开', q('#modal').classList.contains('on'));
  chk('弹层 6 个操作项', d.querySelectorAll('#mBody .mrow').length===6,
      String(d.querySelectorAll('#mBody .mrow').length));
  click(q('[data-m="cats"]'));
  chk('可进入分类管理', txt('#mTitle')==='花费分类', txt('#mTitle'));
  click(q('[data-m="back"]'));
  chk('可从二级页返回', txt('#mTitle')==='备份与数据', txt('#mTitle'));
  key(d.body,'Escape');
  chk('Esc 关闭弹层', !q('#modal').classList.contains('on'));
});

/* =================================================================== */
sec('13 v6 翻日与步进量', ()=>{
  toDay(); w.eval('selectDay(TODAY,false)');
  const sel=()=>S().sel, cur=()=>S().cursor;

  click(q('#nextBtn'));
  chk('日视图「›」步进 1 天', sel()==='2026-09-30', sel());
  chk('翻日不改变当前视图', view()==='day', view());
  click(q('#prevBtn')); click(q('#prevBtn'));
  chk('日视图「‹」步进 1 天', sel()==='2026-09-28', sel());
  key(d.body,'j');        chk('j 键 = 后一天', sel()==='2026-09-29', sel());
  key(d.body,'k');        chk('k 键 = 前一天', sel()==='2026-09-28', sel());
  key(d.body,'ArrowRight');chk('→ 键 = 后一天', sel()==='2026-09-29', sel());
  key(d.body,'ArrowLeft'); chk('← 键 = 前一天', sel()==='2026-09-28', sel());
  click(q('#todayBtn'));
  chk('「今天」回到今天且保留日视图', sel()===TODAY && view()==='day', sel()+'/'+view());

  /* 翻日不能压 history：否则按一次系统返回只退一天，永远退不出日视图 */
  const L=w.history.length;
  click(q('#nextBtn')); click(q('#nextBtn')); key(d.body,'k');
  chk('翻日不增加 history 条目', w.history.length===L, L+' → '+w.history.length);
  click(q('#todayBtn'));

  /* 周/月的步进量不能被日视图带坏 */
  toWeek();
  click(q('#nextBtn'));
  chk('周视图「›」步进 7 天', cur()==='2026-10-06', cur());
  chk('周视图翻页不改变视图', view()==='week', view());
  w.eval('st.cursor=TODAY;st.sel=TODAY;render()');
  toMonth();
  click(q('#nextBtn'));
  chk('月视图「›」步进 1 个月', cur().slice(0,7)==='2026-10', cur());
  click(q('#prevBtn'));
  chk('月视图「‹」退回 9 月', cur().slice(0,7)==='2026-09', cur());
  w.eval('st.cursor=TODAY;st.sel=TODAY;render()');

  /* 边界：原型只有 2026-09 ~ 2026-10 的假数据 */
  toDay(); w.eval('selectDay("2026-09-01",false)');
  click(q('#prevBtn'));
  chk('越过下界被拦住并提示', sel()==='2026-09-01' && txt('#toast').indexOf('假数据')>-1,
      sel()+' / '+txt('#toast'));
  w.eval('selectDay("2026-10-31",false)');
  click(q('#nextBtn'));
  chk('越过上界被拦住并提示', sel()==='2026-10-31', sel());
  w.eval('selectDay(TODAY,false)');
});

/* =================================================================== */
sec('14 v6 手机：点格子进日视图 + 三条返回路径', ()=>{
  click(q('.proto [data-dev="phone"]'));
  chk('已切到手机模式', device()==='phone');
  toMonth(); click(q('#todayBtn'));
  chk('手机月视图下日详情被隐藏（CSS 决定）',
      /body\[data-device="phone"\]:not\(\[data-view="day"\]\) \.detail\{display:none\}/.test(CSS));
  chk('手机下无 sheet / 遮罩残留', !q('#scrim') && !q('#sheetClose') && !q('#grab')
      && CODE.indexOf('sheet-open')===-1);

  const enter=(scroll)=>{
    toMonth(); click(q('#todayBtn'));
    q('#gridScroll').scrollTop=scroll;
    click(cell('2026-09-25'));
  };

  /* --- 进入 --- */
  enter(120);
  chk('点月格 → 跳进全屏日视图', view()==='day', view());
  chk('选中日变成被点的那天', S().sel==='2026-09-25', S().sel);
  chk('来源已记住：视图', S().source && S().source.view==='month', JSON.stringify(S().source));
  chk('来源已记住：游标（不是被点的那天）', S().source && S().source.cursor===TODAY,
      S().source && S().source.cursor);
  chk('来源已记住：滚动位置', S().source && S().source.scrollTop===120,
      String(S().source && S().source.scrollTop));
  chk('进入日视图压了一条 history', w.history.length>=2, String(w.history.length));
  chk('返回条出现', q('#daybar').classList.contains('has-source'));
  chk('返回按钮文案含来源视图', txt('#backBtn').indexOf('月视图')>-1, txt('#backBtn'));
  chk('返回按钮够大（≥36px 触控）', /\.daybar \.back\{[^}]*min-height:36px/.test(CSS)
      || /\.back\{[^}]*min-height:36px/.test(CSS));
  chk('提示左右滑动可翻日', txt('#daybar .hint').indexOf('滑动')>-1, txt('#daybar .hint'));

  /* --- ① 返回按钮 --- */
  click(q('#backBtn'));
  chk('① 点「← 返回」回到月视图', view()==='month', view());
  chk('① 日期还原为来源游标（不是被点那天）', S().sel===TODAY, S().sel);
  chk('① 滚动位置还原', q('#gridScroll').scrollTop===120, String(q('#gridScroll').scrollTop));
  chk('① 来源栈已清空', S().source===null);
  chk('① 返回条收起', !q('#daybar').classList.contains('has-source'));

  /* --- ② popstate（系统右滑手势）。这是第二次进入，专门守 pushed 标记的清理 --- */
  enter(77);
  w.dispatchEvent(new w.Event('popstate'));
  chk('② popstate 可返回月视图', view()==='month', view());
  chk('② 日期还原', S().sel===TODAY, S().sel);
  chk('② 滚动位置还原', q('#gridScroll').scrollTop===77, String(q('#gridScroll').scrollTop));
  chk('② pushed 标记已清（不清的话下次手势会直接退出应用）', w.eval('pushed')===false,
      String(w.eval('pushed')));

  /* --- ③ Esc（桌面键盘；手机没有键盘，所以绝不能只依赖它） --- */
  enter(55);
  key(d.body,'Escape');
  chk('③ Esc 可返回月视图', view()==='month', view());
  chk('③ 滚动位置还原', q('#gridScroll').scrollTop===55, String(q('#gridScroll').scrollTop));

  /* --- 三条路径都不能把人扔回"今天以外的错误状态" --- */
  enter(0);
  chk('反复进出后仍能返回（无状态泄漏）',
      (click(q('#backBtn')), view()==='month' && S().sel===TODAY && S().source===null),
      view()+'/'+S().sel);

  /* --- 从周视图进入 --- */
  /* 用 09-30：#todayBtn 之后当前周是 9/28–10/4，9/25 根本不在这一周里（第一版就选错了） */
  toWeek(); click(q('#todayBtn'));
  chk('前置：09-30 在当前周里', !!q('.wrow[data-k="2026-09-30"]'));
  click(q('.wrow[data-k="2026-09-30"]'));
  chk('点周行也能进日视图', view()==='day', view());
  chk('周视图来源的选中日是 09-30', S().sel==='2026-09-30', S().sel);
  chk('周视图来源文案正确', txt('#backBtn').indexOf('周视图')>-1, txt('#backBtn'));
  click(q('#backBtn'));
  chk('返回到周视图', view()==='week', view());

  /* --- 手机滑动翻日 --- */
  toMonth(); click(q('#todayBtn')); click(cell('2026-09-25'));
  const ds=q('#dscroll');
  touch(ds,'touchstart',300,200); touch(ds,'touchend',100,205);
  chk('左滑 → 后一天', S().sel==='2026-09-26', S().sel);
  chk('滑动翻日不离开日视图', view()==='day', view());
  touch(ds,'touchstart',100,200); touch(ds,'touchend',300,205);
  chk('右滑 → 前一天', S().sel==='2026-09-25', S().sel);
  touch(ds,'touchstart',200,300); touch(ds,'touchend',205,100);
  chk('竖向滑动不翻日（让位给滚动）', S().sel==='2026-09-25', S().sel);
  click(q('#backBtn'));

  /* --- 主动切视图不是"返回"，要清来源栈 --- */
  toMonth(); click(q('#todayBtn')); click(cell('2026-09-25'));
  chk('已进入日视图并带来源', view()==='day' && !!S().source);
  toWeek();
  chk('主动切到周视图会清掉来源栈', S().source===null && !q('#daybar').classList.contains('has-source'));
  key(d.body,'d');
  chk('快捷键切到日视图也没有来源（不该出现返回条）',
      view()==='day' && S().source===null && !q('#daybar').classList.contains('has-source'));

  /* --- 快捷键 d/w/m --- */
  const selBefore=S().sel;   /* 此刻是上面点进来的那天，不是 TODAY；基准必须现取 */
  key(d.body,'w'); chk('w 键 → 周视图', view()==='week', view());
  key(d.body,'m'); chk('m 键 → 月视图', view()==='month', view());
  key(d.body,'d'); chk('d 键 → 日视图', view()==='day', view());
  chk('切视图不改变选中日期', S().sel===selBefore, selBefore+' → '+S().sel);

  /* --- 回桌面 --- */
  toMonth(); click(q('#todayBtn')); click(cell('2026-09-25'));
  click(q('.proto [data-dev="desktop"]'));
  chk('切回桌面时来源栈清除', S().source===null && device()==='desktop');
  chk('桌面日视图下日历被 CSS 收起', /body\[data-view="day"\] \.cal\{display:none\}/.test(CSS));
});

/* =================================================================== */
sec('15 无障碍对比度（v5.2，防回归）', ()=>{
  /* WCAG 2.1 AA：正文 ≥ 4.5:1，大字号/图形 ≥ 3:1 */
  const lum=hex=>{
    const h=hex.replace('#','');
    const c=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255)
      .map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
  };
  const ratio=(a,b)=>{const[x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+0.05)/(y+0.05)};
  const tok={};
  for(const m of CSS.matchAll(/--(ink(?:-\d)?)\s*:\s*(#[0-9A-Fa-f]{6})/g)) tok[m[1]]=m[2];
  chk('四级灰阶令牌齐全', ['ink','ink-2','ink-3','ink-4'].every(k=>tok[k]), JSON.stringify(tok));
  const R={}; for(const k of Object.keys(tok)) R[k]=ratio(tok[k],'#FFFFFF');
  chk('--ink 对比度 ≥4.5:1', R['ink']>=4.5, R['ink'].toFixed(2)+':1');
  chk('--ink-2 对比度 ≥4.5:1', R['ink-2']>=4.5, R['ink-2'].toFixed(2)+':1');
  chk('--ink-3 对比度 ≥4.5:1（文字下限）', R['ink-3']>=4.5, R['ink-3'].toFixed(2)+':1');
  chk('--accent 对比度 ≥4.5:1', ratio('#2E4BA6','#FFFFFF')>=4.5,
      ratio('#2E4BA6','#FFFFFF').toFixed(2)+':1');
  chk('灰阶保持明度递减（层次没被压平）',
      R['ink']>R['ink-2'] && R['ink-2']>R['ink-3'] && R['ink-3']>R['ink-4'],
      ['ink','ink-2','ink-3','ink-4'].map(k=>k+' '+R[k].toFixed(1)).join(' > '));

  /* --ink-4 只允许用于装饰。v6.1 起白名单只剩 .empty .big ——
     .qadd:disabled 随顶部快捷框一起删了，它不该再出现在白名单里。 */
  const ALLOW=['.empty .big'];
  chk('顶部框禁用态样式已随 .quick 一起删除', CODE.indexOf('.qadd:disabled')===-1);
  const off=[];
  for(const m of CSS.matchAll(/([^{}\n]+)\{([^{}]*var\(--ink-4\)[^{}]*)\}/g)){
    const sel=m[1].trim().split('\n').pop().trim();
    if(!ALLOW.some(a=>sel===a||sel.endsWith(' '+a)||sel.startsWith(a+'::'))) off.push(sel);
  }
  chk('--ink-4 仅用于白名单内的装饰元素', off.length===0, off.join(' | ')||'仅 '+ALLOW.join(', '));

  /* 承载信息的关键文字必须落在 ink-3 或更深 */
  const MUST=['.empty','.wempty','.wmore','.rolled','.ntime','.enote .ph','.clun','.prog',
              '.wlun','.wcats','.sect-h .n','.titem.done .ttxt','.witem.done .tx','.wdow','.dsub'];
  const usedBad=MUST.filter(sel=>{
    const re=new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\{[^}]*color:var\\(--ink-4\\)');
    return re.test(CSS);
  });
  chk(MUST.length+' 类信息文字未使用 ink-4', usedBad.length===0, usedBad.join(', ')||'全部达标');
  chk('空状态文案用 ink-3', /\.empty\{[^}]*color:var\(--ink-3\)/.test(CSS));
  chk('占位符用 ink-3（Lighthouse 会检查）',
      /\.iform input::placeholder[^{]*\{color:var\(--ink-3\)\}/.test(CSS));
  chk('顶部框的占位符规则已随之删除', CODE.indexOf('.qfield textarea::placeholder')===-1);
  chk('勾选框边框 ≥3:1（表单控件边界）',
      /\.chk\{[^}]*border:1\.5px solid var\(--ink-3\)/.test(CSS));
  chk('已废弃的 .dot 规则已清除', CODE.indexOf('.dot{')===-1);
  chk('返回按钮触控高度 ≥36px', /min-height:36px/.test(CSS));
});

/* =================================================================== */
setTimeout(()=>{
  console.log('\n=== 通过 '+ok.length+' 项 ===');
  ok.forEach(s=>console.log('  ✓ '+s));
  if(bad.length){ console.log('\n=== 失败 '+bad.length+' 项 ==='); bad.forEach(s=>console.log('  ✗ '+s)) }
  if(errs.length){ console.log('\n=== 运行时错误 '+errs.length+' ==='); errs.forEach(e=>console.log('  ! '+e)) }
  const fail=bad.length+errs.length;
  console.log('\n结果: '+ok.length+' 通过 / '+bad.length+' 失败 / '+errs.length+' 运行时错误 → '
    +(fail?'有问题':'全部通过'));
  process.exit(fail?1:0);
},400);
