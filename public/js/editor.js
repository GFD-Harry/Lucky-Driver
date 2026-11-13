import { WheelView, PALETTE } from './wheel.js';
import { api, toast, local, shareLink, shareUrl, escapeHtml, renderHistoryList, setAttentionTitle } from './common.js';

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'lw_draft';
const BACKUP_KEY = 'lw_backup';
const MAX_IMAGE_SIDE = 1920; // Full HD (FR-15)

const ed = {
  data: { name: '', active: false, resultMode: 'ask', options: [] },
  serverVersion: 0,
  dirty: false,
  view: null,
  uploadTarget: null,
};

init();

async function init() {
  const me = await api('/api/me').catch(() => ({ isOwner: false }));
  if (!me.isOwner) return showLogin();

  $('editor').hidden = false;
  ed.view = new WheelView($('preview'));
  $('share-url').textContent = shareUrl();

  const { wheel } = await api('/api/wheel');
  const draft = local.get(DRAFT_KEY);
  if (wheel) {
    ed.serverVersion = wheel.version;
    ed.data = pick(wheel);
  } else if (local.get(BACKUP_KEY)) {
    // Server mất dữ liệu (VD host free bị reset ổ đĩa) -> khôi phục từ bản lưu trên máy Owner.
    ed.data = pick(local.get(BACKUP_KEY));
    ed.dirty = true;
    toast('Server chưa có vòng quay – đã khôi phục từ bản lưu trên máy này. Bấm Lưu để đẩy lên.', 'info');
  }
  if (draft?.dirty && draft.baseVersion === ed.serverVersion) {
    ed.data = pick(draft.data);
    ed.dirty = true;
    $('draft-banner').hidden = false;
  }

  bindForm();
  renderAll(false);
  connectLive();
}

// ---------------- Kết quả & lịch sử realtime (Owner vẫn quyết định được khi đang ở Editor) ----------------

function connectLive() {
  const baseTitle = document.title;
  let attention = false;
  let lastState = null;
  // eslint-disable-next-line no-undef
  const socket = io({ transports: ['websocket', 'polling'] });
  const setConn = (ok) => {
    $('live-conn').className = 'conn ' + (ok ? 'ok' : 'bad');
    $('live-conn').querySelector('span').textContent = ok ? 'Realtime' : 'Mất kết nối';
  };
  socket.on('connect', () => setConn(true));
  socket.on('disconnect', () => setConn(false));

  socket.on('state', (s) => {
    lastState = s;
    // Không lộ kết quả khi các thiết bị khác còn đang xem vòng quay chạy.
    const spinning = s.status === 'SPINNING';
    $('live-status').textContent = spinning ? '🎡 Đang có người quay…' : '';
    renderHistoryList($('history'), s.history || []);

    const pending = Boolean(s.awaitingDecision && s.result);
    $('pending').hidden = !pending;
    if (pending) {
      const r = s.result;
      $('pending-result').style.setProperty('--c', r.color);
      $('pending-result').innerHTML =
        (r.image ? `<img src="${escapeHtml(r.image)}" alt="" />` : '') + `<strong>${escapeHtml(r.name || '(Không tên)')}</strong>`;
    }
    if (pending !== attention) {
      attention = pending;
      setAttentionTitle(pending, baseTitle);
      if (pending) toast('🔔 Có kết quả mới chờ bạn quyết định', 'info');
    }
  });

  document.querySelectorAll('#pending [data-decide]').forEach((btn) => {
    btn.onclick = () => {
      const action = btn.dataset.decide;
      socket.emit('decide', { action }, (res) => {
        if (!res?.ok) return toast(res?.error || 'Thao tác thất bại', 'error');
        toast(action === 'keep' ? 'Đã giữ kết quả' : 'Đã xóa khỏi vòng quay', 'success');
        if (action === 'remove' && lastState?.result) {
          // Xóa luôn trong form đang sửa để không vô tình lưu lại lựa chọn đã bị xóa.
          const id = lastState.result.optionId;
          if (ed.data.options.some((o) => o.id === id)) {
            ed.data.options = ed.data.options.filter((o) => o.id !== id);
            renderAll(true);
          }
        }
      });
    };
  });
  $('clear-history').onclick = () =>
    socket.emit('history:clear', {}, (res) => !res?.ok && toast(res?.error || 'Không xóa được', 'error'));

  // Server xóa lựa chọn (chế độ "Luôn xóa" hoặc Owner bấm Xóa ở máy khác) -> cập nhật form.
  socket.on('option:removed', ({ id, version }) => {
    if (ed.data.options.some((o) => o.id === id)) {
      ed.data.options = ed.data.options.filter((o) => o.id !== id);
      renderAll(true);
    }
    if (!ed.dirty) ed.serverVersion = version;
  });
}

