import type { VercelRequest, VercelResponse } from "@vercel/node";

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const payload = req.method === "POST" ? req.body ?? {} : req.query ?? {};
  const params = new URLSearchParams();

  params.set("booking_return", "1");

  const reference = firstString(
    payload.reference,
    payload.booking_reference,
    payload.booking_ref,
    payload.bookingReference,
    payload.ref,
    payload.id,
    payload._id,
  );
  if (reference) params.set("reference", reference);

  const status = firstString(payload.status, payload.booking_status);
  if (status) params.set("status", status);

  const firstName = firstString(payload.first_name, payload.firstname, payload.firstName);
  if (firstName) params.set("first_name", firstName);

  const lastName = firstString(payload.last_name, payload.lastname, payload.lastName);
  if (lastName) params.set("last_name", lastName);

  const email = firstString(payload.email);
  if (email) params.set("email", email);

  const guests = firstString(payload.num_people, payload.people, payload.guests, payload.covers);
  if (guests) params.set("guests", guests);

  const date = firstString(payload.date, payload.booking_date);
  if (date) params.set("date", date);

  const time = firstString(payload.time, payload.booking_time);
  if (time) params.set("time", time);

  const returnPath = `/?${params.toString()}`;
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(303, returnPath);
}
