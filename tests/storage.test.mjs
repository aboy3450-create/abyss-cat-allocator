import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../db.js';
import { DEFAULT_ITEMS } from '../core.js';
const create = name => db.createSave({ name, members:['寶寶','咩咩','爆肝','月'], items:DEFAULT_ITEMS });
test('atomic save, independent saves, zero rounds, notes and durable reload', async () => {
  const first = await create('0919'), second = await create('大D隊');
  let { save } = await db.addRound(first.id, 0, '2026-09-19', [3,0,5,2], 'R8 改石給寶寶');
  ({ save } = await db.addRound(first.id, save.version, '2026-09-20', [0,0,0,0], '零掉落'));
  const loaded = await db.getSave(first.id);
  assert.deepEqual(loaded.next,[3,0,1,2]); assert.equal(loaded.count,2);
  assert.equal((await db.getSave(second.id)).count,0);
  const history = await db.queryHistory(first.id,'2026-09-19','2026-09-20');
  assert.equal(history.rows[1].note,'R8 改石給寶寶');
  assert.equal(history.rows[0].note,'零掉落');
  const days = await db.queryDays(first.id,'2026-09-19','2026-09-20');
  assert.deepEqual(days.rows.map(row => row.qty),[[0,0,0,0],[3,0,5,2]]);
  assert.equal(days.rows[0].count,1);
  const connection = await db.openDB(); connection.onversionchange();
  assert.deepEqual((await db.getSave(first.id)).next, loaded.next);
});
test('simultaneous edits with same version commit once; stale edits fail without partial records', async () => {
  const save = await create('concurrency');
  const writes = await Promise.allSettled([
    db.addRound(save.id,0,'2026-09-19',[1,0,0,0]),
    db.addRound(save.id,0,'2026-09-19',[5,5,5,5])
  ]);
  assert.equal(writes.filter(r => r.status==='fulfilled').length,1);
  assert.equal((await db.getSave(save.id)).count,1);
  assert.equal((await db.queryHistory(save.id,'2026-09-19','2026-09-19')).rows.length,1);
  assert.equal((await db.queryDays(save.id,'2026-09-19','2026-09-19')).rows[0].count,1);
});
test('history paginates in 30-row pages, includes zero entries, isolates dates and saves', async () => {
  let save = await create('pagination');
  for (let i=0; i<65; i++) ({ save } = await db.addRound(save.id,save.version,'2026-09-19',[i%3,0,0,0]));
  const first = await db.queryHistory(save.id,'2026-09-19','2026-09-19');
  const second = await db.queryHistory(save.id,'2026-09-19','2026-09-19',first.rows.at(-1));
  const third = await db.queryHistory(save.id,'2026-09-19','2026-09-19',second.rows.at(-1));
  assert.deepEqual([first.rows.length,second.rows.length,third.rows.length],[30,30,5]);
  assert.deepEqual([first.more,second.more,third.more],[true,true,false]);
  assert.equal(new Set([...first.rows,...second.rows,...third.rows].map(row => row.seq)).size,65);
  assert.equal((await db.queryHistory(save.id,'2026-09-20','2026-09-20')).rows.length,0);
  await assert.rejects(db.queryHistory(save.id,'2026-09-20','2026-09-19'));
});
test('daily pagination does not duplicate or omit a day', async () => {
  let save = await create('daily-pages');
  for (let i=0; i<35; i++) {
    const date = new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10);
    ({ save } = await db.addRound(save.id,save.version,date,[1,0,0,0]));
  }
  const first=await db.queryDays(save.id,'2026-09-01','2026-10-05');
  const second=await db.queryDays(save.id,'2026-09-01','2026-10-05',first.rows.at(-1).date);
  assert.deepEqual([first.rows.length,second.rows.length,second.more],[30,5,false]);
  assert.equal(new Set([...first.rows,...second.rows].map(row=>row.date)).size,35);
});
test('undo restores pointers and daily counts; backup replays remaining rounds and notes into new save', async () => {
  let save=await create('backup');
  ({ save } = await db.addRound(save.id,save.version,'2026-09-19',[3,0,5,2],'R8 改石給寶寶'));
  ({ save } = await db.addRound(save.id,save.version,'2026-09-20',[7,3,9,1],'撤回這筆'));
  save=await db.undoRound(save.id,save.version);
  assert.deepEqual(save.next,[3,0,1,2]);
  assert.equal((await db.queryDays(save.id,'2026-09-20','2026-09-20')).rows.length,0);
  ({ save } = await db.addRound(save.id,save.version,'2026-09-20',[2,0,1,0],'新的紀錄'));
  assert.equal((await db.latestRound(save.id)).seq,3);
  const imported=await db.importSave(await db.exportSave(save.id));
  assert.notEqual(imported.id,save.id); assert.deepEqual(imported.totals,save.totals); assert.deepEqual(imported.next,save.next);
  assert.equal((await db.latestRound(imported.id)).note,'新的紀錄');
  assert.equal((await db.getSave(save.id)).count,2);
});
test('write failure rolls back the round, totals, and daily summary together', async () => {
  const save=await create('failure');
  const original=IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put=function(...args) { if (this.name==='saves') throw new DOMException('Full','QuotaExceededError'); return original.apply(this,args); };
    await assert.rejects(db.addRound(save.id,0,'2026-09-19',[4,3,2,1]),{name:'QuotaExceededError'});
  } finally { IDBObjectStore.prototype.put=original; }
  assert.equal((await db.getSave(save.id)).count,0);
  assert.equal(await db.latestRound(save.id),null);
  assert.equal((await db.queryDays(save.id,'2026-09-19','2026-09-19')).rows.length,0);
});
