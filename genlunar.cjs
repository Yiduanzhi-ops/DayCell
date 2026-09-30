const { Solar } = require('lunar-javascript');
// 白名单：只有这些公历纪念日才显示，其余（全民国防教育日/世界住房日/万圣节前夜等）过滤掉
const SF_KEEP = new Set(['国庆节','教师节','元旦','春节','劳动节','儿童节','妇女节','植树节']);
const out = {};
const start = Solar.fromYmd(2026, 8, 24);
for (let i = 0; i < 90; i++) {
  const s = start.next(i), l = s.getLunar();
  const key = `${String(s.getMonth()).padStart(2,'0')}-${String(s.getDay()).padStart(2,'0')}`;
  const dayCn = l.getDayInChinese();
  const lunarDay = dayCn === '初一' ? l.getMonthInChinese() + '月' : dayCn;   // 始终保留
  const jq = l.getJieQi(), lf = l.getFestivals(), sf = s.getFestivals();
  let label = lunarDay, type = '';
  if (lf && lf.length) { label = lf[0]; type = 'f'; }
  else if (sf && sf.length && SF_KEEP.has(sf[0])) { label = sf[0]; type = 'f'; }
  else if (jq) { label = jq; type = 'j'; }
  else if (dayCn === '初一') { type = 'f'; }
  out[key] = [label, type, lunarDay];
}
const lines = Object.entries(out).map(([k,v])=>`'${k}':['${v[0]}','${v[1]}','${v[2]}']`);
let s='';
for(let i=0;i<lines.length;i+=4) s+='  '+lines.slice(i,i+4).join(',')+',\n';
process.stdout.write(s.replace(/,\n$/,'\n'));
