import { allocate, sequenceText, localDate, MAX_QUANTITY, roundLabel, compactRoundText, selectedRoundDate } from './core.js';
import * as db from './db.js';

const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = value => value.toLocaleString('zh-TW');
const colors = ['#1d6f6a', '#b46c30', '#7770a2', '#b75848'];
let current = null, latest = null, saves = [], busy = false, navigation = 0;
let history = { query: null, pages: [null], page: 0, result: null };
let automaticDate = true;
function syncDate() {
  $('round-date').value = selectedRoundDate($('round-date').value, automaticDate);
  $('date-mode').textContent = automaticDate ? '自動使用今天' : '手動指定日期';
  $('use-today').hidden = automaticDate;
}
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('abyss-cat-updates') : null;

function notify(message, error = false) {
  $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = false;
}
function confirmAction(message) {
  return new Promise(resolve => {
    const dialog = $('confirm-dialog'); $('confirm-message').textContent = message;
    dialog.returnValue = 'cancel';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal(); $('confirm-cancel').focus();
  });
}
function setBusy(value) {
  busy = value;
  for (const el of document.querySelectorAll('button, #round-form input, #round-form textarea')) el.disabled = value;
  if (!value && history.result) updatePagination();
}
async function action(fn) {
  if (busy) return;
  setBusy(true);
  try { await fn(); }
  catch (error) {
    if (current) { try { await loadSave(current.id, false); } catch {} }
    notify(error.name === 'QuotaExceededError' ? '瀏覽器儲存空間不足，這次沒有寫入。請先匯出備份並釋放空間。' : error.message || '操作失敗，請重試。', true);
  } finally { setBusy(false); }
}
function changed() { channel?.postMessage({ id: current?.id }); }
function remembered() { try { return localStorage.getItem('abyss-cat-selected'); } catch { return null; } }
function remember(id) { try { localStorage.setItem('abyss-cat-selected', id); } catch {} }

