// @ts-nocheck : petite fonction sans dépendance, le code Web Push est du JavaScript commun aux tests
// Supabase Edge Function « rappel » (Coran for Malak)
// - { op: "key" } : clé publique VAPID (créée au premier appel, gardée dans public.vapid_keys, lisible par cette fonction seulement)
// - { op: "push", target } : envoie la notification du rappel que l'ami connecté vient d'envoyer (voir send_nudge dans rappels.sql)
// - { op: "prayers" } : appelé chaque minute par la tâche planifiée (prieres.sql, en-tête x-cron) : envoie les alertes de prière dues
// Web Push sans bibliothèque : jeton VAPID (ES256) et chiffrement aes128gcm (RFC 8291), avec WebCrypto.
// La fonction vérifie elle-même la session pour « push » (jeton dans l'en-tête x-session) ; le réglage « Verify JWT » peut rester activé.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
// clé secrète du projet : nouvelles clés (SUPABASE_SECRET_KEYS, objet JSON) sinon l'ancienne clé service_role
const SB_KEY = (() => {
  try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); const k = o?.default ?? Object.values(o ?? {})[0]; if (typeof k === "string" && k) return k; } catch { /* ancien format */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
})();
const APP = "https://zaimineee.github.io";
const CORS = {
  "Access-Control-Allow-Origin": APP,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---- WEBPUSH-DEBUT (copié tel quel dans les tests : scratch/e2e/webpush-test.mjs)
const te = new TextEncoder();
const b64u = (b) => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ""; for (const c of u) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (s) => { const t = String(s).replace(/-/g, "+").replace(/_/g, "/"); const b = atob(t + "===".slice((t.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
async function newVapid() { // { publicKey: base64url (65 octets), privateJwk }
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { publicKey: b64u(await crypto.subtle.exportKey("raw", k.publicKey)), privateJwk: await crypto.subtle.exportKey("jwk", k.privateKey) };
}
async function vapidHeader(endpoint, vapid, subject) { // en-tête Authorization: vapid t=<JWT ES256>, k=<clé publique>
  const priv = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const h = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = b64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, te.encode(h + "." + p));
  return "vapid t=" + h + "." + p + "." + b64u(sig) + ", k=" + vapid.publicKey;
}
async function encryptPush(p256dh, authSecret, payload) { // corps chiffré aes128gcm pour l'abonnement (RFC 8291)
  const ua = unb64u(p256dh), auth = unb64u(authSecret);
  if (ua.length !== 65 || auth.length !== 16) throw new Error("abonnement invalide");
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(te.encode("WebPush: info\0"), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(te.encode(payload), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([65]), asPub, ct); // sel, taille d'enregistrement 4096, clé de l'expéditeur
}
async function sendPush(sub, payload, vapid, subject, opt = {}) { // opt : { ttl (secondes), urgency }
  const body = await encryptPush(sub.p256dh, sub.auth, payload);
  return fetch(sub.endpoint, {
    method: "POST",
    headers: { TTL: String(opt.ttl || 86400), Urgency: opt.urgency || "normal", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Authorization: await vapidHeader(sub.endpoint, vapid, subject) },
    body,
  });
}
// ---- WEBPUSH-FIN

// Base de données avec la clé de service (jamais envoyée à l'app)
function db(path: string, init: RequestInit = {}) {
  const h: Record<string, string> = { apikey: SB_KEY, "Content-Type": "application/json", ...(init.headers as Record<string, string> || {}) };
  if (SB_KEY.startsWith("eyJ")) h.Authorization = "Bearer " + SB_KEY;
  return fetch(SB_URL + "/rest/v1/" + path, { ...init, headers: h });
}
async function vapidKeys() {
  const read = async () => { const r = await db("vapid_keys?id=eq.1&select=public_key,private_jwk"); if (!r.ok) throw new Error("base " + r.status); const a = await r.json(); return Array.isArray(a) && a[0] ? { publicKey: a[0].public_key, privateJwk: a[0].private_jwk } : null; };
  let k = await read();
  if (!k) {
    const n = await newVapid();
    const w = await db("vapid_keys", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ id: 1, public_key: n.publicKey, private_jwk: n.privateJwk }) });
    if (!w.ok && w.status !== 409) throw new Error("base " + w.status);
    k = await read();
  }
  if (!k) throw new Error("clés indisponibles");
  return k;
}
async function userOf(req: Request) { // l'utilisateur connecté, d'après sa session (vérifiée par le serveur d'authentification)
  // jeton de session dans « x-session » (la passerelle ne le contrôle pas avec l'ancien secret) ou dans Authorization
  const x = req.headers.get("x-session") ?? "", a = req.headers.get("Authorization") ?? "";
  const tok = x || (a.startsWith("Bearer ") ? a.slice(7) : "");
  if (tok.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(tok)) return null;
  const r = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: SB_KEY, Authorization: "Bearer " + tok } });
  if (!r.ok) return null;
  const u = await r.json();
  return typeof u?.id === "string" ? u.id : null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Alertes de prière : seulement pour la tâche planifiée (mot de passe interne de public.cron_secret)
