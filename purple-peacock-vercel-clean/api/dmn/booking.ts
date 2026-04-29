import type { VercelRequest, VercelResponse } from "@vercel/node";

const DMN_BASE_URL = "https://api.designmynight.com/v4";
const DEFAULT_VENUE_ID = "6214cfdb21d4111e033a9433";

function normaliseTime(value: unknown) {
  if (!value) return "";
  const match = String(value).match(/\d{1,2}:\d{2}/);
  return match ? match[0].padStart(5, "0") : String(value);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const appId = process.env.DMN_APP_ID;
  const apiKey = process.env.DMN_API_KEY;
  const venueId = process.env.DMN_VENUE_ID || DEFAULT_VENUE_ID;

  if (!appId || !apiKey) {
    return res.status(500).json({
      success: false,
      message: "DesignMyNight API credentials are not configured.",
    });
  }

  const body = req.body ?? {};
  const bookingType = String(body.type ?? "");
  const date = String(body.date ?? "");
  const time = normaliseTime(body.time);
  const guests = Number(body.num_people);
  const durationMinutes = Number(body.duration ?? body.durationMinutes ?? 120);
  const firstName = String(body.first_name ?? "").trim();
  const lastName = String(body.last_name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const notes = String(body.notes ?? "").trim();

  if (!bookingType || !date || !time || !Number.isFinite(guests) || guests < 1 || !firstName || !lastName) {
    return res.status(400).json({
      success: false,
      message: "Missing booking type, date, time, guest count or customer name.",
    });
  }

  const dmnResponse = await fetch(`${DMN_BASE_URL}/bookings`, {
    method: "POST",
    headers: {
      Authorization: `${appId}:${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: process.env.DMN_SOURCE || "partner",
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      num_people: guests,
      venue_id: venueId,
      type: bookingType,
      date,
      time,
      duration: durationMinutes,
      notes,
    }),
  });

  const dmnJson = await dmnResponse.json().catch(() => ({}));
  const payload = dmnJson?.payload ?? dmnJson ?? {};

  if (!dmnResponse.ok) {
    return res.status(dmnResponse.status).json({
      success: false,
      message: payload?.message ?? dmnJson?.statusText ?? "DesignMyNight enquiry submission failed.",
      status: dmnResponse.status,
    });
  }

  return res.status(200).json({
    success: true,
    reference: payload.reference ?? payload.booking_ref ?? payload._id ?? payload.id ?? null,
    status: payload.status ?? "enquiry",
    message: "Your enquiry has been received.",
  });
}
