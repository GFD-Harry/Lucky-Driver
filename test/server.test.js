// Test tích hợp: chạy server thật, 2 client socket cùng tranh quay.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
let server, room, ownerCookie;

before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-test-'));
  process.env.PORT = String(PORT);
  process.env.DEV_LOGIN = '1';
  process.env.SPIN_MS = '300';
  process.env.SESSION_SECRET = 'test';
  ({ server, room } = await import('../server/index.js'));
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const res = await fetch(BASE + '/api/auth/dev', { method: 'POST' });
  ownerCookie = res.headers.get('set-cookie').split(';')[0];
});

after(() => {
  room.close();
  server.close();
  server.closeAllConnections?.();
});

const json = (r) => r.json();

test('Participant không sửa được cấu hình', async () => {
  const res = await fetch(BASE + '/api/wheel', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('Phòng chưa hoạt động -> participant nhận wheel null', async () => {
  const r = await fetch(BASE + '/api/wheel').then(json);
  assert.equal(r.wheel, null);
});

test('Owner lưu, 2 thiết bị tranh quay: chỉ 1 được, cả 2 nhận kết quả', async () => {
  const body = { name: 'Test', active: true, resultMode: 'remove', options: [{ id: 'a', name: 'A', color: '#ff0000', weight: 1 }, { id: 'b', name: 'B', color: '#00ff00', weight: 0 }] };
  const saved = await fetch(BASE + '/api/wheel', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: ownerCookie }, body: JSON.stringify(body) }).then(json);
  assert.equal(saved.wheel.version, 1);

  const participant = await fetch(BASE + '/api/wheel').then(json);
  assert.equal(participant.wheel.name, 'Test');

  const c1 = connect(BASE, { transports: ['websocket'] });
  const c2 = connect(BASE, { transports: ['websocket'] });
  const removed = new Promise((r) => c2.on('option:removed', r));
  const result = new Promise((r) => c2.on('state', (s) => s.status === 'RESULT' && r(s)));
  await Promise.all([c1, c2].map((c) => new Promise((r) => c.on('connect', r))));

  const emit = (c) => new Promise((r) => c.emit('spin', { version: 1 }, r));
  const [r1, r2] = await Promise.all([emit(c1), emit(c2)]);
  assert.equal([r1.ok, r2.ok].filter(Boolean).length, 1, 'chỉ 1 thiết bị được quay');

  const s = await result;
  assert.equal(s.result.optionId, 'a');
  assert.deepEqual(await removed, { id: 'a', version: 2 });

  // Lịch sử được gửi tới mọi thiết bị
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].name, 'A');
  assert.equal(s.history[0].decision, 'remove');

  // Participant không được quyết định kết quả, không được xóa lịch sử
  const d = await new Promise((r) => c1.emit('decide', { action: 'keep' }, r));
  assert.equal(d.ok, false);
  const hc = await new Promise((r) => c1.emit('history:clear', {}, r));
  assert.equal(hc.ok, false);
  c1.close();
  c2.close();
});
