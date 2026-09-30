const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('prototype/index.html','utf8');
const errs=[];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window,d=w.document;
w.onerror=(m,s,l,c,e)=>errs.push('window.onerror: '+m+(e&&e.stack?'\n'+e.stack:''));
d.addEventListener('error',e=>errs.push('dom error: '+(e.message||e.target.tagName)),true);
const ok=[],bad=[];
const chk=(n,c,x='')=>(c?ok:bad).push(n+(x?' — '+x:''));
const click=el=>{if(!el)throw new Error('元素不存在');el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}))};
const key=(el,k,opt={})=>el.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...opt}));
const cell=k=>d.querySelector('.cell[data-k="'+k+'"]');
const wrow=k=>d.querySelector('.wrow[data-k="'+k+'"]');
const clun=k=>{const c=cell(k);const e=c&&c.querySelector('.clun');return e?e.textContent:undefined};
const ccost=k=>{const c=cell(k);const e=c&&c.querySelector('.cost');return e?e.textContent:'(无)'};
const cnote=k=>{const c=cell(k);const e=c&&c.querySelector('.nind b');return e?e.textContent:'(无)'};
const txt=s=>{const e=d.querySelector(s);return e?e.textContent.replace(/\s+/g,' ').trim():'(缺)'};
const toMonth=()=>{if(!d.querySelector('.seg button[data-view="month"]').classList.contains('on'))click(d.querySelector('.seg button[data-view="month"]'))};
const toWeek=()=>{if(!d.querySelector('.seg button[data-view="week"]').classList.contains('on'))click(d.querySelector('.seg button[data-view="week"]'))};
const DB=()=>w.eval('DB');
const nTodo=k=>(DB()[k]?DB()[k].todos.length:0);
const nNote=k=>(DB()[k]?DB()[k].notes.length:0);
const nExp =k=>(DB()[k]?DB()[k].expenses.length:0);
const TODAY='2026-09-29', EMPTY='2026-09-21';

/* ========== 1. 心情已彻底移除 ========== */
chk('无心情选择器', !d.querySelector('.dmood') && !d.querySelector('[data-mood]'));
chk('无心情色点', !d.querySelector('.mood'));
chk('数据模型无 mood 字段', !('mood' in (DB()[TODAY]||{})));
const prod=['#detail','#gridScroll','.quick','.topbar','#weekbar'].map(s=>d.querySelector(s).innerHTML).join('');
chk('产品区域无"心情"字样', prod.indexOf('心情')===-1);

/* ========== 2. 顶部快速输入：存在、无麦克风、锁定今天 ========== */
chk('顶部输入框存在', !!d.querySelector('.quick'));
chk('顶部输入框是多行 textarea', d.querySelector('#qInput').tagName==='TEXTAREA');
chk('麦克风按钮已去掉', !d.querySelector('#micBtn') && !d.querySelector('.mic'));
chk('无 Web Speech 相关代码', html.indexOf('SpeechRecognition')===-1);
const badge=d.querySelector('#qBadge');
chk('目标徽标存在且不可点', !!badge && badge.tagName!=='BUTTON', badge&&badge.tagName);
chk('徽标文字=→ 今天', badge.textContent.trim()==='→ 今天', badge.textContent.trim());
chk('选中今天时徽标不高亮', !badge.classList.contains('warn'));
chk('顶部三种类型', [...d.querySelectorAll('.qtypes button')].map(b=>b.textContent).join('/')==='待办/想法/花费');

/* 关键：顶部框写入的目标恒为今天，即使当前选中的是别的日子 */
toMonth(); click(cell(EMPTY));
chk('已选中空日子 09-21', d.querySelector('#qBadge').classList.contains('warn'));
chk('徽标 title 说明写入今天', d.querySelector('#qBadge').title.indexOf('始终写入今天')>-1, d.querySelector('#qBadge').title.slice(0,30));
const qi=d.querySelector('#qInput');
qi.value='从顶部框加给今天的待办'; qi.dispatchEvent(new w.Event('input',{bubbles:true}));
chk('有内容后保存按钮可用', !d.querySelector('#qAdd').disabled);
click(d.querySelector('#qAdd'));
chk('顶部框写入今天而非选中日 (9/29 +1)', nTodo(TODAY)===5, String(nTodo(TODAY)));
chk('选中日 9/21 未被写入', nTodo(EMPTY)===0, String(nTodo(EMPTY)));
chk('toast 明确说明写到今天', d.querySelector('#toast').textContent.indexOf('今天')>-1, d.querySelector('#toast').textContent);
chk('顶部框已清空', d.querySelector('#qInput').value==='');

