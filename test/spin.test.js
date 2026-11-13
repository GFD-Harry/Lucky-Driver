import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWeighted, SpinRoom } from '../server/spin.js';

test('pickWeighted: phân phối theo trọng số, weight 0 không bao giờ ra', () => {
  const opts = [
    { id: 'A', weight: 5 },
    { id: 'B', weight: 3 },
    { id: 'C', weight: 2 },
    { id: 'Z', weight: 0 },
  ];
  const count = { A: 0, B: 0, C: 0, Z: 0 };
  const N = 100000;
  for (let i = 0; i < N; i++) count[pickWeighted(opts).id]++;
  assert.equal(count.Z, 0);
  assert.ok(Math.abs(count.A / N - 0.5) < 0.01);
  assert.ok(Math.abs(count.B / N - 0.3) < 0.01);
  assert.ok(Math.abs(count.C / N - 0.2) < 0.01);
});

test('pickWeighted: danh sách rỗng hoặc toàn weight 0 -> null', () => {
  assert.equal(pickWeighted([]), null);
  assert.equal(pickWeighted([{ id: 'a', weight: 0 }]), null);
});

function fakeStore(options, extra = {}) {
  let wheel = { name: 'T', active: true, resultMode: 'ask', options, version: 1, ...extra };
  return {
    getWheel: () => wheel,
    removeOption(id) {
      wheel = { ...wheel, options: wheel.options.filter((o) => o.id !== id), version: wheel.version + 1 };
      return wheel.version;
    },
  };
}

test('Spin lock: chỉ 1 thiết bị quay, tự nhả lock khi hết lượt', async () => {
  const room = new SpinRoom({ store: fakeStore([{ id: 'a', weight: 1 }]), spinMs: 50 });
  assert.equal(room.requestSpin('s1', { version: 1 }).ok, true);
  const second = room.requestSpin('s2', { version: 1 });
  assert.equal(second.ok, false);
  assert.equal(room.status, 'SPINNING');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(room.status, 'RESULT');
  assert.equal(room.result.optionId, 'a');
  room.close();
});

test('Mất kết nối khi đang quay: lock vẫn được nhả', async () => {
  const room = new SpinRoom({ store: fakeStore([{ id: 'a', weight: 1 }], { resultMode: 'keep' }), spinMs: 50 });
  room.requestSpin('s1', { version: 1 });
  room.handleDisconnect('s1');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(room.status, 'RESULT');
  assert.equal(room.requestSpin('s2', { version: 1 }).ok, true);
  room.close();
});

test('Watchdog: SPINNING quá hạn sẽ bị kết thúc', () => {
  let t = 0;
  const room = new SpinRoom({ store: fakeStore([{ id: 'a', weight: 1 }]), spinMs: 1000, graceMs: 500, now: () => t });
  room.requestSpin('s1', { version: 1 });
  clearTimeout(room.timer); // giả lập timer không chạy
  t = 2000;
  room.checkTimeout();
  assert.equal(room.status, 'RESULT');
  room.close();
});

test('Chế độ ask: chờ Owner quyết định, remove xóa option', async () => {
  const removed = [];
  const store = fakeStore([{ id: 'a', weight: 1 }, { id: 'b', weight: 0 }]);
  const room = new SpinRoom({ store, spinMs: 10, onRemoved: (e) => removed.push(e) });
  room.requestSpin('s1', { version: 1 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(room.awaitingDecision, true);
  assert.equal(room.requestSpin('s1', { version: 1 }).ok, false);
  assert.equal(room.decide('remove').ok, true);
  assert.deepEqual(removed, [{ id: 'a', version: 2 }]);
  assert.deepEqual(store.getWheel().options.map((o) => o.id), ['b']);
  // Chỉ còn option weight 0 -> không quay được
  assert.equal(room.requestSpin('s1', { version: 2 }).ok, false);
  room.close();
});

test('Lịch sử dùng chung: ghi mỗi lượt, cập nhật quyết định, owner xóa được', async () => {
  const store = fakeStore([{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 1 }]);
  const room = new SpinRoom({ store, spinMs: 10 });
  room.requestSpin('s1', { version: 1 });
  assert.equal(room.publicState().history.length, 0, 'chưa có kết quả khi đang quay');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(room.publicState().history[0].decision, 'pending');
  room.decide('remove');
  const h = room.publicState().history;
  assert.equal(h.length, 1);
  assert.equal(h[0].decision, 'remove');
  room.requestSpin('s2', { version: 2 });
  await new Promise((r) => setTimeout(r, 30));
  room.decide('keep');
  assert.deepEqual(room.publicState().history.map((x) => x.decision), ['keep', 'remove']);
  room.clearHistory();
  assert.equal(room.publicState().history.length, 0);
  room.close();
});

test('Từ chối quay khi cấu hình client đã cũ hoặc phòng đóng', () => {
  const room = new SpinRoom({ store: fakeStore([{ id: 'a', weight: 1 }], { active: false }), spinMs: 10 });
  assert.equal(room.requestSpin('s1', { version: 1 }).ok, false); // participant, phòng đóng
  assert.equal(room.requestSpin('s1', { version: 0, isOwner: true }).ok, false); // version cũ
  assert.equal(room.requestSpin('s1', { version: 1, isOwner: true }).ok, true);
  room.close();
});
