// Cloudflare Pages Function — GET /api/drawings/<date>/<contact>/<file>
// Serves a drawing file from the site's private R2 bucket (binding FILES) for the
// download links in the lead's GoHighLevel note. Each link carries a random
// 16-hex-character id, so a file can only be reached by someone who has its link.

const INLINE = new Set(["application/pdf", "image/png", "image/jpeg"]);

export async function onRequestGet({ params, env }) {
  if (!env.FILES) return new Response("File storage is not connected.", { status: 503 });
  // the link's path arrives URL-encoded (a space is %20); stored names never contain "%"
  const parts = (Array.isArray(params.path) ? params.path : [params.path]).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const key = "drawings/" + parts.join("/");
  if (!/^drawings\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+\/[0-9a-f]{16}-[^/]+$/.test(key)) {
    return new Response("Not found.", { status: 404 });
  }
  const obj = await env.FILES.get(key);
  if (!obj) return new Response("Not found.", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  const type = headers.get("Content-Type") || "application/octet-stream";
  const name = (obj.customMetadata && obj.customMetadata.originalName) || key.split("/").pop();
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  headers.set("Content-Disposition",
    `${INLINE.has(type) ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  headers.set("ETag", obj.httpEtag);
  headers.set("Content-Length", String(obj.size));
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(obj.body, { headers });
}