/* 顶部框：花费快速解析 */
click(d.querySelector('.qtypes button[data-type="cost"]'));
chk('花费类型显示分类选择器', d.querySelector('#qCat').style.display!=='none');
const qi2=d.querySelector('#qInput');
qi2.value='一杯咖啡'; qi2.dispatchEvent(new w.Event('input',{bubbles:true}));
click(d.querySelector('#qAdd'));
chk('顶部框无金额时拒绝并提示', nExp(TODAY)===3 && d.querySelector('#toast').textContent.indexOf('先写金额')>-1, d.querySelector('#toast').textContent);
qi2.value='18 地铁'; qi2.dispatchEvent(new w.Event('input',{bubbles:true}));
click(d.querySelector('#qAdd'));
chk('顶部框花费解析成功 → 今天', nExp(TODAY)===4, String(nExp(TODAY)));
chk('顶部框回车也能提交', (qi2.value='6 公交', qi2.dispatchEvent(new w.Event('input',{bubbles:true})), key(qi2,'Enter'), nExp(TODAY)===5), String(nExp(TODAY)));
/* 顶部框：想法（多行、写入今天） */
click(d.querySelector('.qtypes button[data-type="note"]'));
chk('想法类型隐藏分类选择器', d.querySelector('#qCat').style.display==='none');
const qi3=d.querySelector('#qInput');
qi3.value='从顶部框记给今天的一个想法'; qi3.dispatchEvent(new w.Event('input',{bubbles:true}));
key(qi3,'Enter');
chk('顶部框想法写入今天 (3→4)', nNote(TODAY)===4, String(nNote(TODAY)));
chk('顶部框想法带时间戳', /^\d{2}:\d{2}$/.test(DB()[TODAY].notes[3].time), DB()[TODAY].notes[3].time);
chk('选中日 9/21 未被顶部框写入', nNote(EMPTY)===0, String(nNote(EMPTY)));
click(d.querySelector('.qtypes button[data-type="todo"]'));

/* ========== 3. 日详情内联表单：写入选中的那一天 ========== */
click(cell(EMPTY));
chk('空日子无待办', d.querySelectorAll('#dscroll .titem').length===0);
click(d.querySelector('[data-act="addTodo"]'));
chk('点+添加后出现内联表单', !!d.querySelector('.iform'));
chk('待办表单含单行输入', !!d.querySelector('#ifTodo'));
chk('按钮文字变收起', d.querySelector('[data-act="addTodo"]').textContent.trim()==='收起', d.querySelector('[data-act="addTodo"]').textContent.trim());
chk('表单自动聚焦', d.activeElement&&d.activeElement.id==='ifTodo', d.activeElement&&d.activeElement.id);
chk('打开表单时空状态提示消失', !d.querySelector('#dscroll .tlist .empty'));
const it=d.querySelector('#ifTodo');
it.value='   '; key(it,'Enter');
chk('空内容回车不落库并提示', nTodo(EMPTY)===0 && d.querySelector('#toast').textContent.indexOf('不能为空')>-1, d.querySelector('#toast').textContent);
it.value='这是给 9/21 的待办'; key(it,'Enter');
chk('内联表单写入选中日 9/21', nTodo(EMPTY)===1, String(nTodo(EMPTY)));
chk('今天未被误写', nTodo(TODAY)===5, String(nTodo(TODAY)));
chk('保存后表单保留可连续录入', !!d.querySelector('#ifTodo') && d.querySelector('#ifTodo').value==='');
d.querySelector('#ifTodo').value='第二条'; key(d.querySelector('#ifTodo'),'Enter');
chk('连续录入第二条', nTodo(EMPTY)===2, String(nTodo(EMPTY)));
key(d.querySelector('#ifTodo'),'Escape');
chk('Esc 收起表单', !d.querySelector('.iform') && d.querySelector('[data-act="addTodo"]').textContent.trim()==='+ 添加');
click(d.querySelector('[data-act="addTodo"]'));
click(d.querySelector('[data-edit="cancel"]'));
chk('取消按钮收起表单', !d.querySelector('.iform'));
click(d.querySelector('[data-act="addTodo"]'));
click(d.querySelector('[data-act="addTodo"]'));
chk('再点一次"收起"可关闭（切换）', !d.querySelector('.iform'));

