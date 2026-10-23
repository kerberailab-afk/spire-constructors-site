// Cloudflare Pages Function — /api/upload
// Takes drawing files from the contact form and stores them, under drawings/, in the
// site's private R2 bucket (bound to this project as FILES, the spire-files bucket the
// team tool already uses for files/), then adds a note with download links to the
// lead's GoHighLevel contact.
//
// Flow (every call carries the upload token that /api/lead returned for this lead):
//   POST ?action=create    {token, name, size}            -> {key, uploadId, partSize}
//   PUT  ?action=part&key=&uploadId=&part=N  (body: bytes, header X-Upload-Token)
//                                                          -> {part, etag}
//   POST ?action=complete  {token, key, uploadId, parts}   -> {key, size}
//   POST ?action=abort     {token, key, uploadId}          -> {ok}
//   POST ?action=notify    {token, files:[{key}]}          -> {ok}   (posts the GHL note)
//
// Needs (Cloudflare Pages -> Settings -> Bindings / Variables):
//   FILES            - R2 bucket binding (already set; the bucket stays private)
//   GHL_TOKEN        - already set for /api/lead; also signs the upload tokens
//   GHL_LOCATION_ID  - already set for /api/lead
// Files are served back by /api/drawings/<path> (functions/api/drawings/[[path]].js).

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const PART_SIZE = 20 * 1024 * 1024;          // every part but the last is exactly this size (an R2 rule)
const MAX_FILE = 1024 * 1024 * 1024;         // 1 GB per file
const MAX_PARTS = Math.ceil(MAX_FILE / PART_SIZE);
const ALLOWED = new Set(["pdf", "dwg", "dxf", "dwf", "dwfx", "rvt", "rfa", "ifc", "skp", "zip",
  "png", "jpg", "jpeg", "tif", "tiff", "heic", "xls", "xlsx", "csv", "doc", "docx", "txt"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Upload-Token",
  "X-Robots-Tag": "noindex",
};

export function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPut({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get("action") !== "part") return json({ ok: false, error: "Unknown action." }, 400);
  if (!env.FILES) return json({ ok: false, error: "File storage is not connected." }, 503);

  const who = await verifyToken(env, request.headers.get("X-Upload-Token"));
  if (!who) return json({ ok: false, error: "Upload session expired. Please send the form again." }, 401);

  const key = url.searchParams.get("key") || "";
  const uploadId = url.searchParams.get("uploadId") || "";
  const part = Number(url.searchParams.get("part"));
  if (!ownsKey(key, who) || !uploadId) return json({ ok: false, error: "Bad upload reference." }, 400);
  if (!Number.isInteger(part) || part < 1 || part > MAX_PARTS) return json({ ok: false, error: "Bad part number." }, 400);
  const len = Number(request.headers.get("Content-Length") || 0);
  if (!len || len > PART_SIZE) return json({ ok: false, error: "Bad part size." }, 400);

  try {
    const mpu = env.FILES.resumeMultipartUpload(key, uploadId);
    const done = await mpu.uploadPart(part, await request.arrayBuffer());
    return json({ ok: true, part: done.partNumber, etag: done.etag });
  } catch (e) {
    return json({ ok: false, error: "Part upload failed." }, 502);
  }
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  if (!env.FILES) return json({ ok: false, error: "File storage is not connected." }, 503);

  let d;
  try { d = await request.json(); } catch { return json({ ok: false, error: "Invalid request body." }, 400); }
  const who = await verifyToken(env, d.token);
  if (!who) return json({ ok: false, error: "Upload session expired. Please send the form again." }, 401);

  if (action === "create") {
    const name = String(d.name || "").slice(0, 200);
    const size = Number(d.size);
    const ext = (name.match(/\.([A-Za-z0-9]+)$/) || [])[1];
    if (!ext || !ALLOWED.has(ext.toLowerCase())) return json({ ok: false, error: "That file type isn't accepted." }, 400);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE) return json({ ok: false, error: "Files can be up to 1 GB each." }, 400);
    const day = new Date().toISOString().slice(0, 10);
    const key = `drawings/${day}/${who}/${randomHex(8)}-${safeName(name)}`;
    const mpu = await env.FILES.createMultipartUpload(key, {
      httpMetadata: { contentType: typeFor(ext) },
      customMetadata: { originalName: name, contactId: who, size: String(size) },
    });
    return json({ ok: true, key, uploadId: mpu.uploadId, partSize: PART_SIZE });
  }

  if (action === "complete") {
    if (!ownsKey(d.key, who) || !d.uploadId || !Array.isArray(d.parts) || !d.parts.length) {
      return json({ ok: false, error: "Bad upload reference." }, 400);
    }
    const parts = d.parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }))
      .sort((a, b) => a.partNumber - b.partNumber);
    try {
      const obj = await env.FILES.resumeMultipartUpload(d.key, d.uploadId).complete(parts);
      if (obj.size > MAX_FILE) { await env.FILES.delete(d.key); return json({ ok: false, error: "Files can be up to 1 GB each." }, 400); }
      return json({ ok: true, key: d.key, size: obj.size });
    } catch (e) {
      return json({ ok: false, error: "Could not finish the upload." }, 502);
    }
  }

  if (action === "abort") {
    if (!ownsKey(d.key, who) || !d.uploadId) return json({ ok: false, error: "Bad upload reference." }, 400);
    try { await env.FILES.resumeMultipartUpload(d.key, d.uploadId).abort(); } catch { /* already gone */ }
    return json({ ok: true });
  }

  if (action === "notify") {
    const keys = Array.isArray(d.files) ? d.files.map((f) => f && f.key).filter((k) => ownsKey(k, who)) : [];
    if (!keys.length) return json({ ok: false, error: "No files to report." }, 400);
    const origin = url.origin;
    const lines = [];
    let total = 0;
    for (const key of keys.slice(0, 50)) {
      const obj = await env.FILES.head(key);
      if (!obj) continue;
      total += obj.size;
      const name = (obj.customMetadata && obj.customMetadata.originalName) || key.split("/").pop();
      const path = key.slice("drawings/".length).split("/").map(encodeURIComponent).join("/");
      lines.push(`- ${name} (${mb(obj.size)}): ${origin}/api/drawings/${path}`);
    }
    if (!lines.length) return json({ ok: false, error: "No files found." }, 400);
    const body = `Drawings uploaded from the website (${lines.length} file${lines.length === 1 ? "" : "s"}, ${mb(total)}):\n${lines.join("\n")}`;
    try {
      const res = await fetch(`${env.GHL_BASE || GHL_BASE}/contacts/${who}/notes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GHL_TOKEN}`,
          Version: GHL_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) return json({ ok: false, error: "Files are stored, but the CRM note failed." }, 502);
    } catch {
      return json({ ok: false, error: "Files are stored, but the CRM note failed." }, 502);
    }
    return json({ ok: true, files: lines.length });
  }

  return json({ ok: false, error: "Unknown action." }, 400);
}

