import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db.js";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "inventra_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derived).toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored).split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(await scrypt(password, salt, expected.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function readCookie(header = "", cookieName = SESSION_COOKIE) {
  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key !== cookieName) continue;
    try {
      return decodeURIComponent(valueParts.join("="));
    } catch {
      return "";
    }
  }
  return "";
}

export function createSession(userId, res) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashToken(token), userId, expiresAt);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`);
}

export function destroySession(req, res) {
  const token = readCookie(req.headers.cookie);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

export function requireUser(req, res, next) {
  const token = readCookie(req.headers.cookie);
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  const session = db.prepare(`
    SELECT u.id, u.name, u.business_name, u.email, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(hashToken(token), Date.now());
  if (!session) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
  req.user = {
    id: session.id,
    name: session.name,
    business_name: session.business_name,
    email: session.email
  };
  next();
}
