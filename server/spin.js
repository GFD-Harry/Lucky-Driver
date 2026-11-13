// Quản lý trạng thái quay realtime + Spin Lock (FR-11 → FR-19).
//
// Nguyên tắc:
//  - Server là nơi DUY NHẤT quyết định kết quả và giữ Spin Lock.
//  - Khi có người bấm quay: server khóa (SPINNING), chọn kết quả theo trọng số,
//    rồi broadcast cho mọi thiết bị để cùng chạy 1 animation giống nhau.
//  - Lock được server tự nhả khi hết thời gian quay (timer phía server), nên
//    dù thiết bị đang quay mất kết nối thì lock cũng không bao giờ bị kẹt (FR-14).
//  - Watchdog chạy định kỳ là cơ chế dự phòng thứ 2 (timeout).

export const STATUS = { IDLE: 'IDLE', SPINNING: 'SPINNING', RESULT: 'RESULT' };
const HISTORY_LIMIT = 100;

/** Chọn ngẫu nhiên theo trọng số: P(i) = w(i) / tổng w. Trọng số 0 không bao giờ được chọn. */
export function pickWeighted(options, random = Math.random) {
  const pool = options.filter((o) => o.weight > 0);
  const total = pool.reduce((sum, o) => sum + o.weight, 0);
  if (!pool.length || !(total > 0)) return null;
  let r = random() * total;
  for (const o of pool) {
    r -= o.weight;
    if (r < 0) return o;
  }
  return pool[pool.length - 1]; // phòng sai số làm tròn
}

export class SpinRoom {
  constructor({ store, spinMs = 6000, graceMs = 4000, onState, onRemoved, now = Date.now, random = Math.random }) {
    Object.assign(this, { store, spinMs, graceMs, onState, onRemoved, now, random });
    this.status = STATUS.IDLE;
    this.spin = null; // { id, winnerId, startAt, duration, offset, turns, holder }
    this.result = null; // { spinId, optionId, name, image, color, at }
    this.awaitingDecision = false;
    // Lịch sử kết quả dùng chung cho mọi thiết bị. Chỉ lưu trong RAM (mục 4.2: lưu tạm thời).
    this.history = []; // [{ spinId, optionId, name, image, color, at, decision: 'pending'|'keep'|'remove' }]
    this.timer = null;
    this.seq = 0;
    this.watchdog = setInterval(() => this.checkTimeout(), 1000);
    this.watchdog.unref?.();
  }

  publicState() {
    const w = this.store.getWheel();
    const spin = this.spin && { ...this.spin, holder: undefined };
    return {
      status: this.status,
      active: Boolean(w?.active),
      configVersion: w?.version ?? 0,
      resultMode: w?.resultMode ?? 'ask',
      spin,
      result: this.result,
      awaitingDecision: this.awaitingDecision,
      history: this.history,
      serverNow: this.now(),
    };
  }

  broadcast() {
    this.onState?.(this.publicState());
  }

