import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import * as store from './store.js';
import * as auth from './auth.js';
import { SpinRoom, STATUS } from './spin.js';

const PORT = Number(process.env.PORT) || 3000;
const SPIN_MS = Number(process.env.SPIN_MS) || 6000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.set('trust proxy', 1); // để req.secure đúng khi chạy sau proxy HTTPS (Render, Cloudflare...)
const server = http.createServer(app);
const io = new Server(server);

const room = new SpinRoom({
  store,
  spinMs: SPIN_MS,
  onState: (state) => io.emit('state', state),
  onRemoved: (event) => io.emit('option:removed', event),
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(store.UPLOAD_DIR, { maxAge: '30d', immutable: true }));

function requireOwner(req, res, next) {
  if (auth.isOwnerReq(req)) return next();
  res.status(403).json({ error: 'Chỉ Owner mới được thực hiện thao tác này' });
}

// ---------- Auth ----------
app.get('/api/config', (req, res) => {
  res.json({ googleClientId: auth.GOOGLE_CLIENT_ID, devLogin: auth.DEV_LOGIN });
});

app.get('/api/me', (req, res) => {
  const email = auth.ownerFromCookieHeader(req.headers.cookie);
  res.json({ isOwner: Boolean(email), email });
});

// URL Google gửi kết quả đăng nhập về. Phải khai báo y hệt trong Google Cloud Console
// (Authorized redirect URIs). Đặt PUBLIC_URL nếu chạy sau proxy mà host bị sai.
function googleRedirectUri(req) {
  const base = process.env.PUBLIC_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
  return base + '/auth/google/callback';
}

function loginError(res, message) {
  res.redirect(303, '/editor.html?login_error=' + encodeURIComponent(message));
}

app.get('/auth/google', (req, res) => {
  if (!auth.GOOGLE_CLIENT_ID) return loginError(res, 'Server chưa cấu hình GOOGLE_CLIENT_ID (xem README)');
  res.redirect(auth.googleAuthUrl(googleRedirectUri(req)));
});

app.post('/auth/google/callback', express.urlencoded({ extended: false }), async (req, res) => {
  if (req.body?.error) return loginError(res, 'Google trả về lỗi: ' + req.body.error);
  try {
    const email = await auth.verifyGoogleCallback(req.body || {});
    if (!auth.isOwnerEmail(email)) return loginError(res, `Tài khoản ${email} không có quyền Owner. Hãy chọn tài khoản khác.`);
    auth.setSessionCookie(req, res, email);
    res.redirect(303, '/editor.html');
  } catch (err) {
    console.warn('[auth] Đăng nhập Google thất bại:', err.message);
    loginError(res, 'Đăng nhập thất bại: ' + err.message);
  }
});

// Chỉ dùng khi phát triển local (DEV_LOGIN=1) – đăng nhập Owner không cần Google.
if (auth.DEV_LOGIN) {
  console.warn('[auth] DEV_LOGIN đang BẬT – không dùng trên production!');
  app.post('/api/auth/dev', (req, res) => {
    auth.setSessionCookie(req, res, auth.OWNER_EMAILS[0]);
    res.json({ isOwner: true, email: auth.OWNER_EMAILS[0] });
  });
}

app.post('/api/auth/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- Wheel ----------
app.get('/api/wheel', (req, res) => {
  const wheel = store.getWheel();
  if (!wheel) return res.json({ wheel: null });
  if (!wheel.active && !auth.isOwnerReq(req)) return res.json({ wheel: null, inactive: true });
  res.json({ wheel });
});

app.put('/api/wheel', requireOwner, (req, res) => {
  if (room.status === STATUS.SPINNING) return res.status(409).json({ error: 'Đang quay, hãy lưu lại sau khi quay xong' });
  const { value, error } = store.sanitizeWheel(req.body);
  if (error) return res.status(400).json({ error });
  const wheel = store.saveWheel(value);
  room.resetAfterConfigChange();
  res.json({ wheel });
});

app.post(
  '/api/upload',
  requireOwner,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: '15mb' }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'File ảnh không hợp lệ' });
    res.json({ url: store.saveUpload(req.body, req.headers['content-type']) });
  },
);

// ---------- Realtime ----------
io.on('connection', (socket) => {
  const isOwner = Boolean(auth.ownerFromCookieHeader(socket.handshake.headers.cookie));
  socket.emit('state', room.publicState());

  socket.on('spin', (payload, ack) => {
    const res = room.requestSpin(socket.id, { isOwner, version: payload?.version });
    if (typeof ack === 'function') ack(res);
  });

  socket.on('decide', (payload, ack) => {
    const res = isOwner ? room.decide(payload?.action) : { ok: false, error: 'Chỉ Owner được quyết định giữ/xóa kết quả' };
    if (typeof ack === 'function') ack(res);
  });

  socket.on('history:clear', (payload, ack) => {
    const res = isOwner ? room.clearHistory() : { ok: false, error: 'Chỉ Owner được xóa lịch sử' };
    if (typeof ack === 'function') ack(res);
  });

  socket.on('disconnect', () => room.handleDisconnect(socket.id));
});

server.listen(PORT, () => {
  console.log(`Lucky Wheel chạy tại http://localhost:${PORT}  (Owner: ${auth.OWNER_EMAILS.join(', ')})`);
});

export { server, room };
