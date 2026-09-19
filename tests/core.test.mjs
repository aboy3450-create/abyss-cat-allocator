import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, newSave, DEFAULT_ITEMS, validateBackup, sequenceText, validDate, validNote, compactRoundText, selectedRoundDate } from '../core.js';
const fresh = () => newSave({ id: 'test', name: '0919', members: ['寶寶', '咩咩', '爆肝', '月'], items: DEFAULT_ITEMS });
test('each item continues independently; zero does not move its pointer', () => {
  const save = fresh();
  const first = allocate(save, [3, 0, 5, 2]);
  assert.deepEqual(first.next, [3, 0, 1, 2]);
  Object.assign(save, first);
  const second = allocate(save, [2, 0, 1, 0]);
  assert.deepEqual(second.allocations, [[1,0,0,1], [0,0,0,0], [0,1,0,0], [0,0,0,0]]);
  assert.deepEqual(second.next, [1,0,2,2]);
  assert.deepEqual(second.totals, [[2,1,1,1], [0,0,0,0], [2,2,1,1], [1,1,0,0]]);
});
test('long-term distribution equals a single uninterrupted round', () => {
  const save = fresh(), total = [0,0,0,0];
  for (let i = 0; i < 10000; i++) {
    const qty = [i%7, i%11, i%13, i%17];
    qty.forEach((n,j) => total[j] += n);
    Object.assign(save, allocate(save, qty));
  }
  const once = allocate(fresh(), total);
  assert.deepEqual(save.totals, once.totals); assert.deepEqual(save.next, once.next);
  for (const row of save.totals) assert.ok(Math.max(...row) - Math.min(...row) <= 1);
});
test('invalid quantities, duplicate names, invalid dates and notes fail', () => {
  for (const n of [-1, 1.5, NaN, Infinity, 1000001, '1']) assert.throws(() => allocate(fresh(), [n,0,0,0]));
  assert.throws(() => newSave({ ...fresh(), members: ['寶寶','寶寶','月','咩咩'] }));
  assert.throws(() => validDate('2026-02-30')); assert.throws(() => validNote('a'.repeat(2001)));
});
test('backup replay restores notes, fixed member order and zero rounds, ignoring manipulated derived data', () => {
  const original = fresh(); original.next = [3,3,3,3]; original.totals = [[999]];
  const result = validateBackup({ format:'abyss-cat-backup', schema:1, save:original, rounds:[
    { seq:1, date:'2026-09-19', at:'2026-09-19T12:00:00Z', qty:[3,0,5,2], note:'R8 改石給寶寶' },
    { seq:3, date:'2026-09-20', at:'2026-09-20T12:00:00Z', qty:[0,0,0,0], note:'本輪沒掉落' }
  ] }, 'new-id');
  assert.equal(result.save.id, 'new-id'); assert.equal(result.save.count, 2);
  assert.deepEqual(result.save.next,[3,0,1,2]);
  assert.deepEqual(result.save.members, ['寶寶','咩咩','爆肝','月']);
  assert.equal(result.rounds[0].note, 'R8 改石給寶寶');
  assert.equal(result.days[1].count,1); assert.deepEqual(result.days[1].qty,[0,0,0,0]);
});
test('sequence includes full cycles without expanding a million individual entries', () => {
  assert.equal(sequenceText(fresh().members,3,2),'月 → 寶寶');
  assert.equal(sequenceText(fresh().members,0,0),'本輪 0 個，順序不變');
  assert.ok(sequenceText(fresh().members,0,1000000).length < 100);
});
test('game copy is one compact line with daily numbering and no zero items or notes', () => {
  const save = fresh();
  const result = allocate(save,[1,1,0,0]);
  assert.equal(compactRoundText(save.members,{date:'2026-09-19',dayRound:1,qty:[1,1,0,0],note:'very long note',...result}), '0919(1) 證明：寶寶。 (100)：寶寶。');
  assert.equal(compactRoundText(save.members,{date:'2026-09-20',dayRound:2,qty:[0,0,0,0],...allocate(save,[0,0,0,0])}), '0920(2)');
  save.next=[3,0,0,0];
  assert.equal(compactRoundText(save.members,{date:'2026-09-20',dayRound:3,qty:[5,0,0,0],...allocate(save,[5,0,0,0])}), '0920(3) 證明：月×2、寶寶、咩咩、爆肝。');
});
test('automatic date follows midnight while explicit historical date stays selected', () => {
  assert.equal(selectedRoundDate('2026-09-19',true,'2026-09-20'),'2026-09-20');
  assert.equal(selectedRoundDate('2026-09-19',false,'2026-09-20'),'2026-09-19');
  assert.deepEqual(newSave({...fresh(),items:['a','b','c','d']}).items,DEFAULT_ITEMS);
});