/* ---------- helpers ---------- */

// The token comes from /api/lead: "<contactId>.<expiry seconds>.<signature>", signed with GHL_TOKEN.
async function verifyToken(env, token) {
  if (!env.GHL_TOKEN || typeof token !== "string") return null;
  const m = token.match(/^([A-Za-z0-9_-]{1,64})\.(\d{9,11})\.([A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const [, contactId, exp, sig] = m;
  if (Number(exp) * 1000 < Date.now()) return null;
  const want = await sign(env.GHL_TOKEN, `spire-upload|${contactId}|${exp}`);
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? contactId : null;
}

async function sign(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A key belongs to the token's lead only if it sits in that lead's folder.
function ownsKey(key, contactId) {
  return typeof key === "string" && /^drawings\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+\/[0-9a-f]{16}-[^/]+$/.test(key)
    && key.split("/")[2] === contactId;
}

function safeName(name) {
  const clean = name.normalize("NFKD").replace(/[^\w.() -]+/g, "_").replace(/\s+/g, " ").trim();
  return (clean || "file").slice(-120);
}

function randomHex(bytes) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function typeFor(ext) {
  const e = ext.toLowerCase();
  return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", tif: "image/tiff",
    tiff: "image/tiff", heic: "image/heic", zip: "application/zip", csv: "text/csv", txt: "text/plain" })[e]
    || "application/octet-stream";
}

function mb(bytes) {
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