const PRAYER = { fajr: "Fajr", dhuhr: "Dhuhr", asr: "ʿAsr", maghrib: "Maghrib", isha: "ʿIshâ’" };
async function prayers(req: Request) {
  const tok = req.headers.get("x-cron") ?? "";
  const sec = await (await db("cron_secret?id=eq.1&select=token")).json();
  if (tok.length < 32 || !Array.isArray(sec) || !sec[0] || sec[0].token !== tok) return json({ error: "cron" }, 403);
  const due = await (await db("rpc/claim_prayer_slots", { method: "POST", body: "{}" })).json();
  if (!Array.isArray(due) || !due.length) return json({ sent: 0 });
  const users = [...new Set(due.map((d) => d.user_id).filter((u) => UUID.test(String(u))))];
  if (!users.length) return json({ sent: 0 });
  const subs = await (await db("push_subs?select=user_id,endpoint,p256dh,auth&user_id=in.(" + users.join(",") + ")")).json();
  const vapid = await vapidKeys();
  let sent = 0;
  for (const d of due) {
    const name = PRAYER[d.prayer]; if (!name) continue;
    const body = d.before > 0 ? name + " dans " + d.before + " min 🕌" : "C’est l’heure de " + name + " 🕌";
    const payload = JSON.stringify({ title: "Coran for Malak", body, tag: "priere" });
    for (const s of (Array.isArray(subs) ? subs : []).filter((x) => x.user_id === d.user_id)) {
      try {
        const r = await sendPush(s, payload, vapid, APP + "/coran-for-malak/", { ttl: 1200, urgency: "high" }); // inutile après 20 minutes
        if (r.ok) sent++;
        else if (r.status === 404 || r.status === 410) await db("push_subs?endpoint=eq." + encodeURIComponent(s.endpoint), { method: "DELETE" });
      } catch { /* un téléphone injoignable n'empêche pas les autres */ }
    }
  }
  return json({ sent });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "méthode" }, 405);
  let b: { op?: string; target?: string } = {};
  try { b = await req.json(); } catch { return json({ error: "corps" }, 400); }
  try {
    if (b.op === "key") return json({ key: (await vapidKeys()).publicKey });
    if (b.op === "prayers") return await prayers(req);
    if (b.op !== "push") return json({ error: "op" }, 400);
    const me = await userOf(req);
    if (!me) return json({ error: "session" }, 401);
    if (typeof b.target !== "string" || !UUID.test(b.target)) return json({ error: "target" }, 400);
    // seulement le rappel que je viens d'envoyer (créé par send_nudge, il y a moins de 5 minutes, pas encore notifié)
    const since = new Date(Date.now() - 5 * 60000).toISOString();
    const n = await (await db("nudges?select=id&sender=eq." + me + "&receiver=eq." + b.target + "&pushed=is.false&created_at=gt." + encodeURIComponent(since) + "&order=created_at.desc&limit=1")).json();
    if (!Array.isArray(n) || !n[0]) return json({ sent: 0 });
    await db("nudges?id=eq." + n[0].id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ pushed: true }) });
    const who = await (await db("stats?select=name,username&id=eq." + me)).json();
    const name = String((who?.[0]?.name || "") || ("@" + (who?.[0]?.username || "un ami"))).slice(0, 30);
    const subs = await (await db("push_subs?select=endpoint,p256dh,auth&user_id=eq." + b.target)).json();
    const vapid = await vapidKeys();
    const payload = JSON.stringify({ title: "Coran for Malak", body: name + " t’encourage à lire le Coran aujourd’hui 💛" });
    let sent = 0;
    for (const s of Array.isArray(subs) ? subs : []) {
      try {
        const r = await sendPush(s, payload, vapid, APP + "/coran-for-malak/");
        if (r.ok) sent++;
        else if (r.status === 404 || r.status === 410) await db("push_subs?endpoint=eq." + encodeURIComponent(s.endpoint), { method: "DELETE" }); // abonnement expiré
      } catch { /* un téléphone injoignable n'empêche pas les autres */ }
    }
    return json({ sent });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e).slice(0, 120) }, 500);
  }
});
