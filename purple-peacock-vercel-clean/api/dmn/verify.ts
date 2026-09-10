import type { VercelRequest, VercelResponse } from "@vercel/node";

const DMN_BASE_URL = "https://api.designmynight.com/v4";
const DEFAULT_VENUE_ID = "6214cfdb21d4111e033a9433";
const unverified = { verified: false, status: "unverified", depositVerified: false };

// Return parameters and browser storage are hints, never proof of a booking or payment.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(unverified);
  }
  const reference = typeof req.body?.reference === "string" ? req.body.reference.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const bookingId = /^(?:DMN-)?(\d{1,20})$/i.exec(reference)?.[1];
  if (!bookingId || !email || email.length > 254 || !email.includes("@")) {
    return res.status(200).json(unverified);
  }
  const appId = process.env.DMN_APP_ID;
  const apiKey = process.env.DMN_API_KEY;
  const venueId = process.env.DMN_VENUE_ID || DEFAULT_VENUE_ID;
  if (!appId || !apiKey) return res.status(200).json(unverified);

  const params = new URLSearchParams({
    booking_id: bookingId,
    email,
    venue_id: venueId,
    status: "new,in_progress,complete,rejected,deleted,lost",
    fields: "booking_id,reference,email,venue_id,status,date,time,num_people,type",
    limit: "2",
  });
  async function lookup(query: URLSearchParams) {
    const response = await fetch(`${DMN_BASE_URL}/bookings?${query}`, {
      headers: { Authorization: `${appId}:${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.warn("DMN booking verification unavailable", response.status);
      throw new Error("Verification unavailable");
    }
    const result = await response.json();
    if (!Array.isArray(result?.payload?.bookings)) throw new Error("Invalid verification response");
    return result.payload.bookings as Array<Record<string, any>>;
  }
  function matches(booking: Record<string, any>) {
    const id = String(booking.booking_id ?? String(booking.reference ?? "").replace(/^DMN-/i, ""));
    return id === bookingId && booking.venue_id === venueId &&
      String(booking.email ?? "").trim().toLowerCase() === email &&
      (!req.body.date || String(booking.date ?? "").slice(0, 10) === req.body.date) &&
      (!req.body.time || booking.time === req.body.time) &&
      (!req.body.type || booking.type?.id === req.body.type) &&
      (!req.body.guests || Number(booking.num_people) === Number(req.body.guests));
  }
  try {
    const bookings = (await lookup(params)).filter(matches);
    if (bookings.length !== 1) return res.status(200).json(unverified);
    const booking = bookings[0];
    const statuses: Record<string, string> = {
      complete: "confirmed", new: "enquiry", in_progress: "enquiry",
      rejected: "cancelled", deleted: "cancelled", lost: "cancelled",
    };
    const status = statuses[booking.status];
    if (!status) return res.status(200).json(unverified);
    let depositVerified = false;
    if (status === "confirmed") {
      // A confirmed booking or a card authentication is not evidence of a paid deposit.
      // Only DMN's explicit deposit_paid filter establishes that money was received.
      const paidParams = new URLSearchParams(params);
      paidParams.set("notifications", "deposit_paid");
      try {
        depositVerified = (await lookup(paidParams)).some(b => matches(b) && b.status === "complete");
      } catch {
        // Booking confirmation remains valid; payment stays unverified.
      }
    }
    return res.status(200).json({ verified: true, status, depositVerified });
  } catch {
    return res.status(200).json(unverified);
  }
}
