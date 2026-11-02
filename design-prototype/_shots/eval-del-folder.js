// 核心路径：删除「生活杂事」文件夹 → 内部目标「整理房间」移出到未分类
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 1. 点「生活杂事」组标题的 … 按钮（data-fm=f2）
  const fmBtn = document.querySelector('[data-fm="f2"]');
  if (!fmBtn) { document.title = 'EVAL_FAIL:no-fm-btn'; return; }
  fmBtn.click();
  await wait(250);
  // 2. sheet 出现 → 点「删除文件夹」
  const delBtn = document.querySelector('[data-del-folder="f2"]');
  if (!delBtn) { document.title = 'EVAL_FAIL:no-del-btn'; return; }
  delBtn.click();
  await wait(250);
  // 3. 确认弹层 → 点确认删除
  const confirmBtn = document.querySelector('[data-confirm-del="f2"]');
  if (!confirmBtn) { document.title = 'EVAL_FAIL:no-confirm-btn'; return; }
  confirmBtn.click();
  await wait(300);
  // 4. 断言：f2 文件夹已删除；「整理房间」g4 已移到未分类
  const foldersLeft = state.folders.filter((f) => f.id === 'f2').length;
  const g4 = state.goals.find((g) => g.id === 'g4');
  const orphanCount = state.goals.filter((g) => !g.folder).length;
  const ok =
    foldersLeft === 0 &&
    g4 && g4.folder === null &&
    orphanCount === 3 &&
    !document.querySelector('[data-fm="f2"]');
  document.title = ok ? 'EVAL_PASS' : ('EVAL_FAIL:' + JSON.stringify({ foldersLeft, g4f: g4 && g4.folder, orphanCount }));
})();
