// Xác thực Owner bằng Google (FR-01). Sau khi verify Google ID token,
// server cấp 1 cookie ký HMAC (không cần lưu session ở đâu cả).
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
// Danh sách email có quyền Owner, cách nhau bởi dấu phẩy.
export const OWNER_EMAILS = (process.env.OWNER_EMAILS || process.env.OWNER_EMAIL || 'tainguyen21204@gmail.com,duyngyn1204.04@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isOwnerEmail(email) {
  return OWNER_EMAILS.includes(String(email || '').toLowerCase());
}
export const DEV_LOGIN = process.env.DEV_LOGIN === '1';
const COOKIE = 'lw_session';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

// Nếu không đặt SESSION_SECRET, mỗi lần restart server Owner phải đăng nhập lại.
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('[auth] Chưa đặt SESSION_SECRET – restart server sẽ đăng xuất Owner.');

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

function hmac(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

function createToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + MAX_AGE_MS })).toString('base64url');
  return payload + '.' + hmac(payload);
}

function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = hmac(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data.email : null;
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Trả về email nếu cookie hợp lệ VÀ là email Owner, ngược lại null. */
export function ownerFromCookieHeader(cookieHeader) {
  const email = readToken(parseCookies(cookieHeader)[COOKIE]);
  // Kiểm tra lại mỗi lần -> bỏ email khỏi danh sách là mất quyền ngay, không cần đăng xuất.
  return email && isOwnerEmail(email) ? email : null;
}

export function isOwnerReq(req) {
  return Boolean(ownerFromCookieHeader(req.headers.cookie));
}

export function setSessionCookie(req, res, email) {
  res.cookie(COOKIE, createToken(email), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: MAX_AGE_MS,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE);
}

// ---------- Đăng nhập Google (OpenID Connect, luôn hiện màn hình chọn tài khoản) ----------
// Luồng: /auth/google -> trang chọn tài khoản của Google -> Google POST id_token về
// /auth/google/callback -> server verify -> đặt cookie.
// Nonce được ký HMAC và gửi kèm trong `state`, nên không cần lưu gì phía server.
const NONCE_TTL_MS = 10 * 60 * 1000;

function createNonce() {
  const raw = crypto.randomBytes(16).toString('base64url') + '.' + Date.now();
  return raw + '.' + hmac(raw);
}

function isValidNonce(nonce) {
  const parts = String(nonce || '').split('.');
  if (parts.length !== 3) return false;
  const raw = parts[0] + '.' + parts[1];
  const expected = hmac(raw);
  if (parts[2].length !== expected.length || !crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))) return false;
  return Date.now() - Number(parts[1]) < NONCE_TTL_MS;
}

/** URL trang chọn tài khoản Google. redirectUri phải được khai báo trong Google Cloud Console. */
export function googleAuthUrl(redirectUri) {
  const nonce = createNonce();
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    response_mode: 'form_post',
    scope: 'openid email',
    prompt: 'select_account', // luôn cho chọn / thêm tài khoản khác
    nonce,
    state: nonce,
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}

/** Verify id_token Google trả về, trả về email đã xác minh (lowercase). Throw nếu không hợp lệ. */
export async function verifyGoogleCallback({ id_token: idToken, state }) {
  if (!GOOGLE_CLIENT_ID) throw new Error('Server chưa cấu hình GOOGLE_CLIENT_ID');
  if (!idToken || !isValidNonce(state)) throw new Error('Phiên đăng nhập không hợp lệ hoặc đã hết hạn, hãy thử lại');
  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (p?.nonce !== state) throw new Error('Nonce không khớp');
  if (!p.email || !p.email_verified) throw new Error('Email Google chưa được xác minh');
  return p.email.toLowerCase();
}