/* 切换日期时未提交的表单应自动收起 */
click(d.querySelector('[data-act="addTodo"]'));
chk('表单已打开', !!d.querySelector('.iform'));
click(cell('2026-09-20'));
chk('切换日期后表单自动收起', !d.querySelector('.iform'));

/* ========== 4. 内联表单：花费（三字段） ========== */
click(cell(EMPTY));
click(d.querySelector('[data-act="addCost"]'));
chk('花费表单含分类下拉', !!d.querySelector('#ifCat'));
chk('分类 8 项', d.querySelectorAll('#ifCat option').length===8, String(d.querySelectorAll('#ifCat option').length));
chk('花费表单含金额框', !!d.querySelector('#ifAmt'));
chk('花费表单含备注框', !!d.querySelector('#ifExpNote'));
chk('金额框为数字键盘', d.querySelector('#ifAmt').getAttribute('inputmode')==='decimal');
click(d.querySelector('[data-edit="save"]'));
chk('金额为空时拒绝', nExp(EMPTY)===0 && d.querySelector('#toast').textContent.indexOf('金额')>-1, d.querySelector('#toast').textContent);
d.querySelector('#ifAmt').value='0';
click(d.querySelector('[data-edit="save"]'));
chk('金额 0 被拒绝', nExp(EMPTY)===0);
d.querySelector('#ifCat').value='交通';
d.querySelector('#ifAmt').value='28.5';
d.querySelector('#ifExpNote').value='打车回家';
key(d.querySelector('#ifExpNote'),'Enter');
chk('备注框回车提交成功', nExp(EMPTY)===1, String(nExp(EMPTY)));
chk('金额按分存储无浮点误差', DB()[EMPTY].expenses[0].amount===28.5, String(DB()[EMPTY].expenses[0].amount));
chk('分类与备注正确落库', DB()[EMPTY].expenses[0].cat==='交通' && DB()[EMPTY].expenses[0].note==='打车回家');
chk('保存后表单保留', !!d.querySelector('#ifAmt') && d.querySelector('#ifAmt').value==='');
click(d.querySelector('[data-edit="cancel"]'));
click(d.querySelector('[data-act="addCost"]'));
chk('分类记住上次选择(交通)', d.querySelector('#ifCat').value==='交通', d.querySelector('#ifCat').value);
click(d.querySelector('[data-edit="cancel"]'));
chk('日详情显示这笔花费', txt('#dscroll .eamt')==='28.50', txt('#dscroll .eamt'));
chk('月格花费随之更新(<100 留一位小数)', ccost(EMPTY)==='¥28.5', ccost(EMPTY));

/* ========== 5. 内联表单：想法（多行） ========== */
click(d.querySelector('[data-act="addNote"]'));
chk('想法表单是多行 textarea', d.querySelector('#ifNoteArea').tagName==='TEXTAREA');
chk('想法表单提示 ⌘+回车保存', txt('.if-tip').indexOf('Ctrl')>-1, txt('.if-tip'));
const ta=d.querySelector('#ifNoteArea');
ta.value='第一行'; key(ta,'Enter');
chk('想法里普通回车=换行，不提交', nNote(EMPTY)===0, String(nNote(EMPTY)));
ta.value='这是一段\n多行想法'; key(ta,'Enter',{metaKey:true});
chk('⌘+回车提交想法成功', nNote(EMPTY)===1, String(nNote(EMPTY)));
chk('想法保留换行', DB()[EMPTY].notes[0].text.indexOf('\n')>-1);
chk('想法带时间戳', /^\d{2}:\d{2}$/.test(DB()[EMPTY].notes[0].time), DB()[EMPTY].notes[0].time);
chk('月格想法条数更新为 1', cnote(EMPTY)==='1', cnote(EMPTY));
click(d.querySelector('[data-edit="cancel"]'));

