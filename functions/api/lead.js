// Cloudflare Pages Function — POST /api/lead
// Receives the contact-form submission and creates a contact in the
// GoHighLevel (LeadConnector) CRM via the API.
//
// Required environment variables (set in Cloudflare Pages → Settings → Variables):
//   GHL_TOKEN        - your GoHighLevel Private Integration Token (pit-...). Mark as a SECRET.
//   GHL_LOCATION_ID  - your sub-account location ID (e.g. 4aY8ibMYcg3MCmiIvGCf)
//
// The token lives only in Cloudflare's encrypted env — never in the page or the repo.

const GHL_BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

export async function onRequestPost({ request, env }) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (!env.GHL_TOKEN || !env.GHL_LOCATION_ID) {
    return json({ ok: false, error: "Server not configured (missing GHL_TOKEN or GHL_LOCATION_ID)." }, 500, cors);
  }

  let d;
  try {
    d = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400, cors);
  }

  // Basic validation / honeypot-friendly
  const email = (d.email || "").trim();
  const fullName = (d.fullName || "").trim();
  if (!email && !(d.phone || "").trim()) {
    return json({ ok: false, error: "Email or phone is required." }, 400, cors);
  }

  const parts = fullName.split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || fullName || "Website";
  const lastName = parts.join(" ") || "Lead";

  const contactBody = {
    locationId: env.GHL_LOCATION_ID,
    firstName,
    lastName,
    name: fullName || `${firstName} ${lastName}`.trim(),
    email,
    phone: (d.phone || "").trim(),
    source: d.source || "spireconstructors.com",
    tags: ["Website Lead"],
  };

  const base = env.GHL_BASE || GHL_BASE; // GHL_BASE is only set when testing against a local stand-in
  const headers = {
    Authorization: `Bearer ${env.GHL_TOKEN}`,
    Version: VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Create / upsert the contact
  let created;
  try {
    const res = await fetch(`${base}/contacts/`, {
      method: "POST",
      headers,
      body: JSON.stringify(contactBody),
    });
    created = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 400 with "duplicated contact" still means we have the contact id in some responses
      const dupId = created?.meta?.contactId || created?.contact?.id;
      if (!dupId) {
        return json({ ok: false, error: created || "GHL contact create failed." }, 502, cors);
      }
      created = { contact: { id: dupId } };
    }
  } catch (e) {
    return json({ ok: false, error: String(e) }, 502, cors);
  }

  const contactId = created?.contact?.id;

  // Attach the qualifying details as a note so nothing is lost,
  // even before the custom fields are mapped.
  const noteLines = [];
  if (d.service) noteLines.push(`Service: ${d.service}`);
  if (d.budget) noteLines.push(`Budget: ${d.budget}`);
  if (d.details) noteLines.push(`Details: ${d.details}`);
  if (Array.isArray(d.files) && d.files.length) {
    const names = d.files.slice(0, 25).map((f) => String((f && f.name) || "").slice(0, 120)).filter(Boolean);
    noteLines.push(`Drawings sent with the form: ${d.files.length} file${d.files.length === 1 ? "" : "s"} (${names.join(", ")}). Download links follow in a separate note when the upload finishes.`);
  }
  if (contactId && noteLines.length) {
    try {
      await fetch(`${base}/contacts/${contactId}/notes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body: noteLines.join("\n") }),
      });
    } catch {
      /* note is best-effort; contact already captured */
    }
  }

  // A signed, six-hour upload token lets this lead's drawings go to /api/upload.
  let uploadToken = null;
  if (contactId && /^[A-Za-z0-9_-]{1,64}$/.test(contactId)) {
    const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
    uploadToken = `${contactId}.${exp}.${await sign(env.GHL_TOKEN, `spire-upload|${contactId}|${exp}`)}`;
  }

  return json({ ok: true, contactId: contactId || null, uploadToken, uploads: Boolean(env.FILES && uploadToken) }, 200, cors);
}

async function sign(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Preflight
export function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: cors });
}
