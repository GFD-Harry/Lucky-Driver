// Lưu trữ cấu hình vòng quay vào 1 file JSON + ảnh trong thư mục uploads.
// Chỉ có 1 vòng quay duy nhất (FR-03 / BR-01).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const WHEEL_FILE = path.join(DATA_DIR, 'wheel.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let wheel = load();

function load() {
  try {
    return JSON.parse(fs.readFileSync(WHEEL_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[store] Không đọc được wheel.json:', err.message);
    return null;
  }
}

function persist() {
  // Ghi ra file tạm rồi rename để tránh file hỏng nếu server tắt giữa chừng.
  const tmp = WHEEL_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(wheel, null, 2));
  fs.renameSync(tmp, WHEEL_FILE);
}

export function getWheel() {
  return wheel;
}

/** Lưu cấu hình mới (đã được sanitize). Tăng version để client biết cấu hình đã đổi. */
export function saveWheel(data) {
  wheel = { ...data, version: (wheel?.version || 0) + 1, updatedAt: Date.now() };
  persist();
  cleanupUploads();
  return wheel;
}

/** Xóa 1 lựa chọn (dùng khi xóa kết quả). Trả về version mới, hoặc null nếu không tìm thấy. */
export function removeOption(optionId) {
  if (!wheel) return null;
  const options = wheel.options.filter((o) => o.id !== optionId);
  if (options.length === wheel.options.length) return null;
  wheel = { ...wheel, options, version: wheel.version + 1, updatedAt: Date.now() };
  persist();
  return wheel.version;
}

/** Lưu ảnh upload, trả về URL công khai. Tên file = hash nội dung nên upload trùng không tạo file mới. */
export function saveUpload(buffer, contentType) {
  const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[contentType] || 'jpg';
  const name = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 20) + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return '/uploads/' + name;
}

/** Xóa ảnh không còn được dùng và đã cũ hơn 1 ngày (tránh xóa ảnh vừa upload trong bản nháp). */
function cleanupUploads() {
  const used = new Set((wheel?.options || []).map((o) => o.image).filter(Boolean));
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  for (const file of fs.readdirSync(UPLOAD_DIR)) {
    const full = path.join(UPLOAD_DIR, file);
    try {
      if (!used.has('/uploads/' + file) && fs.statSync(full).mtimeMs < dayAgo) fs.unlinkSync(full);
    } catch {
      /* bỏ qua */
    }
  }
}

const RESULT_MODES = ['ask', 'keep', 'remove'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const IMAGE_RE = /^\/uploads\/[a-z0-9]+\.(jpg|png|webp|gif)$/;

/** Kiểm tra & làm sạch dữ liệu từ editor. Trả về { value } hoặc { error }. */
export function sanitizeWheel(body) {
  if (!body || typeof body !== 'object') return { error: 'Dữ liệu không hợp lệ' };
  const name = String(body.name ?? '').trim().slice(0, 100);
  if (!Array.isArray(body.options)) return { error: 'Danh sách lựa chọn không hợp lệ' };
  if (body.options.length > 200) return { error: 'Tối đa 200 lựa chọn' };

  const ids = new Set();
  const options = [];
  for (const raw of body.options) {
    const id = String(raw?.id ?? '').slice(0, 40);
    if (!id || ids.has(id)) return { error: 'ID lựa chọn bị trùng hoặc rỗng' };
    ids.add(id);
    const weight = Number(raw.weight);
    if (!Number.isFinite(weight) || weight < 0) return { error: 'Trọng số phải là số ≥ 0 (BR-06)' };
    const image = raw.image ? String(raw.image) : null;
    if (image && !IMAGE_RE.test(image)) return { error: 'Đường dẫn ảnh không hợp lệ' };
    options.push({
      id,
      name: String(raw.name ?? '').trim().slice(0, 200),
      image,
      color: COLOR_RE.test(raw.color) ? raw.color : '#888888',
      weight,
    });
  }

  return {
    value: {
      name,
      active: Boolean(body.active),
      resultMode: RESULT_MODES.includes(body.resultMode) ? body.resultMode : 'ask',
      options,
    },
  };
}