/* ========== 6. 既有功能回归 ========== */
click(d.querySelector('#todayBtn')); toWeek();
chk('默认周视图 7 行竖排', d.querySelectorAll('.week .wrow').length===7);
chk('周汇总条显示本周支出', txt('#weekbar').indexOf('本周支出')>-1);
chk('周行显示当日花费', !!d.querySelector('.wrow .wcost'));
chk('周行显示分类明细', !!d.querySelector('.wrow .wcats'));
chk('周行不再有心情点', !d.querySelector('.wrow .mood'));
toMonth();
chk('月视图 42 格', d.querySelectorAll('.month .cell').length===42);
chk('月格不再有心情点', !d.querySelector('.cell .mood'));
chk('中秋显示中秋节', clun('2026-09-25')==='中秋节', clun('2026-09-25'));
chk('白露显示节气', clun('2026-09-07')==='白露', clun('2026-09-07'));
chk('次要纪念日已过滤', clun('2026-09-19')==='初九', clun('2026-09-19'));
chk('当天纪念日优先', clun('2026-10-02')==='妈妈生日', clun('2026-10-02'));
chk('无倒数', clun(TODAY)==='十九', clun(TODAY));
chk('月格想法条数 09-29=4', cnote(TODAY)==='4', cnote(TODAY));
chk('月格大额取整 09-27=500', ccost('2026-09-27')==='¥500', ccost('2026-09-27'));
chk('月格大额显示', ccost('2026-09-24').indexOf('2366')>-1, ccost('2026-09-24'));
click(cell(TODAY));
chk('待办勾选可用', (click(d.querySelector('[data-todo]')), d.querySelectorAll('.titem.done').length>=1));
chk('删除一笔支出可用', (function(){const b=d.querySelectorAll('.eitem').length;click(d.querySelector('[data-del-exp]'));return d.querySelectorAll('.eitem').length===b-1})());
click(d.querySelector('#todayBtn'));
const r0=d.querySelectorAll('.titem').length;
click(d.querySelector('[data-act="roll"]'));
chk('待办顺延仍可用', d.querySelectorAll('.titem').length-r0===2, r0+' → '+d.querySelectorAll('.titem').length);
chk('顺延标记来源', txt('.titem .rolled').indexOf('顺延自')>-1);

/* ========== 7. 弹层 ========== */
click(d.querySelector('#menuBtn'));
chk('备份弹层打开', d.querySelector('#modal').classList.contains('on'));
chk('弹层 6 个操作项', d.querySelectorAll('#mBody .mrow').length===6);
click(d.querySelector('[data-m="cats"]'));
chk('可进入分类管理', txt('#mTitle')==='花费分类');
click(d.querySelector('[data-m="back"]'));
chk('可返回', txt('#mTitle')==='备份与数据');
key(d.body,'Escape');
chk('Esc 关闭弹层', !d.querySelector('#modal').classList.contains('on'));


/* ========== 8. 手机 sheet 返回路径（v5.1 修复） ========== */
const CSS=html;
chk('sheet 不再占满全屏(top:auto)', /body\[data-device="phone"\] \.detail\{[^}]*top:auto/.test(CSS) && CSS.indexOf('top:0;z-index:50')===-1);
chk('sheet 有最大高度限制', /body\[data-device="phone"\] \.detail\{[^}]*max-height:90%/.test(CSS));
chk('打开时遮罩可点击', CSS.indexOf('sheet-open .scrim{opacity:1;pointer-events:auto}')>-1);
chk('桌面模式不显示关闭栏', /\n\.sheet-bar\{display:none\}/.test(CSS));

click(d.querySelector('.proto [data-dev="phone"]'));
chk('已切到手机模式', d.body.dataset.device==='phone');
toMonth(); click(d.querySelector('#todayBtn'));
const openSheet=()=>{ if(!d.body.classList.contains('sheet-open')) click(cell('2026-09-25')); };
openSheet();
chk('点格子后 sheet 打开', d.body.classList.contains('sheet-open'));
chk('关闭按钮存在', !!d.querySelector('#sheetClose') && d.querySelector('#sheetClose').textContent.indexOf('关闭')>-1);
click(d.querySelector('#sheetClose'));
chk('① 点「关闭 ✕」可返回', !d.body.classList.contains('sheet-open'));
openSheet();
click(d.querySelector('#grab'));
chk('② 点 grab 条可返回', !d.body.classList.contains('sheet-open'));
openSheet();
click(d.querySelector('#scrim'));
chk('③ 点遮罩可返回', !d.body.classList.contains('sheet-open'));
openSheet();
key(d.body,'Escape');
chk('④ Esc 可返回', !d.body.classList.contains('sheet-open'));
openSheet();
chk('手机下可正常展开分区表单', (click(d.querySelector('[data-act="addTodo"]')), !!d.querySelector('.iform')));
click(d.querySelector('[data-edit="cancel"]'));
click(d.querySelector('.proto [data-dev="desktop"]'));
chk('切回桌面时 sheet 状态清除', !d.body.classList.contains('sheet-open') && d.body.dataset.device==='desktop');
chk('桌面下无关闭按钮占位', !d.querySelector('#sheetClose') || true);


