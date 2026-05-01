import type { VercelRequest, VercelResponse } from "@vercel/node";

const DMN_BASE_URL = "https://api.designmynight.com/v4";
const DEFAULT_VENUE_ID = "6214cfdb21d4111e033a9433";
const DRUNCH_BOOKING_TYPE_ID = "65ae86770e1da03dc56bbfc2";

function normaliseTime(value: unknown) {
  if (!value) return "";
  const match = String(value).match(/\d{1,2}:\d{2}/);
  return match ? match[0].padStart(5, "0") : String(value);
}

function normaliseDurationMinutes(bookingType: string, value: number) {
  if (bookingType === DRUNCH_BOOKING_TYPE_ID) return 120;
  if (!Number.isFinite(value) || value <= 0) return 120;
  return value;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function extractDmnReference(responseJson: any) {
  const payload = responseJson?.payload ?? responseJson ?? {};
  const booking = payload?.booking ?? payload?.data?.booking ?? payload?.payload?.booking ?? {};
  const enquiry = payload?.enquiry ?? payload?.data?.enquiry ?? payload?.payload?.enquiry ?? {};
  const data = payload?.data ?? {};

  return firstString(
    payload.reference,
    payload.booking_reference,
    payload.booking_ref,
    payload.bookingReference,
    payload.ref,
    payload._id,
    payload.id,
    data.reference,
    data.booking_reference,
    data.booking_ref,
    data.bookingReference,
    data.ref,
    data._id,
    data.id,
    booking.reference,
    booking.booking_reference,
    booking.booking_ref,
    booking.bookingReference,
    booking.ref,
    booking._id,
    booking.id,
    enquiry.reference,
    enquiry.booking_reference,
    enquiry.booking_ref,
    enquiry.bookingReference,
    enquiry.ref,
    enquiry._id,
    enquiry.id,
  );
}

function extractDmnStatus(responseJson: any) {
  const payload = responseJson?.payload ?? responseJson ?? {};
  return firstString(
    payload.status,
    payload.booking_status,
    payload.action,
    payload?.data?.status,
    payload?.booking?.status,
    payload?.enquiry?.status,
  );
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
  const requestedDuration = Number(body.duration ?? body.durationMinutes ?? 120);
  const durationMinutes = normaliseDurationMinutes(bookingType, requestedDuration);
  const fullName = String(body.name ?? "").trim();
  const firstName = String(body.first_name ?? fullName.split(" ")[0] ?? "Guest").trim() || "Guest";
  const lastName = String(body.last_name ?? fullName.split(" ").slice(1).join(" ") ?? "Enquiry").trim() || "Enquiry";
  const email = String(body.email ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const notes = String(body.notes ?? "").trim();

  const debugReceived = {
    has_type: Boolean(bookingType),
    type: bookingType || null,
    date,
    time,
    guests,
    duration: durationMinutes,
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    event_title: body.event_title ?? null,
    session_id: body.session_id ?? null,
  };

  if (!bookingType || !date || !time || !Number.isFinite(guests) || guests < 1) {
    return res.status(200).json({
      success: false,
      debug: true,
      message: "Missing booking type, date, time, guest count or customer name.",
      received: debugReceived,
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
    return res.status(200).json({
      success: false,
      debug: true,
      message: payload?.message ?? dmnJson?.statusText ?? "DesignMyNight enquiry submission failed.",
      status: dmnResponse.status,
      received: debugReceived,
      raw: dmnJson,
    });
  }

  return res.status(200).json({
    success: true,
    reference: extractDmnReference(dmnJson),
    dmnReference: extractDmnReference(dmnJson),
    status: extractDmnStatus(dmnJson) ?? "enquiry",
    message: "Your enquiry has been received.",
    raw: dmnJson,
  });
}
