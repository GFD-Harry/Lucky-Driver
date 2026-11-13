import { WheelView } from './wheel.js';
import { api, toast, shareLink, escapeHtml, renderHistoryList, setAttentionTitle } from './common.js';

const $ = (id) => document.getElementById(id);

const app = {
  me: { isOwner: false },
  wheel: null, // cấu hình đã tải lúc mở trang (BR-08: không tự cập nhật)
  loadedVersion: 0,
  state: null, // trạng thái runtime mới nhất từ server
  clockOffset: 0,
  animatingSpinId: null,
  shownResultSpinId: null,
  pendingRemovals: [],
  overlayOpen: false,
  view: null,
};

init();

async function init() {
  $('share-btn').onclick = shareLink;
  $('spin-btn').onclick = requestSpin;
  $('overlay-close').onclick = closeOverlay;
  $('clear-history').onclick = clearHistory;
  $('logout-btn').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  };
  document.querySelectorAll('[data-decide]').forEach((b) => (b.onclick = () => decide(b.dataset.decide)));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && app.overlayOpen && closeOverlay());

  try {
    const [me, { wheel }] = await Promise.all([api('/api/me'), api('/api/wheel')]);
    app.me = me;
    app.wheel = wheel;
  } catch (err) {
    toast('Không tải được dữ liệu: ' + err.message, 'error');
  }

  const owner = app.me.isOwner;
  $('edit-link').hidden = !owner;
  $('owner-link').hidden = owner;
  $('logout-btn').hidden = !owner;
  $('clear-history').hidden = !owner;

  if (!app.wheel) {
    showInactive();
  } else {
    app.loadedVersion = app.wheel.version;
    $('wheel-name').textContent = app.wheel.name || 'Lucky Wheel';
    app.baseTitle = document.title = (app.wheel.name || 'Lucky Wheel') + ' – Lucky Wheel';
    $('main').hidden = false;
    app.view = new WheelView($('wheel'));
    app.view.setOptions(app.wheel.options, { animate: false });
  }
  connectSocket();
}

function showInactive() {
  $('main').hidden = true;
  $('inactive').hidden = false;
  if (app.me.isOwner) {
    $('inactive-text').textContent = 'Chưa có vòng quay hoặc phòng đang đóng.';
    $('inactive-owner-link').hidden = false;
  }
}

function connectSocket() {
  // eslint-disable-next-line no-undef
  const socket = io({ transports: ['websocket', 'polling'] });
  app.socket = socket;
  socket.on('connect', () => setConn(true));
  socket.on('disconnect', () => setConn(false));
  socket.io.on('reconnect_attempt', () => setConn(false, 'Đang kết nối lại…'));
  socket.on('state', onState);
  socket.on('option:removed', onOptionRemoved);
}

function setConn(ok, text) {
  $('conn').className = 'conn ' + (ok ? 'ok' : 'bad');
  $('conn').querySelector('span').textContent = text || (ok ? 'Đã kết nối' : 'Mất kết nối');
  render();
}

// ---------------- Runtime state ----------------

function onState(state) {
  app.state = state;
  app.clockOffset = state.serverNow - Date.now();

  // Đang ở màn "chưa hoạt động" mà phòng vừa mở -> tự tải lại.
  if (!app.wheel) {
    if (state.active) location.reload();
    return;
  }

  const spin = state.spin;
  if (state.status === 'SPINNING' && spin && app.animatingSpinId !== spin.id && !isStale()) {
    startAnimation(spin);
  }
  if (state.status === 'RESULT' && state.result && app.shownResultSpinId !== state.result.spinId) {
    if (app.animatingSpinId === state.result.spinId) {
      // Animation vẫn đang chạy -> hiển thị khi quay xong (xem startAnimation).
    } else {
      // Vào trang sau khi đã quay xong: đặt kim vào ô kết quả.
      app.shownResultSpinId = state.result.spinId;
      if (!isStale() && spin) app.view.snapTo(state.result.optionId, spin.offset);
      // Owner: nếu kết quả đang chờ quyết định thì bật luôn màn hình kết quả + nút Giữ/Xóa.
      if (app.me.isOwner && state.awaitingDecision) openOverlay(state.result);
    }
  }
  render();
}

async function startAnimation(spin) {
  app.animatingSpinId = spin.id;
  render();
  await app.view.spinTo(spin, app.clockOffset);
  // Chờ server xác nhận RESULT (thường đến cùng lúc animation kết thúc).
  const result = await waitForResult(spin.id);
  app.animatingSpinId = null;
  if (result && app.shownResultSpinId !== spin.id) {
    app.shownResultSpinId = spin.id;
    openOverlay(result);
  }
  flushRemovals();
  render();
}

function waitForResult(spinId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function check() {
      const s = app.state;
      if (s?.result?.spinId === spinId) return resolve(s.result);
      if (s && s.status !== 'SPINNING' && s.spin?.id !== spinId) return resolve(null); // bị reset
      if (Date.now() - t0 > timeoutMs) return resolve(null);
      setTimeout(check, 100);
    })();
  });
}

