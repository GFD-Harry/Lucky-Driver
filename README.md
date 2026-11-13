# Taxi Driver – Lucky Wheel

Vòng quay may mắn dùng chung nhiều thiết bị, có 1 Owner (đăng nhập Google) và nhiều Participant (không cần đăng nhập).
Đặc tả: [docs/requirement.md](docs/requirement.md)

## Stack (cố tình giữ đơn giản)

| Phần | Công nghệ | Lý do |
|---|---|---|
| Server | Node.js + Express | 1 process, 1 file chính, dễ debug |
| Realtime | Socket.IO | Tự phát hiện mất kết nối, tự reconnect |
| Frontend | HTML + JS thuần (ES modules), Canvas | Không build step, sửa file là chạy |
| Lưu trữ | `data/wheel.json` + `data/uploads/` | Không cần database |
| Đăng nhập | Google Identity Services + cookie ký HMAC | Miễn phí, không cần lưu session |

## Chạy local

```bash
npm install
cp .env.example .env      # điền GOOGLE_CLIENT_ID, SESSION_SECRET
# Muốn thử nhanh không cần Google: thêm DEV_LOGIN=1 vào .env
# Thêm/bớt Owner: sửa OWNER_EMAILS (cách nhau dấu phẩy) rồi restart server
npm run dev               # tự restart khi sửa code server
```

Mở http://localhost:3000 → "Owner đăng nhập" → tạo vòng quay, tick **Mở phòng quay**, bấm **Lưu**.
Mở cùng link trên điện thoại / tab ẩn danh để đóng vai Participant.

```bash
npm test                  # unit test (weighted random, spin lock) + test tích hợp socket
```

## Cấu trúc

```
server/
  index.js   Route HTTP + sự kiện socket (điểm bắt đầu khi debug)
  spin.js    Trạng thái IDLE/SPINNING/RESULT, Spin Lock, chọn kết quả theo trọng số
  store.js   Đọc/ghi wheel.json, ảnh upload, validate dữ liệu
  auth.js    Verify Google token, cookie Owner
public/
  index.html + js/dashboard.js   Màn hình Dashboard (Owner & Participant)
  editor.html + js/editor.js     Màn hình Editor (chỉ Owner)
  js/wheel.js                    Vẽ vòng quay + animation (dùng chung)
  js/common.js                   fetch API, toast, localStorage an toàn
test/
```

## Cách hoạt động (tóm tắt)

- **Kết quả do server chọn** (`pickWeighted`, P(i) = w(i)/Σw, weight 0 không bao giờ ra). Client chỉ chạy animation tới ô đó, nên mọi thiết bị luôn thấy cùng kết quả.
- **Spin Lock**: bấm Quay → server chuyển `SPINNING` và từ chối mọi yêu cầu khác. Server tự kết thúc lượt bằng timer sau `SPIN_MS`.
  - Thiết bị đang quay mất kết nối → lượt quay vẫn kết thúc đúng giờ trên server, lock tự nhả (FR-14).
  - Watchdog chạy mỗi giây là lớp dự phòng: lượt nào quá `SPIN_MS + 4s` sẽ bị kết thúc.
  - Server restart → trạng thái về `IDLE` (lock nằm trong RAM nên không bao giờ kẹt).
- **Result Configuration**: `Owner chọn mỗi lần` (chặn lượt mới tới khi Owner bấm Giữ/Xóa) · `Luôn giữ` · `Luôn xóa`.
- **Đồng bộ cấu hình (BR-08)**: cấu hình có `version`. Owner lưu xong, Participant đang mở trang thấy banner "Tải lại trang" và nút Quay bị khóa tới khi reload (để không quay trên vòng cũ lệch với server). Riêng việc **xóa kết quả** được đẩy realtime kèm animation co ô.
- **Ảnh**: trình duyệt thu nhỏ về tối đa 1920px (Full HD) trước khi upload. Kết quả có ảnh hiển thị full screen, có nút Close.
- **Lịch sử kết quả dùng chung**: server giữ 100 kết quả gần nhất trong RAM và gửi realtime cho mọi thiết bị (người vào sau cũng thấy), kèm nhãn Đã giữ / Đã xóa / Chờ quyết định. Chỉ Owner được xóa lịch sử. Restart server thì lịch sử mất (đúng mục 4.2: lưu tạm thời).
- **localStorage**: bản nháp Editor, bản sao cấu hình đã lưu (nếu server mất dữ liệu, Editor tự khôi phục từ bản này).

## Tạo Google Client ID (miễn phí)

1. https://console.cloud.google.com → tạo project.
2. *APIs & Services → OAuth consent screen* → External, điền tên app + email.
3. *Credentials → Create credentials → OAuth client ID* → loại **Web application**.
4. **Authorized redirect URIs** (bắt buộc, phải khớp chính xác từng ký tự):
   - `http://localhost:3000/auth/google/callback`
   - `https://<domain-thật>/auth/google/callback` (VD `https://lucky-wheel.onrender.com/auth/google/callback`)
5. Copy Client ID vào `GOOGLE_CLIENT_ID` (không cần Client Secret).
6. Nếu OAuth consent screen đang ở chế độ **Testing**: thêm các email Owner vào mục *Test users*, nếu không Google sẽ chặn.

Khi đăng nhập, Google luôn hiện màn hình **chọn tài khoản** (kể cả khi trình duyệt đang đăng nhập Gmail khác) → chọn "Sử dụng tài khoản khác" để đăng nhập bằng email Owner.
Nếu Google báo `redirect_uri_mismatch`: URI ở bước 4 chưa khớp. Chạy sau proxy mà sai giao thức/host thì đặt biến `PUBLIC_URL=https://<domain-thật>`.

## Deploy miễn phí

Cần một nơi chạy được Node.js lâu dài (WebSocket). Hai lựa chọn:

**A. Render.com (free) – dễ nhất**
New → Web Service → kết nối repo → Build `npm install`, Start `npm start`, thêm biến môi trường từ `.env.example` (không bật `DEV_LOGIN`).
⚠️ Gói free ngủ sau 15 phút không dùng (lần mở đầu chậm ~30–50s) và **ổ đĩa bị xóa khi restart/deploy**: cấu hình và ảnh sẽ mất. Owner mở Editor sẽ được khôi phục tên + lựa chọn từ localStorage, nhưng ảnh phải upload lại. Phù hợp để dùng thử.

**B. Máy của bạn / VPS free (Oracle Cloud Always Free) – dữ liệu bền**
```bash
npm install --omit=dev && npm start      # hoặc chạy bằng pm2
```
Nếu chạy trên máy ở nhà, dùng **Cloudflare Tunnel** (free) để có link HTTPS công khai:
`cloudflared tunnel --url http://localhost:3000`.

Backup: chỉ cần copy thư mục `data/`.

## Debug nhanh

- Log server in ra console (`[spin]`, `[auth]`, `[store]`).
- Xem dữ liệu hiện tại: mở `data/wheel.json`.
- Trạng thái realtime: DevTools → Network → WS → xem các message `state`, `option:removed`.
- Reset toàn bộ: dừng server, xóa thư mục `data/`.