function pick(w) {
  return {
    name: w.name || '',
    active: Boolean(w.active),
    resultMode: w.resultMode || 'ask',
    options: (w.options || []).map((o) => ({ id: o.id, name: o.name || '', image: o.image || null, color: o.color, weight: o.weight })),
  };
}

// ---------------- Login ----------------

async function showLogin() {
  $('login').hidden = false;
  const cfg = await api('/api/config');
  if (cfg.devLogin) {
    $('dev-login').hidden = false;
    $('dev-login').onclick = async () => {
      await api('/api/auth/dev', { method: 'POST' });
      location.reload();
    };
  }
  const error = new URLSearchParams(location.search).get('login_error');
  if (error) {
    $('login-error').textContent = error;
    history.replaceState(null, '', location.pathname);
  } else if (!cfg.googleClientId) {
    $('login-error').textContent = 'Server chưa cấu hình GOOGLE_CLIENT_ID (xem README).';
  }
}

// ---------------- Form ----------------

function bindForm() {
  $('name').oninput = (e) => change(() => (ed.data.name = e.target.value), false);
  $('active').onchange = (e) => change(() => (ed.data.active = e.target.checked), false);
  $('result-mode').onchange = (e) => change(() => (ed.data.resultMode = e.target.value), false);
  $('add-option').onclick = () => change(() => ed.data.options.push(newOption('')));
  $('bulk-add').onclick = () => {
    $('bulk-text').hidden = $('bulk-confirm').hidden = !$('bulk-text').hidden;
    $('bulk-text').focus();
  };
  $('bulk-confirm').onclick = () => {
    const names = $('bulk-text').value.split('\n').map((s) => s.trim()).filter(Boolean);
    change(() => names.forEach((n) => ed.data.options.push(newOption(n))));
    $('bulk-text').value = '';
    $('bulk-text').hidden = $('bulk-confirm').hidden = true;
  };
  $('save').onclick = save;
  $('share-btn').onclick = shareLink;
  $('discard-draft').onclick = () => {
    local.remove(DRAFT_KEY);
    location.reload();
  };
  $('file-input').onchange = onFileChosen;
  window.addEventListener('beforeunload', (e) => {
    if (ed.dirty) e.preventDefault();
  });

  // Ủy quyền sự kiện cho danh sách lựa chọn
  const list = $('options');
  list.addEventListener('input', (e) => {
    const opt = optionOf(e.target);
    if (!opt) return;
    const field = e.target.dataset.field;
    if (field === 'name') change(() => (opt.name = e.target.value), 'preview');
    if (field === 'color') change(() => (opt.color = e.target.value), 'preview');
    if (field === 'weight') {
      const w = e.target.value === '' ? 0 : Number(e.target.value);
      e.target.classList.toggle('invalid', !(w >= 0));
      if (w >= 0) change(() => (opt.weight = w), 'prob');
    }
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    const opt = btn && optionOf(btn);
    if (!opt) return;
    if (btn.dataset.act === 'delete') change(() => (ed.data.options = ed.data.options.filter((o) => o !== opt)));
    if (btn.dataset.act === 'image') {
      ed.uploadTarget = opt;
      $('file-input').value = '';
      $('file-input').click();
    }
    if (btn.dataset.act === 'clear-image') change(() => (opt.image = null));
  });
}

function optionOf(el) {
  const li = el.closest('li[data-id]');
  return li && ed.data.options.find((o) => o.id === li.dataset.id);
}

function newOption(name) {
  const used = ed.data.options.length;
  return { id: Math.random().toString(36).slice(2, 10), name, image: null, color: PALETTE[used % PALETTE.length], weight: 1 };
}

