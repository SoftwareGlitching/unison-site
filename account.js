// UNISON website sign-in: a license key (checked against the owner's public signing key) or the owner password.
// Shared storage with chat.html, so signing in on one page signs you in on the other.
const LICENSE_PUBLIC_KEY = "ca0QGySY2IMmhMXY5_egV-vasWuIHsWEFK5mLQwfHkA";
const OWNER_PASS = { salt: "j3uD2U08OioAVZODjxBodw==", hash: "YJft6M+bvrA8vg7dn28xIyHwMKX0X18VQ60KhfUH8mM=", iter: 310000 };
const NOBLE = "https://cdn.jsdelivr.net/npm/@noble/ed25519@2.1.0/+esm";
const PREFIX = "UNISON-";

const store = {
  get(k, d) { try { const v = localStorage.getItem("unison_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("unison_" + k, JSON.stringify(v)); } catch {} },
};

function unb64(t) {
  t = t.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
}

async function edVerify(pub, sig, msg) {
  let key = null;
  try { key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]); } catch {}
  if (key) return crypto.subtle.verify({ name: "Ed25519" }, key, sig, msg);
  const ed = await import(NOBLE);
  return ed.verifyAsync(sig, msg, pub);
}

export async function checkKey(raw) {
  const key = String(raw || "").replace(/\s+/g, "");
  if (!key.startsWith(PREFIX) || key.split(".").length !== 2) throw new Error("Wrong password, or that isn't a UNISON license key.");
  const [body, sig] = key.slice(PREFIX.length).split(".");
  let msg, sigBytes, data;
  try { msg = unb64(body); sigBytes = unb64(sig); data = JSON.parse(new TextDecoder().decode(msg)); }
  catch { throw new Error("The key is damaged — copy the whole key again."); }
  if (!(sigBytes.length === 64 && await edVerify(unb64(LICENSE_PUBLIC_KEY), sigBytes, msg))) throw new Error("This key isn't valid for UNISON.");
  if (data.exp && Date.now() / 1000 > data.exp) throw new Error(`This key expired on ${new Date(data.exp * 1000).toLocaleDateString()}.`);
  try {
    const r = await fetch("revoked.json", { cache: "no-store" });
    if (r.ok) { const j = await r.json(); const ids = Array.isArray(j) ? j : (j.revoked || []); if (ids.includes(data.id)) throw new Error("revoked"); }
  } catch (e) { if (e.message === "revoked") throw new Error("This key has been switched off by the owner."); }
  return { key, data };
}

async function ownerPassOk(pw) {
  try {
    const salt = Uint8Array.from(atob(OWNER_PASS.salt), (c) => c.charCodeAt(0));
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: OWNER_PASS.iter }, k, 256);
    return btoa(String.fromCharCode(...new Uint8Array(bits))) === OWNER_PASS.hash;
  } catch { return false; }
}

const OWNER_HOURS = 12;
function ownerSessionValid() {
  const v = store.get("owner_pass", null);
  return !!(v && v.h === OWNER_PASS.hash && Date.now() - (v.t || 0) < OWNER_HOURS * 3600e3);
}
const OWNER = { owner: true, key: null, data: { to: "Owner", plan: "owner", id: "owner-password", exp: null } };

/** Sign in with a key or the owner password. Throws with a readable message. */
export async function signIn(input) {
  const typed = String(input || "").trim();
  if (!typed.replace(/\s+/g, "").startsWith(PREFIX) && await ownerPassOk(typed)) {
    store.set("owner_pass", { h: OWNER_PASS.hash, t: Date.now() });
    return OWNER;
  }
  const lic = await checkKey(typed);
  store.set("license", lic.key);
  return lic;
}

/** The signed-in account on this device, or null (an expired/invalid saved key signs you out). */
export async function current() {
  if (ownerSessionValid()) return OWNER;
  const saved = store.get("license", "");
  if (!saved) return null;
  try { return await checkKey(saved); } catch { store.set("license", ""); return null; }
}

export function signOut() { store.set("license", ""); store.set("owner_pass", ""); }

export function isDev(acc) { return !!acc && (acc.owner || ["dev", "owner"].includes(acc.data.plan)); }
