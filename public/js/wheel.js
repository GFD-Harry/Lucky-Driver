// Vẽ vòng quay bằng Canvas. Dùng chung cho Dashboard và Editor preview.
// Các ô có kích thước bằng nhau (trọng số chỉ ảnh hưởng xác suất, không ảnh hưởng hình).
// Mỗi ô có "scale" để làm hiệu ứng co/giãn khi thêm/xóa (FR-08, FR-18).

const TAU = Math.PI * 2;
const RESIZE_MS = 600;
const imageCache = new Map();

function loadImage(src) {
  if (!src) return null;
  if (!imageCache.has(src)) {
    const img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return imageCache.get(src);
}

const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#1a1a1a' : '#ffffff';
}

export class WheelView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.slices = []; // { id, name, color, img, scale, from, to, t0 }
    this.rotation = 0; // radian, chiều kim đồng hồ; kim chỉ ở đỉnh (12h)
    this.spinAnim = null;
    this.raf = 0;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const size = Math.round(this.canvas.clientWidth * dpr);
    if (size && this.canvas.width !== size) {
      this.canvas.width = this.canvas.height = size;
    }
    this.kick();
  }

  /** Cập nhật danh sách lựa chọn. animate=true: ô mới giãn ra, ô bị xóa co lại. */
  setOptions(options, { animate = true } = {}) {
    const now = performance.now();
    const next = [];
    const incoming = new Map(options.map((o) => [o.id, o]));
    const existing = new Map(this.slices.map((s) => [s.id, s]));

    for (const o of options) {
      const s = existing.get(o.id);
      const data = { id: o.id, name: o.name || '', color: o.color, img: loadImage(o.image) };
      if (s && s.to > 0) next.push(Object.assign(s, data));
      else next.push({ ...data, scale: animate ? 0 : 1, from: animate ? 0 : 1, to: 1, t0: now });
    }
    // Giữ lại các ô đã bị xóa để chạy animation co lại, đặt đúng vị trí cũ.
    if (animate) {
      this.slices.forEach((s, i) => {
        if (!incoming.has(s.id) && s.to > 0) {
          Object.assign(s, { from: s.scale, to: 0, t0: now });
          next.splice(Math.min(i, next.length), 0, s);
        } else if (!incoming.has(s.id) && s.scale > 0) {
          next.splice(Math.min(i, next.length), 0, s); // đang co dở
        }
      });
    }
    this.slices = next;
    this.kick();
  }

  /** Góc (0..1 vòng) của 1 điểm trong ô `id` khi tất cả ô đã ổn định (scale = 1). */
  fractionOf(id, offset = 0.5) {
    const live = this.slices.filter((s) => s.to > 0);
    const i = live.findIndex((s) => s.id === id);
    if (i < 0) return null;
    return (i + offset) / live.length;
  }

  /**
   * Quay tới ô winnerId. Hỗ trợ thiết bị vào giữa chừng: dùng startAt (giờ server)
   * và clockOffset để tính phần thời gian còn lại.
   */
  spinTo({ winnerId, startAt, duration, offset, turns }, clockOffset = 0) {
    return new Promise((resolve) => {
      const f = this.fractionOf(winnerId, offset);
      if (f == null) return resolve(false);
      const serverNow = Date.now() + clockOffset;
      const elapsed = Math.max(0, serverNow - startAt);
      const p0 = Math.min(1, elapsed / duration);
      const from = this.rotation;
      // Cần rotation + f*TAU ≡ 0 (mod TAU) để điểm f nằm dưới kim.
      const base = -f * TAU;
      const minTurns = p0 > 0 ? 1 : turns;
      const k = Math.ceil((from + minTurns * TAU - base) / TAU);
      const target = base + k * TAU;
      if (p0 >= 1) {
        this.rotation = target;
        this.kick();
        return resolve(true);
      }
      const anim = {
        from,
        target,
        e0: easeOutQuart(p0),
        p0,
        t0: performance.now() - elapsed,
        duration,
        resolve,
      };
      this.spinAnim = anim;
      // Tab bị ẩn thì trình duyệt dừng requestAnimationFrame -> dùng timer để
      // chắc chắn lượt quay vẫn "kết thúc" đúng giờ (kết quả, nút Giữ/Xóa không bị kẹt).
      setTimeout(() => {
        if (this.spinAnim === anim) this.finishSpin();
      }, duration - elapsed + 150);
      this.kick();
    });
  }

  finishSpin() {
    const a = this.spinAnim;
    if (!a) return;
    this.rotation = a.target;
    this.spinAnim = null;
    a.resolve(true);
    this.kick();
  }

  /** Đặt ngay kim vào ô (cho thiết bị vào sau khi quay xong). */
  snapTo(winnerId, offset = 0.5) {
    const f = this.fractionOf(winnerId, offset);
    if (f == null) return;
    this.rotation = -f * TAU;
    this.kick();
  }

  get isSpinning() {
    return Boolean(this.spinAnim);
  }

  kick() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  frame() {
    this.raf = 0;
    const now = performance.now();
    let busy = false;

    for (const s of this.slices) {
      if (s.scale !== s.to) {
        const t = Math.min(1, (now - s.t0) / RESIZE_MS);
        s.scale = s.from + (s.to - s.from) * easeInOut(t);
        if (t >= 1) s.scale = s.to;
        else busy = true;
      }
    }
    this.slices = this.slices.filter((s) => s.to > 0 || s.scale > 0);

    const a = this.spinAnim;
    if (a) {
      const p = Math.min(1, (now - a.t0) / a.duration);
      const e = (easeOutQuart(p) - a.e0) / (1 - a.e0);
      this.rotation = a.from + (a.target - a.from) * e;
      if (p >= 1) this.finishSpin();
      else busy = true;
    }

    // Còn ảnh đang tải -> vẽ lại sau.
    if (this.slices.some((s) => s.img && !s.img.complete)) busy = true;

    this.draw();
    if (busy) this.kick();
  }

  draw() {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const c = W / 2;
    const R = c * 0.94;
    ctx.clearRect(0, 0, W, W);

    // Viền ngoài
    ctx.beginPath();
    ctx.arc(c, c, R + c * 0.04, 0, TAU);
    ctx.fillStyle = '#1f2937';
    ctx.fill();

    const total = this.slices.reduce((sum, s) => sum + s.scale, 0);
    if (total <= 0.0001) {
      ctx.beginPath();
      ctx.arc(c, c, R, 0, TAU);
      ctx.fillStyle = '#d1d5db';
      ctx.fill();
    } else {
      let acc = 0;
      for (const s of this.slices) {
        const span = (s.scale / total) * TAU;
        if (span < 0.0005) {
          acc += span;
          continue;
        }
        // Góc canvas: 0 = 3h; kim ở 12h nên trừ PI/2.
        const start = this.rotation + acc - Math.PI / 2;
        this.drawSlice(s, c, R, start, span);
        acc += span;
      }
    }

    // Trục giữa
    ctx.beginPath();
    ctx.arc(c, c, R * 0.08, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = R * 0.025;
    ctx.strokeStyle = '#1f2937';
    ctx.stroke();

    // Kim chỉ ở đỉnh
    ctx.beginPath();
    ctx.moveTo(c - R * 0.07, c - R - c * 0.05);
    ctx.lineTo(c + R * 0.07, c - R - c * 0.05);
    ctx.lineTo(c, c - R + R * 0.12);
    ctx.closePath();
    ctx.fillStyle = '#ffc72c';
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = R * 0.015;
    ctx.fill();
    ctx.stroke();
  }

  drawSlice(s, c, R, start, span) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, R, start, start + span);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.lineWidth = Math.max(1, R * 0.006);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();

    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(start + span / 2);

    const chord = 2 * Math.sin(Math.min(span, Math.PI) / 2); // độ rộng ô ở bán kính 1
    let textEnd = R * 0.9;

    const img = s.img;
    if (img && img.complete && img.naturalWidth) {
      const size = Math.min(R * 0.34, chord * R * 0.68 * 0.9);
      if (size > 6) {
        const cx = R * 0.7;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, 0, size / 2, 0, TAU);
        ctx.clip();
        ctx.translate(cx, 0);
        ctx.rotate(Math.PI / 2); // đầu ảnh hướng ra ngoài
        const ratio = Math.max(size / img.naturalWidth, size / img.naturalHeight);
        const w = img.naturalWidth * ratio;
        const h = img.naturalHeight * ratio;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(cx, 0, size / 2, 0, TAU);
        ctx.lineWidth = Math.max(1, R * 0.008);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        textEnd = cx - size / 2 - R * 0.03;
      }
    }

    if (s.name) {
      const maxWidth = textEnd - R * 0.14;
      let fontSize = Math.min(R * 0.09, chord * R * 0.55 * 0.6);
      if (fontSize >= 6 && maxWidth > 10) {
        ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = textColorFor(s.color);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        let text = s.name;
        if (ctx.measureText(text).width > maxWidth) {
          while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth) text = text.slice(0, -1);
          text += '…';
        }
        ctx.fillText(text, textEnd, 0);
      }
    }
    ctx.restore();
  }
}

export const PALETTE = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#6366f1'];
