import type { VercelRequest, VercelResponse } from "@vercel/node";

const DMN_BASE_URL = "https://api.designmynight.com/v4";
const DEFAULT_VENUE_ID = "6214cfdb21d4111e033a9433";
const DRUNCH_BOOKING_TYPE_ID = "65ae86770e1da03dc56bbfc2";

type SuggestedTime = {
  time: string;
  valid: boolean;
  message?: string;
  action?: string;
};

function normaliseTime(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/\d{1,2}:\d{2}/);
    return match ? match[0].padStart(5, "0") : value;
  }
  if (typeof value === "object" && value !== null && "time" in value) {
    return normaliseTime((value as { time?: unknown }).time);
  }
  return String(value);
}

function messageFor(action: string | null, valid: boolean) {
  if (action === "accept") return "Availability confirmed for this slot.";
  if (action === "book" || action === "may_book" || action === "can_book") return "Availability confirmed for this slot.";
  if (action === "enquire") return "This slot is available as an enquiry-led booking.";
  if (action === "may_enquire") return "This slot is not directly available, but you may submit an enquiry.";
  if (action === "reject" || !valid) return "This slot is not available for the selected party size.";
  return "DesignMyNight returned an availability response for this slot.";
}

function isInstantAvailability(actionValue: unknown, valid: boolean) {
  const action = String(actionValue ?? "").trim().toLowerCase();
  const enquiryActions = new Set([
    "may_enquire",
    "enquire",
    "enquiry",
    "reject",
    "rejected",
    "unavailable",
    "sold_out",
    "sold-out",
    "closed",
  ]);

  if (!valid || enquiryActions.has(action)) return false;
  return true;
}

function normaliseDurationMinutes(bookingType: string, value: number) {
  if (bookingType === DRUNCH_BOOKING_TYPE_ID) return 120;
  if (!Number.isFinite(value) || value <= 0) return 120;
  return value;
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
      available: false,
      valid: false,
      action: "configuration_error",
      message: "DesignMyNight API credentials are not configured.",
    });
  }

  const body = req.body ?? {};
  const bookingType = String(body.type ?? "");
  const date = String(body.date ?? "");
  const time = normaliseTime(body.time);
  const guests = Number(body.num_people);
  const durationMinutes = normaliseDurationMinutes(bookingType, Number(body.durationMinutes ?? body.duration ?? 120));

  if (!bookingType || !date || !time || !Number.isFinite(guests) || guests < 1) {
    return res.status(400).json({
      available: false,
      valid: false,
      action: "invalid_request",
      message: "Missing booking type, date, time or guest count.",
    });
  }

  const durationHours = Number.isFinite(durationMinutes)
    ? Number((durationMinutes / 60).toFixed(2))
    : 2;

  const dmnResponse = await fetch(`${DMN_BASE_URL}/venues/${venueId}/booking-availability`, {
    method: "POST",
    headers: {
      Authorization: `${appId}:${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: bookingType,
      num_people: guests,
      date,
      time,
      duration: durationHours,
    }),
  });

  const dmnJson = await dmnResponse.json().catch(() => ({}));
  const payload = dmnJson?.payload ?? dmnJson ?? {};

  if (!dmnResponse.ok) {
    return res.status(dmnResponse.status).json({
      available: false,
      valid: false,
      action: "api_error",
      message: payload?.message ?? dmnJson?.statusText ?? "DesignMyNight availability check failed.",
      status: dmnResponse.status,
    });
  }

  const action = payload.action ?? null;
  const valid = payload.valid !== false;
  const available = isInstantAvailability(action, valid);
  const suggestedTimes: SuggestedTime[] = Array.isArray(payload.validation?.time?.suggestedValues)
    ? payload.validation.time.suggestedValues.map((suggestion: any) => ({
        time: normaliseTime(suggestion.value),
        valid: Boolean(suggestion.valid),
        message: suggestion.message,
        action: suggestion.action,
      }))
    : [];

  return res.status(200).json({
    available,
    valid,
    action,
    message: messageFor(action, valid),
    depositRequired: Boolean(payload.depositRequired),
    preordersAvailable: Boolean(payload.preordersAvailable),
    suggestedTimes,
  });
}