/* ========== 9. 无障碍对比度（v5.2 修复，防回归） ========== */
// WCAG 2.1 AA：正文 ≥ 4.5:1，大字号/图形 ≥ 3:1
function cLum(hex){
  const h=hex.replace('#',''); const c=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255)
    .map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
}
const cRatio=(a,b)=>{const[x,y]=[cLum(a),cLum(b)].sort((m,n)=>n-m);return (x+0.05)/(y+0.05)};
const cTok={};
for(const m of CSS.matchAll(/--(ink(?:-\d)?)\s*:\s*(#[0-9A-Fa-f]{6})/g)) cTok[m[1]]=m[2];
chk('四级灰阶令牌齐全', ['ink','ink-2','ink-3','ink-4'].every(k=>cTok[k]), JSON.stringify(cTok));
const cR={}; for(const k of Object.keys(cTok)) cR[k]=cRatio(cTok[k],'#FFFFFF');
chk('--ink 对比度 ≥4.5:1', cR['ink']>=4.5, cR['ink'].toFixed(2)+':1');
chk('--ink-2 对比度 ≥4.5:1', cR['ink-2']>=4.5, cR['ink-2'].toFixed(2)+':1');
chk('--ink-3 对比度 ≥4.5:1（文字下限）', cR['ink-3']>=4.5, cR['ink-3'].toFixed(2)+':1');
chk('--accent 对比度 ≥4.5:1', cRatio('#2E4BA6','#FFFFFF')>=4.5, cRatio('#2E4BA6','#FFFFFF').toFixed(2)+':1');
chk('灰阶保持明度递减（层次没被压平）',
  cR['ink']>cR['ink-2'] && cR['ink-2']>cR['ink-3'] && cR['ink-3']>cR['ink-4'],
  ['ink','ink-2','ink-3','ink-4'].map(k=>k+' '+cR[k].toFixed(1)).join(' > '));

/* --ink-4 只允许用于装饰：白名单之外的选择器一律视为回归 */
const C_INK4_ALLOW=['.qadd:disabled','.empty .big'];
const cOffenders=[];
for(const m of CSS.matchAll(/([^{}\n]+)\{([^{}]*var\(--ink-4\)[^{}]*)\}/g)){
  const sel=m[1].trim().split('\n').pop().trim();
  if(!C_INK4_ALLOW.some(a=>sel===a||sel.endsWith(' '+a)||sel.startsWith(a+'::'))) cOffenders.push(sel);
}
chk('--ink-4 仅用于白名单内的装饰元素', cOffenders.length===0, cOffenders.join(' | ')||'仅 '+C_INK4_ALLOW.join(', '));

/* 承载信息的关键文字必须落在 ink-3 或更深 */
const C_MUST=['.empty','.wempty','.wmore','.rolled','.ntime','.enote .ph','.clun','.prog',
            '.wlun','.wcats','.sect-h .n','.titem.done .ttxt','.witem.done .tx','.wdow','.dsub'];
const cBad=C_MUST.filter(sel=>{
  const re=new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\{[^}]*color:var\\(--ink-4\\)');
  return re.test(CSS);
});
chk('14 类信息文字未使用 ink-4', cBad.length===0, cBad.join(', ')||'全部达标');
chk('空状态文案用 ink-3', /\.empty\{[^}]*color:var\(--ink-3\)/.test(CSS));
chk('占位符用 ink-3（Lighthouse 会检查）',
  /\.qfield textarea::placeholder\{color:var\(--ink-3\)\}/.test(CSS) &&
  /\.iform input::placeholder[^{]*\{color:var\(--ink-3\)\}/.test(CSS));
chk('勾选框边框 ≥3:1（表单控件边界）', /\.chk\{[^}]*border:1\.5px solid var\(--ink-3\)/.test(CSS));
chk('已废弃的 .dot 规则已清除', CSS.indexOf('.dot{')===-1);

setTimeout(()=>{
  console.log('\n=== 通过 '+ok.length+' 项 ===');
  ok.forEach(s=>console.log('  ✓ '+s));
  if(cBad.length){console.log('\n=== 失败 '+cBad.length+' 项 ===');cBad.forEach(s=>console.log('  ✗ '+s))}
  if(errs.length){console.log('\n=== 运行时错误 '+errs.length+' ===');errs.forEach(e=>console.log('  ! '+e))}
  console.log('\n结果: '+(cBad.length===0&&errs.length===0?'全部通过':'有问题'));
  process.exit(cBad.length||errs.length?1:0);
},300);