/**
 * Áp dụng thay đổi rồi cập nhật giao diện.
 * scope: true = vẽ lại danh sách; 'preview' = chỉ preview; 'prob' = chỉ tỉ lệ; false = không vẽ.
 */
function change(fn, scope = true) {
  fn();
  ed.dirty = true;
  local.set(DRAFT_KEY, { baseVersion: ed.serverVersion, dirty: true, data: ed.data });
  if (scope === true) renderAll(true);
  else if (scope === 'preview') renderPreview(true);
  else if (scope === 'prob') renderProbabilities();
}

function renderAll(animate) {
  $('name').value = ed.data.name;
  $('active').checked = ed.data.active;
  $('result-mode').value = ed.data.resultMode;
  $('options').innerHTML = ed.data.options
    .map(
      (o) => `
      <li data-id="${escapeHtml(o.id)}">
        <input type="color" data-field="color" value="${escapeHtml(o.color)}" aria-label="Màu" />
        <input type="text" data-field="name" value="${escapeHtml(o.name)}" placeholder="Tên (không bắt buộc)" maxlength="200" />
        <div class="img-cell">
          ${
            o.image
              ? `<img src="${escapeHtml(o.image)}" alt="" /><button type="button" class="icon" data-act="clear-image" title="Bỏ ảnh">✕</button>`
              : `<button type="button" class="btn small ghost" data-act="image">Ảnh</button>`
          }
        </div>
        <input type="number" data-field="weight" value="${o.weight}" min="0" step="any" inputmode="decimal" aria-label="Trọng số" />
        <span class="prob" data-prob></span>
        <button type="button" class="icon danger" data-act="delete" title="Xóa lựa chọn">🗑</button>
      </li>`,
    )
    .join('');
  // Ảnh: cho phép bấm vào thumbnail để đổi ảnh
  $('options').querySelectorAll('.img-cell img').forEach((img) => {
    img.onclick = () => {
      ed.uploadTarget = optionOf(img);
      $('file-input').value = '';
      $('file-input').click();
    };
  });
  renderProbabilities();
  renderPreview(animate);
}

function renderProbabilities() {
  const total = ed.data.options.reduce((s, o) => s + (o.weight > 0 ? o.weight : 0), 0);
  $('options')
    .querySelectorAll('li[data-id]')
    .forEach((li) => {
      const o = ed.data.options.find((x) => x.id === li.dataset.id);
      li.querySelector('[data-prob]').textContent = total > 0 ? ((o.weight / total) * 100).toFixed(1).replace(/\.0$/, '') + '%' : '0%';
      li.classList.toggle('zero', !(o.weight > 0));
    });
  $('count').textContent = `(${ed.data.options.length})`;
}

function renderPreview(animate) {
  ed.view.setOptions(ed.data.options, { animate });
}

// ---------------- Images ----------------

async function onFileChosen(e) {
  const file = e.target.files[0];
  const opt = ed.uploadTarget;
  if (!file || !opt) return;
  try {
    toast('Đang tải ảnh lên…');
    const blob = await prepareImage(file);
    const { url } = await api('/api/upload', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
    change(() => (opt.image = url));
    toast('Đã tải ảnh', 'success');
  } catch (err) {
    toast('Lỗi tải ảnh: ' + err.message, 'error');
  }
}

/** Thu nhỏ ảnh về tối đa Full HD để tải nhanh mà vẫn đẹp khi hiển thị full screen. GIF giữ nguyên. */
async function prepareImage(file) {
  if (file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024 && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Không xử lý được ảnh'))), 'image/jpeg', 0.9));
}

// ---------------- Save ----------------

async function save() {
  const bad = ed.data.options.find((o) => !(o.weight >= 0));
  if (bad) return toast('Trọng số phải là số ≥ 0', 'error');
  $('save').disabled = true;
  try {
    const { wheel } = await api('/api/wheel', { method: 'PUT', body: ed.data });
    ed.serverVersion = wheel.version;
    ed.dirty = false;
    local.remove(DRAFT_KEY);
    local.set(BACKUP_KEY, pick(wheel));
    $('draft-banner').hidden = true;
    toast('Đã lưu vòng quay ✔', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    $('save').disabled = false;
  }
}
