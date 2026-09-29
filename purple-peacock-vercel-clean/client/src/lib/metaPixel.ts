// Meta Pixel tracking for the Purple Peacock events calendar.
// Purchases fire only after a booking is confirmed (server-verified DMN return
// or a successful direct DMN booking) and only once per booking reference.

import type { CalendarEvent, EventSession } from "@shared/schema";

export const META_PIXEL_ID = "459104709329475";

const CONSENT_KEY = "pp_pixel_consent";
const CHECKOUT_KEY = "pp_pixel_checkout";
const SENT_KEY = "pp_pixel_purchases_sent";
const CHECKOUT_TTL_MS = 1000 * 60 * 60 * 6;

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[] };
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let initialised = false;

function safeGet(storage: Storage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage may be blocked in embedded/private contexts.
  }
}

// Consent: the host website passes ?consent=granted|denied on the iframe URL.
// The choice is remembered so it still applies when DMN returns the customer
// to the standalone calendar. No signal = the site's default (granted).
function resolveConsent(): boolean {
  const param = new URLSearchParams(window.location.search).get("consent");
  if (param === "granted" || param === "denied") safeSet(window.localStorage, CONSENT_KEY, param);
  return safeGet(window.localStorage, CONSENT_KEY) !== "denied";
}

function loadScript() {
  if (window.fbq) return;
  const n = function (...args: unknown[]) {
    n.callMethod ? n.callMethod(...args) : n.queue!.push(args);
  } as Fbq & { push?: unknown; loaded?: boolean; version?: string };
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  window.fbq = n;
  if (!window._fbq) window._fbq = n;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
}

export function initMetaPixel() {
  if (initialised || typeof window === "undefined") return;
  if (!resolveConsent()) return;
  initialised = true;
  loadScript();
  // The calendar rewrites its own URL (hash routing, return clean-up); stop the pixel
  // counting those history changes as extra PageViews.
  (window.fbq as Fbq & { disablePushState?: boolean }).disablePushState = true;
  // Turn off Meta's automatic button-click events; every event here is explicit.
  window.fbq!("set", "autoConfig", false, META_PIXEL_ID);
  window.fbq!("init", META_PIXEL_ID);
  window.fbq!("track", "PageView");
}

function fbq(...args: unknown[]) {
  if (!initialised || !window.fbq) return;
  try {
    window.fbq(...args);
  } catch {
    // Tracking must never break booking.
  }
}

export function track(event: string, params: Record<string, unknown> = {}, eventId?: string) {
  fbq("track", event, params, eventId ? { eventID: eventId } : undefined);
}

export function trackCustom(event: string, params: Record<string, unknown> = {}, eventId?: string) {
  fbq("trackCustom", event, params, eventId ? { eventID: eventId } : undefined);
}

// Advanced matching: Meta hashes these client-side before sending.
export function setUserData(customer: { email?: string; phone?: string; firstName?: string; lastName?: string }) {
  const data: Record<string, string> = {};
  const clean = (v?: string) => (v || "").trim().toLowerCase();
  if (clean(customer.email)) data.em = clean(customer.email);
  const phone = (customer.phone || "").replace(/[^\d]/g, "").replace(/^0/, "44");
  if (phone) data.ph = phone;
  if (clean(customer.firstName)) data.fn = clean(customer.firstName);
  if (clean(customer.lastName)) data.ln = clean(customer.lastName);
  if (Object.keys(data).length) fbq("init", META_PIXEL_ID, data);
}

export function parsePounds(display?: string | null): number | null {
  if (!display) return null;
  const match = display.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function unitPrice(event: CalendarEvent, ticketOption: string) {
  const premium = ticketOption === "premium" && event.secondaryTicketEnabled ? parsePounds(event.secondaryTicketPriceDisplay) : null;
  return premium ?? parsePounds(event.standardTicketPriceDisplay) ?? round((event.priceFromPence || 0) / 100);
}

const toneCategory: Record<string, string> = { drunch: "Drunch", show: "Show Night", christmas: "Christmas" };

export function eventCategory(event: CalendarEvent) {
  if (event.category && event.category !== "Purple Peacock") return event.category;
  return toneCategory[event.imageTone] || "Event";
}

export function contentParams(event: CalendarEvent, session?: EventSession) {
  return {
    content_name: event.title,
    content_category: eventCategory(event),
    content_ids: [event.slug || event.id],
    content_type: "product",
    currency: "GBP",
    ...(session ? { event_date: session.date, event_time: session.time } : {}),
  };
}

export function basketParams(event: CalendarEvent, session: EventSession, guests: number, ticketOption: string) {
  const price = unitPrice(event, ticketOption);
  const safeGuests = Math.max(1, guests || 1);
  return {
    ...contentParams(event, session),
    num_items: safeGuests,
    ticket_type: ticketOption === "premium" && event.secondaryTicketEnabled ? "premium" : "standard",
    unit_price: price,
    value: round(price * safeGuests),
    deposit_value: round(((event.depositPence || 0) / 100) * safeGuests),
  };
}

type CheckoutSnapshot = ReturnType<typeof basketParams> & { createdAt: number };

export function saveCheckout(sessionId: string, params: ReturnType<typeof basketParams>) {
  const snapshot: CheckoutSnapshot = { ...params, createdAt: Date.now() };
  safeSet(window.localStorage, `${CHECKOUT_KEY}:${sessionId}`, JSON.stringify(snapshot));
}

export function readCheckout(sessionId?: string | null): CheckoutSnapshot | null {
  if (!sessionId) return null;
  try {
    const raw = safeGet(window.localStorage, `${CHECKOUT_KEY}:${sessionId}`);
    const parsed = raw ? (JSON.parse(raw) as CheckoutSnapshot) : null;
    if (!parsed || Date.now() - parsed.createdAt > CHECKOUT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sentReferences(): string[] {
  try {
    return JSON.parse(safeGet(window.localStorage, SENT_KEY) || "[]");
  } catch {
    return [];
  }
}

// Fires one Purchase per booking reference, with full booking revenue as value.
export function trackPurchase(reference: string, params: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const ref = (reference || "").trim();
  if (!ref) return false;
  const sent = sentReferences();
  if (sent.includes(ref)) return false;
  const { createdAt: _createdAt, ...clean } = params as Record<string, unknown>;
  track("Purchase", { ...clean, ...extra, order_id: ref }, `purchase_${ref}`);
  safeSet(window.localStorage, SENT_KEY, JSON.stringify([...sent, ref].slice(-50)));
  return true;
}