function onOptionRemoved({ id, version }) {
  if (app.loadedVersion !== version - 1) return; // đang dùng cấu hình cũ -> banner reload sẽ hiện
  app.loadedVersion = version;
  app.wheel.options = app.wheel.options.filter((o) => o.id !== id);
  app.pendingRemovals.push(id);
  flushRemovals();
}

/** Chỉ chạy animation xóa khi người dùng đã đóng màn hình kết quả để họ nhìn thấy. */
function flushRemovals() {
  if (app.overlayOpen || app.view.isSpinning || !app.pendingRemovals.length) return;
  app.pendingRemovals = [];
  app.view.setOptions(app.wheel.options, { animate: true });
  render();
}

function isStale() {
  return Boolean(app.state && app.wheel && app.state.configVersion !== app.loadedVersion);
}

// ---------------- Actions ----------------

function requestSpin() {
  $('spin-btn').disabled = true;
  app.socket.emit('spin', { version: app.loadedVersion }, (res) => {
    if (!res?.ok) toast(res?.error || 'Không thể quay', 'error');
    render();
  });
}

function decide(action) {
  app.socket.emit('decide', { action }, (res) => {
    if (!res?.ok) return toast(res?.error || 'Thao tác thất bại', 'error');
    toast(action === 'keep' ? 'Đã giữ kết quả' : 'Đã xóa khỏi vòng quay', 'success');
    closeOverlay();
  });
}

// ---------------- Render ----------------

function canSpin() {
  const s = app.state;
  if (!s || !app.socket?.connected || !app.wheel || isStale()) return false;
  if (s.status === 'SPINNING' || app.animatingSpinId || s.awaitingDecision) return false;
  if (!s.active && !app.me.isOwner) return false;
  return app.wheel.options.some((o) => o.weight > 0); // FR-20 / BR-09
}

function render() {
  if (!app.wheel || !app.view) return;
  const s = app.state;
  const stale = isStale();
  $('stale-banner').hidden = !stale;

  const status = app.animatingSpinId ? 'SPINNING' : s?.status || 'IDLE';
  $('status').textContent = status;
  $('status').className = 'status ' + status.toLowerCase();
  $('spin-btn').disabled = !canSpin();

  let hint = '';
  if (stale) hint = 'Cần tải lại trang để dùng cấu hình mới.';
  else if (status === 'SPINNING') hint = 'Đang quay…';
  else if (s?.awaitingDecision) hint = app.me.isOwner ? 'Chọn Giữ hoặc Xóa kết quả để tiếp tục.' : 'Đang chờ Owner quyết định giữ/xóa kết quả.';
  else if (!app.wheel.options.some((o) => o.weight > 0)) hint = app.wheel.options.length ? 'Không có lựa chọn nào có trọng số > 0.' : 'Vòng quay chưa có lựa chọn.';
  else if (!s?.active && app.me.isOwner) hint = 'Phòng đang ĐÓNG – Participant chưa vào được (bật trong trang Chỉnh sửa).';
  $('hint').textContent = hint;

  // Kết quả (không lộ kết quả trước khi animation kết thúc)
  const r = s?.result;
  const box = $('result-box');
  if (r && !app.animatingSpinId) {
    box.className = 'result-box';
    box.style.setProperty('--c', r.color);
    box.innerHTML = (r.image ? `<img src="${escapeHtml(r.image)}" alt="" />` : '') + `<strong>${escapeHtml(r.name || '(Không tên)')}</strong>`;
  } else {
    box.className = 'result-box empty';
    box.textContent = app.animatingSpinId ? 'Đang quay…' : 'Chưa có kết quả';
  }

  const showDecide = Boolean(app.me.isOwner && s?.awaitingDecision && !app.animatingSpinId);
  $('decide-row').hidden = !showDecide;
  $('overlay-decide').hidden = !showDecide;
  if (app.attention !== showDecide) {
    app.attention = showDecide;
    setAttentionTitle(showDecide, app.baseTitle);
  }
  renderHistory();
}

function openOverlay(result) {
  const img = $('overlay-img');
  img.hidden = !result.image;
  if (result.image) img.src = result.image;
  $('overlay').classList.toggle('has-image', Boolean(result.image));
  $('overlay').style.setProperty('--c', result.color);
  $('overlay-text').textContent = result.name || (result.image ? '' : '(Không tên)');
  $('overlay').hidden = false;
  app.overlayOpen = true;
  render();
}

function closeOverlay() {
  $('overlay').hidden = true;
  app.overlayOpen = false;
  flushRemovals();
}

// Lịch sử dùng chung: server giữ và gửi kèm mỗi `state` cho mọi thiết bị.
function renderHistory() {
  // Ẩn kết quả của lượt đang quay để không lộ trước khi vòng quay dừng.
  const list = (app.state?.history || []).filter((h) => h.spinId !== app.animatingSpinId);
  renderHistoryList($('history'), list);
}

function clearHistory() {
  app.socket.emit('history:clear', {}, (res) => {
    if (!res?.ok) toast(res?.error || 'Không xóa được lịch sử', 'error');
  });
}