async function refreshSaves() {
  saves = (await db.listSaves()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  $('save-count').textContent = saves.length;
  $('save-list').innerHTML = saves.length ? saves.map(save => `<button class="save-button ${current?.id === save.id ? 'active' : ''}" data-save="${esc(save.id)}" ${current?.id === save.id ? 'aria-current="true"' : ''}><strong>▱ ${esc(save.name)}</strong><span>${save.members.map(esc).join('・')}</span><span>${num(save.count)} 輪 · ${num(save.totals.flat().reduce((a,b) => a+b,0))} 個道具</span></button>`).join('') : '<p class="muted small">尚無存檔。先為隊伍取個名字吧。</p>';
  for (const button of $('save-list').querySelectorAll('button')) button.onclick = async () => {
    if (current?.id === button.dataset.save || busy) return;
    if (hasDraft() && !await confirmAction('本輪尚未存檔。切換後會清空目前輸入，要切換嗎？')) return;
    action(() => loadSave(button.dataset.save));
  };
}
function hasDraft() { return !!current && ([...document.querySelectorAll('.quantity')].some(input => input.value !== '0') || !!$('round-note').value.trim()); }
function resetHistory() {
  history = { query: null, pages: [null], page: 0, result: null };
  $('history-results').className = 'history-empty';
  $('history-results').textContent = '選擇日期後查詢；平常不載入歷史明細。';
  $('history-pagination').hidden = true;
}
function switchTab(name) {
  for (const tab of ['allocate', 'history']) {
    $(`${tab}-view`).hidden = name !== tab;
    $(`tab-${tab}`).classList.toggle('active', name === tab);
    if (name === tab) $(`tab-${tab}`).setAttribute('aria-current', 'page'); else $(`tab-${tab}`).removeAttribute('aria-current');
  }
}
async function loadSave(id, clearDraft = true) {
  const request = ++navigation;
  const [save, round] = await Promise.all([db.getSave(id), db.latestRound(id)]);
  if (request !== navigation) return;
  if (!save) throw new Error('這份存檔不存在，請重新選擇。');
  const previous = current?.id;
  current = save; latest = round; remember(id);
  $('workspace').hidden = false; $('empty-state').hidden = true;
  if (clearDraft || previous !== id) {
    renderInputs(); automaticDate = true; syncDate(); $('round-note').value = '';
  }
  renderSave(); resetHistory();
  if (clearDraft) switchTab('allocate');
  await refreshSaves();
}
function renderInputs() {
  $('item-inputs').innerHTML = current.items.map((item, i) => `<div class="item-card" style="--item-color:${colors[i]}"><label class="item-title" for="qty-${i}"><span class="item-mark">◆</span>${esc(item)}</label><input class="quantity" id="qty-${i}" aria-label="${esc(item)} 數量" type="number" inputmode="numeric" min="0" max="${MAX_QUANTITY}" step="1" value="0" required><div class="next-line" id="next-${i}"></div><div class="preview" id="preview-${i}"></div></div>`).join('');
  for (const input of document.querySelectorAll('.quantity')) input.addEventListener('input', renderPreview);
}
function readQuantities() {
  return [...document.querySelectorAll('.quantity')].map(input => input.value.trim() === '' ? NaN : Number(input.value));
}
function renderPreview() {
  if (!current) return;
  let result;
  try { result = allocate(current, readQuantities()); } catch {}
  current.items.forEach((item, i) => {
    $(`next-${i}`).innerHTML = `下一位<strong>${esc(current.members[current.next[i]])}</strong>`;
    $(`preview-${i}`).innerHTML = result ? result.allocations[i].some(Boolean) ? esc(sequenceText(current.members, current.next[i], readQuantities()[i])) : '<span class="muted">本輪 0 個<br>順序維持不變</span>' : '<span class="error">請填入有效的整數</span>';
  });
}
function roundDetails(round) {
  return `<div class="result-grid">${current.items.map((item,i) => `<div class="result-item"><strong style="color:${colors[i]}">${esc(item)} · ${num(round.qty[i])} 個</strong><p>${esc(sequenceText(current.members, round.before[i], round.qty[i]))}</p></div>`).join('')}</div>${round.note ? `<div class="round-note-display"><strong>寶物註解</strong><p>${esc(round.note)}</p></div>` : ''}`;
}
function renderSave() {
  $('save-name').textContent = current.name;
  $('members').innerHTML = current.members.map((member, i) => `<li><span>0${i+1}</span>${esc(member)}</li>`).join('');
  $('save-status').textContent = `已儲存 · ${new Date(current.updatedAt).toLocaleString('zh-TW', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}`;
  $('round-count').textContent = `共 ${num(current.count)} 輪`;
  $('totals-table').innerHTML = `<table><thead><tr><th scope="col">隊員</th>${current.items.map(item => `<th scope="col">${esc(item)}</th>`).join('')}</tr></thead><tbody>${current.members.map((member,p) => `<tr><th scope="row">${esc(member)}</th>${current.items.map((_,i) => `<td>${num(current.totals[i][p])}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><td>總計</td>${current.totals.map(row => `<td>${num(row.reduce((a,b) => a+b,0))}</td>`).join('')}</tr></tfoot></table>`;
  $('last-round').hidden = !latest;
  if (latest) {
    $('last-round').innerHTML = `<div class="section-heading"><div><h2>最近一輪 <span class="muted small">${esc(latest.date)} · 第 ${num(latest.dayRound)} 輪</span></h2></div><div class="latest-actions"><button class="quiet" id="copy-round">複製分配</button><button class="quiet" id="undo-round">撤回這輪</button></div></div><p class="compact-preview">${esc(compactRoundText(current.members, latest))}</p>${roundDetails(latest)}`;
    $('undo-round').onclick = async () => {
      const version = current.version, id = current.id;
      if (busy || !await confirmAction(`撤回 ${roundLabel(latest)}（${latest.date}）？此輪的數量與註解將移除，分配順序會回復到上一輪。`)) return;
      action(async () => { await db.undoRound(id, version); await loadSave(id, false); changed(); notify('已撤回最近一輪，累計與下一位已回復。'); });
    };
    $('copy-round').onclick = () => action(async () => {
      await navigator.clipboard.writeText(compactRoundText(current.members, latest));
      notify('已複製簡短分配，省略 0 個道具；寶物註解保留在紀錄內。');
    });
  }
  renderPreview();
}
function updatePagination() {
  $('history-pagination').hidden = !history.result?.rows.length;
  $('history-prev').disabled = history.page === 0;
  $('history-next').disabled = !history.result?.more;
  $('history-page').textContent = `第 ${history.page + 1} 頁`;
}
async function fetchHistory() {
  const query = history.query;
  const result = await (query.mode === 'days' ? db.queryDays : db.queryHistory)(current.id, query.from, query.to, history.pages[history.page]);
  history.result = result;
  const last = result.rows.at(-1);
  if (result.more) history.pages[history.page + 1] = query.mode === 'days' ? last.date : { date: last.date, seq: last.seq };
  $('history-results').className = result.rows.length ? '' : 'history-empty';
  if (!result.rows.length) $('history-results').textContent = '這段日期沒有紀錄。';
  else if (query.mode === 'days') {
    $('history-results').innerHTML = `<div class="table-scroll"><table><thead><tr><th>日期</th><th>輪數</th>${current.items.map(item => `<th>${esc(item)}</th>`).join('')}<th>明細</th></tr></thead><tbody>${result.rows.map(day => `<tr><td>${esc(day.date)}</td><td>${num(day.count)}</td>${day.qty.map(n => `<td>${num(n)}</td>`).join('')}<td><button class="quiet" data-day="${day.date}">查看</button></td></tr>`).join('')}</tbody></table></div><p class="small muted footnote">點「查看」可讀取當天的分配與寶物註解。</p>`;
    for (const button of $('history-results').querySelectorAll('[data-day]')) button.onclick = () => action(async () => {
      $('history-from').value = $('history-to').value = button.dataset.day; $('history-mode').value = 'rounds';
      await startHistory();
    });
  } else $('history-results').innerHTML = result.rows.map(round => `<article class="history-round"><h3>${esc(round.date)} · 第 ${num(round.dayRound)} 輪</h3>${roundDetails(round)}</article>`).join('');
  updatePagination();
}
async function startHistory() {
  history = { query: { from: $('history-from').value, to: $('history-to').value, mode: $('history-mode').value }, pages: [null], page: 0, result: null };
  await fetchHistory();
}
function openCreate() {
  if (busy) return;
  $('create-form').reset(); $('create-error').hidden = true; $('create-dialog').showModal(); $('new-name').focus();
}
function download(content, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$('new-save').onclick = $('empty-create').onclick = openCreate;
$('close-create').onclick = () => $('create-dialog').close();
$('create-form').onsubmit = async event => {
  event.preventDefault();
  if (hasDraft() && !await confirmAction('建立新存檔會清空目前尚未存檔的輸入，要繼續嗎？')) return;
  action(async () => {
    try {
      const save = await db.createSave({ name: $('new-name').value, members: [...document.querySelectorAll('[name=member]')].map(el => el.value) });
      $('create-dialog').close(); await loadSave(save.id); changed(); notify(`已建立「${save.name}」，四人順序已固定。`);
    } catch (error) { $('create-error').textContent = error.message; $('create-error').hidden = false; }
  });
};
$('round-form').onsubmit = event => {
  event.preventDefault();
  syncDate();
  action(async () => {
    const result = await db.addRound(current.id, current.version, $('round-date').value, readQuantities(), $('round-note').value);
    current = result.save; latest = result.round;
    for (const input of document.querySelectorAll('.quantity')) input.value = '0';
    $('round-note').value = ''; renderSave(); resetHistory(); await refreshSaves(); changed();
    notify(`${roundLabel(latest)} 已存檔${latest.qty.every(n => n === 0) ? '（四種道具皆為 0，順序維持不變）' : ''}。`);
  });
};
$('tab-allocate').onclick = () => switchTab('allocate');
$('tab-history').onclick = () => switchTab('history');
$('history-form').onsubmit = event => { event.preventDefault(); action(startHistory); };
$('history-next').onclick = () => action(async () => { history.page++; await fetchHistory(); });
$('history-prev').onclick = () => action(async () => { history.page--; await fetchHistory(); });
$('export-backup').onclick = () => action(async () => {
  const backup = await db.exportSave(current.id);
  download(JSON.stringify(backup, null, 2), `深淵貓本_${current.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}_${localDate()}.json`);
  notify(`已匯出「${current.name}」的完整備份，包含所有歷史與註解。`);
});
$('import-backup').onclick = () => { if (!busy) $('backup-file').click(); };
$('backup-file').onchange = async event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  if (hasDraft() && !await confirmAction('匯入後會切換到新存檔，並清空目前尚未存檔的輸入，要繼續嗎？')) return;
  action(async () => {
    if (file.size > 100 * 1024 * 1024) throw new Error('備份檔超過 100 MB，請確認檔案是否正確。');
    let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('無法讀取備份檔，請選擇匯出的 JSON 檔案。'); }
    const save = await db.importSave(data); await loadSave(save.id); changed(); notify(`已匯入「${save.name}」為獨立存檔，原有存檔未覆蓋。`);
  });
};
async function checkExternalUpdate() {
  if (busy || !current) return;
  const fresh = await db.getSave(current.id);
  if (fresh && fresh.version !== current.version) { await loadSave(current.id, false); notify('其他分頁更新了這份存檔，累計和分配預覽已同步；尚未送出的輸入仍保留。'); }
  else await refreshSaves();
}
if (channel) channel.onmessage = () => checkExternalUpdate().catch(error => notify(error.message, true));
$('round-date').addEventListener('change', () => { automaticDate = $('round-date').value === localDate(); syncDate(); });
$('use-today').onclick = () => { automaticDate = true; syncDate(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncDate(); checkExternalUpdate().catch(error => notify(error.message, true)); } });
window.addEventListener('focus', syncDate);
setInterval(() => { if (!document.hidden && !busy) syncDate(); }, 30000);
window.addEventListener('beforeunload', event => { if (hasDraft()) { event.preventDefault(); event.returnValue = ''; } });
async function start() {
  $('round-date').value = $('history-from').value = $('history-to').value = localDate();
  try {
    await db.openDB(); await refreshSaves();
    const id = remembered();
    if (saves.length) await loadSave(saves.some(save => save.id === id) ? id : saves[0].id);
    else $('empty-state').hidden = false;
  } catch (error) { $('save-list').textContent = '無法讀取本機存檔。'; notify(`無法開啟本機資料庫，請確認瀏覽器允許儲存網站資料。${error.message}`, true); }
}
start();
