// Hàm dùng chung cho các trang.

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const isJson = body !== undefined && !(body instanceof Blob);
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: isJson ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: isJson ? JSON.stringify(body) : body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

let toastTimer;
export function toast(message, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 3000);
}

/** localStorage có thể lỗi (chế độ ẩn danh, đầy bộ nhớ) – luôn bọc try/catch. */
export const local = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export function shareUrl() {
  return location.origin + '/';
}

export async function shareLink() {
  const url = shareUrl();
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'Lucky Wheel', url });
      return;
    } catch {
      /* người dùng hủy -> copy */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Đã copy link: ' + url, 'success');
  } catch {
    window.prompt('Copy link này:', url);
  }
}

// ---------- Lịch sử kết quả (dùng chung Dashboard + Editor) ----------
const DECISION_LABEL = { pending: 'Chờ quyết định', keep: 'Đã giữ', remove: 'Đã xóa' };

/** Vẽ danh sách lịch sử vào <ol>. Chỉ ghi DOM khi nội dung thay đổi. */
export function renderHistoryList(el, list) {
  const html = list.length
    ? list
        .map(
          (h) => `<li>
            <i style="background:${escapeHtml(h.color)}"></i>
            ${h.image ? `<img src="${escapeHtml(h.image)}" alt="" />` : ''}
            <span class="h-name">${escapeHtml(h.name || (h.image ? '(Hình ảnh)' : '(Không tên)'))}</span>
            <span class="tag ${escapeHtml(h.decision)}">${DECISION_LABEL[h.decision] || ''}</span>
            <time>${new Date(h.at).toLocaleTimeString('vi-VN')}</time>
          </li>`,
        )
        .join('')
    : '<li class="muted">Chưa có</li>';
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
}

/** Nhấp nháy tiêu đề tab để Owner biết có kết quả chờ quyết định. */
let titleTimer = null;
export function setAttentionTitle(on, baseTitle) {
  clearInterval(titleTimer);
  titleTimer = null;
  document.title = baseTitle;
  if (on) {
    let flip = false;
    titleTimer = setInterval(() => {
      flip = !flip;
      document.title = flip ? '🔔 Chờ bạn quyết định!' : baseTitle;
    }, 1000);
  }
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