  requestSpin(holder, { isOwner = false, version } = {}) {
    const w = this.store.getWheel();
    if (!w) return fail('Chưa có vòng quay');
    if (!w.active && !isOwner) return fail('Phòng quay hiện chưa hoạt động');
    if (this.status === STATUS.SPINNING) return fail('Đang có người quay, vui lòng chờ');
    if (this.awaitingDecision) return fail('Đang chờ Owner quyết định giữ/xóa kết quả');
    if (version !== w.version) return fail('Cấu hình đã thay đổi, vui lòng tải lại trang');

    const winner = pickWeighted(w.options, this.random);
    if (!winner) return fail('Không có lựa chọn nào để quay'); // FR-20 / BR-09

    this.status = STATUS.SPINNING;
    this.spin = {
      id: ++this.seq,
      winnerId: winner.id,
      startAt: this.now(),
      duration: this.spinMs,
      offset: 0.15 + this.random() * 0.7, // vị trí kim dừng bên trong ô thắng (để không luôn ở giữa)
      turns: 5 + Math.floor(this.random() * 3),
      holder,
    };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish(), this.spinMs);
    this.broadcast();
    return { ok: true, spinId: this.spin.id };
  }

  finish() {
    if (this.status !== STATUS.SPINNING) return;
    clearTimeout(this.timer);
    const spin = this.spin;
    const w = this.store.getWheel();
    const opt = w?.options.find((o) => o.id === spin.winnerId);

    this.status = STATUS.RESULT;
    this.spin = { ...spin, holder: null };
    this.result = opt
      ? { spinId: spin.id, optionId: opt.id, name: opt.name, image: opt.image, color: opt.color, at: this.now() }
      : null;
    this.awaitingDecision = false;

    if (opt) {
      const decision = { ask: 'pending', keep: 'keep', remove: 'remove' }[w.resultMode] || 'pending';
      this.history.unshift({ ...this.result, decision });
      this.history.length = Math.min(this.history.length, HISTORY_LIMIT);
    }
    if (opt && w.resultMode === 'ask') this.awaitingDecision = true;
    if (opt && w.resultMode === 'remove') this.removeOption(opt.id);
    this.broadcast();
  }

  setDecision(spinId, decision) {
    const entry = this.history.find((h) => h.spinId === spinId);
    if (entry) entry.decision = decision;
  }

  /** Chỉ Owner được gọi (kiểm tra ở index.js). */
  clearHistory() {
    this.history = [];
    this.broadcast();
    return { ok: true };
  }

  /** Owner quyết định giữ / xóa kết quả (FR-16 → FR-18). */
  decide(action) {
    if (this.status !== STATUS.RESULT || !this.awaitingDecision || !this.result) return fail('Không có kết quả cần quyết định');
    if (action !== 'keep' && action !== 'remove') return fail('Hành động không hợp lệ');
    if (action === 'remove') this.removeOption(this.result.optionId);
    this.setDecision(this.result.spinId, action);
    this.awaitingDecision = false;
    this.broadcast();
    return { ok: true };
  }

  removeOption(optionId) {
    const version = this.store.removeOption(optionId);
    if (version) this.onRemoved?.({ id: optionId, version });
  }

  /** FR-14: thiết bị đang quay mất kết nối. */
  handleDisconnect(socketId) {
    if (this.status === STATUS.SPINNING && this.spin?.holder === socketId) {
      // Kết quả đã do server chọn và timer phía server sẽ kết thúc lượt quay,
      // nên chỉ cần bỏ liên kết với thiết bị. Lock tự nhả khi hết thời gian quay.
      this.spin.holder = null;
      console.log(`[spin] Thiết bị đang quay (${socketId}) mất kết nối – lock sẽ tự nhả khi hết lượt.`);
    }
  }

  /** Watchdog dự phòng: không để SPINNING bị khóa quá thời gian quay + grace. */
  checkTimeout() {
    if (this.status === STATUS.SPINNING && this.now() > this.spin.startAt + this.spin.duration + this.graceMs) {
      console.warn('[spin] Watchdog: lượt quay quá hạn, tự kết thúc.');
      this.finish();
    }
  }

  /** Owner lưu cấu hình mới -> reset trạng thái runtime. */
  resetAfterConfigChange() {
    clearTimeout(this.timer);
    // Kết quả đang chờ quyết định mà Owner lưu cấu hình mới -> coi như giữ. Lịch sử vẫn giữ nguyên.
    if (this.awaitingDecision && this.result) this.setDecision(this.result.spinId, 'keep');
    this.status = STATUS.IDLE;
    this.spin = null;
    this.result = null;
    this.awaitingDecision = false;
    this.broadcast();
  }

  close() {
    clearTimeout(this.timer);
    clearInterval(this.watchdog);
  }
}

function fail(error) {
  return { ok: false, error };
}
