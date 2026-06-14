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

  const headers = {
    Authorization: `Bearer ${env.GHL_TOKEN}`,
    Version: VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Create / upsert the contact
  let created;
  try {
    const res = await fetch(`${GHL_BASE}/contacts/`, {
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
  if (contactId && noteLines.length) {
    try {
      await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body: noteLines.join("\n") }),
      });
    } catch {
      /* note is best-effort; contact already captured */
    }
  }

  return json({ ok: true, contactId: contactId || null }, 200, cors);
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
