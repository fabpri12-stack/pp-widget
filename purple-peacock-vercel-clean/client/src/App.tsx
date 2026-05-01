import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  Download,
  Film,
  GlassWater,
  Loader2,
  Menu as MenuIcon,
  Package,
  Moon,
  Play,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Sun,
  Ticket,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { apiRequest, queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { loadCalendarData } from "@/lib/calendarData";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CalendarEvent, CalendarResponse, EventSession } from "@shared/schema";

type SessionWithEvent = EventSession & { event: CalendarEvent };
type ModalMode = "menu" | "how" | "faq" | "guide" | "video" | null;
type ViewMode = "calendar" | "cards";
type BookingStep = "event" | "availability" | "details" | "transfer" | "confirmation";
type AvailabilityState = "idle" | "checking" | "available" | "enquiry" | "error";
type PaymentFlowState = "idle" | "redirecting" | "awaiting" | "submitting-enquiry";
type TicketOptionChoice = "standard" | "premium";
type AvailabilityResult = {
  available: boolean;
  valid: boolean;
  action: string | null;
  message: string;
  depositRequired?: boolean;
  preordersAvailable?: boolean;
  suggestedTimes?: Array<{
    time: string;
    valid: boolean;
    message?: string;
    action?: string;
  }>;
};
type BookingReturn = {
  reference: string;
  dmnReference?: string;
  status: string;
  flow?: "payment" | "direct" | "enquiry";
  success?: boolean;
  errorMessage?: string;
  technicalError?: boolean;
  firstName?: string;
  lastName?: string;
  email?: string;
} | null;

const imageMap: Record<CalendarEvent["imageTone"], string> = {
  show: "./images/show-nights.svg",
  drunch: "./images/drunch.svg",
  christmas: "./images/christmas.svg",
};

function eventImage(event: CalendarEvent) {
  return event.imageUrl || imageMap[event.imageTone];
}

const monthLabels = ["May 2026", "November 2026"];
const monthDates = [new Date(2026, 4, 1), new Date(2026, 10, 1)];

const defaultCustomer = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  guests: 0,
  notes: "",
  ticketOption: "standard" as TicketOptionChoice,
};

const dmnBookingConfig = {
  venueGroupId: "6141cde2ccb4d7565902c433",
  venueId: "6214cfdb21d4111e033a9433",
  source: "NovaAI",
};

const DRUNCH_BOOKING_TYPE_ID = "65ae86770e1da03dc56bbfc2";
const PAYMENT_RETURN_STORAGE_KEY = "purple-peacock-dmn-return";
const PAYMENT_PENDING_STORAGE_KEY = "purple-peacock-dmn-pending";
const PAYMENT_PENDING_TTL_MS = 1000 * 60 * 60 * 3;

function pendingPaymentKey(returnId?: string | null) {
  return returnId ? `${PAYMENT_PENDING_STORAGE_KEY}:${returnId}` : PAYMENT_PENDING_STORAGE_KEY;
}

function getDmnDurationMinutes(session: EventSession) {
  if (session.dmnBookingTypeId === DRUNCH_BOOKING_TYPE_ID) return 120;
  if (!Number.isFinite(session.durationMinutes) || session.durationMinutes <= 0) return 120;
  return session.durationMinutes;
}

function getSelectedTicketOption(event: CalendarEvent, choice: TicketOptionChoice) {
  if (choice === "premium" && event.secondaryTicketEnabled) {
    return {
      choice: "premium" as TicketOptionChoice,
      label: event.secondaryTicketLabel || "Premium",
      price: event.secondaryTicketPriceDisplay || null,
      description: event.secondaryTicketDescription || null,
    };
  }

  return {
    choice: "standard" as TicketOptionChoice,
    label: event.standardTicketLabel || "Standard",
    price: event.standardTicketPriceDisplay || formatMoney(event.priceFromPence),
    description: event.standardTicketDescription || "Standard show night ticket",
  };
}

function buildDmnNotes(event: CalendarEvent, customer: typeof defaultCustomer) {
  const ticket = getSelectedTicketOption(event, customer.ticketOption);
  const ticketLine = [
    `Ticket choice: ${ticket.label}`,
    ticket.price ? ` - ${ticket.price}` : "",
    ticket.description ? ` (${ticket.description})` : "",
  ].join("");
  const customerNotes = customer.notes.trim();

  return customerNotes ? `${ticketLine}\nCustomer notes: ${customerNotes}` : ticketLine;
}

function buildDmnHandoffUrl(session: EventSession, event: CalendarEvent, customer: typeof defaultCustomer) {
  const durationMinutes = getDmnDurationMinutes(session);
  const returnUrl = new URL(`${window.location.origin}${window.location.pathname}`);

  const params = new URLSearchParams({
    venue_group: dmnBookingConfig.venueGroupId,
    venue_id: dmnBookingConfig.venueId,
    type: session.dmnBookingTypeId,
    num_people: String(customer.guests),
    date: session.date,
    time: session.time,
    duration: String(durationMinutes),
    source: dmnBookingConfig.source,
    first_name: customer.firstName,
    last_name: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    notes: buildDmnNotes(event, customer),
    return_url: returnUrl.toString(),
  });

  return `https://bookings.designmynight.com/book?${params.toString()}`;
}

function buildPaymentReturnPayload(params: URLSearchParams, session?: SessionWithEvent | null): BookingReturn {
  const reference =
    params.get("reference") ||
    params.get("booking_ref") ||
    params.get("booking_reference") ||
    params.get("bookingReference") ||
    params.get("ref") ||
    params.get("id") ||
    "Returned from DesignMyNight";

  return {
    reference,
    dmnReference: reference,
    status: params.get("status") || "complete",
    flow: "payment",
    success: true,
    firstName: params.get("first_name") || undefined,
    lastName: params.get("last_name") || undefined,
    email: params.get("email") || undefined,
  };
}

function createPaymentReturnMessage(params: URLSearchParams, session?: SessionWithEvent | null) {
  return {
    receivedAt: Date.now(),
    sessionId: params.get("session_id") || session?.id || null,
    eventId: params.get("event_id") || session?.event.id || null,
    date: params.get("date") || session?.date || null,
    time: params.get("time") || session?.time || null,
    guests: Number(params.get("guests") || 0),
    firstName: params.get("first_name") || null,
    bookingReturn: buildPaymentReturnPayload(params, session),
  };
}

function createPendingPaymentMessage(session: EventSession, customer: typeof defaultCustomer) {
  const params = new URLSearchParams();
  params.set("session_id", session.id);
  params.set("event_id", session.eventId);
  params.set("date", session.date);
  params.set("time", session.time);
  params.set("guests", String(customer.guests));
  params.set("first_name", customer.firstName);
  params.set("last_name", customer.lastName);
  params.set("email", customer.email);
  params.set("status", "complete");
  params.set("reference", "Returned from DesignMyNight");
  return createPaymentReturnMessage(params, session as SessionWithEvent);
}

function formatMoney(pence: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(pence / 100);
}

function arrivalGuidance() {
  return "At least 30 minutes before show time";
}

function normaliseFilterValue(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isInstantAvailability(result: AvailabilityResult) {
  const action = String(result.action ?? "").trim().toLowerCase();
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
    "api_error",
    "configuration_error",
    "invalid_request",
    "error",
  ]);

  if (enquiryActions.has(action)) return false;
  return result.available && result.valid !== false;
}

type PaymentReturnMessage = ReturnType<typeof createPaymentReturnMessage> & { createdAt?: number };

function findReturnSession(sessions: SessionWithEvent[], message: Partial<PaymentReturnMessage>) {
  const sessionId = message.sessionId ?? null;
  const eventId = message.eventId ?? null;
  const date = message.date ?? null;
  const time = message.time ?? null;

  return (
    (sessionId ? sessions.find((session) => session.id === sessionId) : null) ??
    (eventId && date && time
      ? sessions.find((session) => session.event.id === eventId && session.date === date && session.time === time)
      : null) ??
    (date && time ? sessions.find((session) => session.date === date && session.time === time) : null) ??
    null
  );
}

function requiresHostedDmnPayment(availabilityState: AvailabilityState, availabilityResult: AvailabilityResult | null, depositTotal: number) {
  if (availabilityState !== "available") return false;
  const hasLivePaymentFlags =
    typeof availabilityResult?.depositRequired === "boolean" ||
    typeof availabilityResult?.preordersAvailable === "boolean";

  if (hasLivePaymentFlags) {
    return availabilityResult?.depositRequired === true || availabilityResult?.preordersAvailable === true;
  }

  return depositTotal > 0;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T12:00:00`));
}

function formatLongDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function statusLabel(status: EventSession["status"]) {
  return {
    available: "Available",
    limited: "Limited",
    enquire: "Enquire",
    sold_out: "Sold out",
  }[status];
}

function statusClass(status: EventSession["status"]) {
  return {
    available: "text-emerald-100 border-emerald-300/25 bg-emerald-300/12",
    limited: "text-amber-100 border-amber-200/25 bg-amber-200/14",
    enquire: "text-sky-100 border-sky-200/25 bg-sky-200/14",
    sold_out: "text-white/55 border-white/10 bg-white/6",
  }[status];
}

function EmptyCalendarState() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <Atmosphere />
      <section className="relative mx-auto flex w-full max-w-[980px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <Header />
        <section className="liquid-panel empty-calendar-state" data-testid="section-empty-calendar">
          <div className="confirmed-icon failed">
            <CircleAlert size={24} />
          </div>
          <p className="eyebrow">Events Calendar</p>
          <h1>No events are currently available</h1>
          <p>
            There are no published event dates showing at the moment. Please check back shortly or contact
            {" "}<a href="mailto:info@purplepeacockncl.co.uk">info@purplepeacockncl.co.uk</a>.
          </p>
        </section>
      </section>
    </main>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isMobile;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={EventsCalendar} />
      <Route component={EventsCalendar} />
    </Switch>
  );
}

function ThemeShell() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
        <button
          data-testid="button-toggle-theme"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          className="theme-toggle glass-button"
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function EventsCalendar() {
  const { data, isLoading, error } = useQuery<CalendarResponse>({
    queryKey: ["calendar-data"],
    queryFn: loadCalendarData,
  });
  const isMobile = useIsMobile();
  const [selectedDate, setSelectedDate] = useState("2026-05-02");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState("show-nights");
  const [eventFilter, setEventFilter] = useState("all");
  const [monthIndex, setMonthIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [bookingStep, setBookingStep] = useState<BookingStep>("event");
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [customer, setCustomer] = useState(defaultCustomer);
  const [availabilityState, setAvailabilityState] = useState<AvailabilityState>("idle");
  const [availabilityResult, setAvailabilityResult] = useState<AvailabilityResult | null>(null);
  const [paymentFlowState, setPaymentFlowState] = useState<PaymentFlowState>("idle");
  const [bookingReturn, setBookingReturn] = useState<BookingReturn>(null);
  const [pendingPaymentSnapshot, setPendingPaymentSnapshot] = useState<PaymentReturnMessage | null>(null);

  const events = data?.events ?? [];
  const sessions: SessionWithEvent[] = useMemo(() => {
    const seen = new Set<string>();
    return events
      .flatMap((event) => event.sessions.map((session) => ({ ...session, event })))
      .filter((session) => {
        const key = `${session.event.id}-${session.date}-${session.time}-${session.displayTitle}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [events]);

  const eventOptions = useMemo(() => {
    return events
      .filter((event) => event.sessions.length)
      .map((event) => ({
        id: event.id,
        title: event.title,
        matchValues: [
          normaliseFilterValue(event.id),
          normaliseFilterValue(event.title),
          normaliseFilterValue(event.category),
          normaliseFilterValue(event.dmnBookingType),
        ].filter(Boolean),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [events]);

  useEffect(() => {
    if (!eventOptions.length) return;
    const params = new URLSearchParams(window.location.search);
    const requestedFilter = params.get("event") || params.get("filter") || params.get("type");
    if (!requestedFilter) return;
    const normalisedRequest = normaliseFilterValue(requestedFilter);
    const match = eventOptions.find((option) => option.matchValues.includes(normalisedRequest));
    if (match) setEventFilter(match.id);
  }, [eventOptions]);

  const filteredSessions = useMemo(() => {
    if (eventFilter === "all") return sessions;
    return sessions.filter((session) => session.event.id === eventFilter);
  }, [eventFilter, sessions]);

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0];
  const pendingPaymentSession =
    paymentFlowState === "awaiting" && pendingPaymentSnapshot
      ? findReturnSession(sessions, pendingPaymentSnapshot)
      : null;
  const selectedSession =
    pendingPaymentSession ??
    sessions.find((session) => session.id === selectedSessionId) ??
    filteredSessions.find((session) => session.id === selectedSessionId) ??
    filteredSessions.find((session) => session.date === selectedDate) ??
    filteredSessions[0] ??
    sessions[0];

  const monthOptions = useMemo(() => {
    const uniqueMonths = Array.from(
      new Set(filteredSessions.map((session) => session.date.slice(0, 7))),
    ).sort();

    return uniqueMonths.length
      ? uniqueMonths.map((month) => {
          const [year, monthNumber] = month.split("-").map(Number);
          const date = new Date(year, monthNumber - 1, 1, 12);
          return {
            key: month,
            date,
            label: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(date),
          };
        })
      : monthDates.map((date, index) => ({
          key: String(index),
          date,
          label: monthLabels[index],
        }));
  }, [filteredSessions]);

  const selectedDaySessions = useMemo(() => {
    return filteredSessions
      .filter((session) => session.date === selectedDate)
      .sort((a, b) => `${a.time}${a.event.title}`.localeCompare(`${b.time}${b.event.title}`));
  }, [selectedDate, filteredSessions]);

  const selectedEventDaySessions = useMemo(() => {
    return filteredSessions.filter((session) => session.event.id === selectedSession?.event.id && session.date === selectedDate);
  }, [selectedDate, selectedSession?.event.id, filteredSessions]);

  const selectedEventSessions = useMemo(() => {
    return filteredSessions
      .filter((session) => session.event.id === selectedSession?.event.id)
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [selectedSession?.event.id, filteredSessions]);

  const monthCells = useMemo(() => {
    const base = monthOptions[monthIndex]?.date ?? monthDates[0];
    const firstDay = new Date(base.getFullYear(), base.getMonth(), 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const cells: Array<{ key: string; day?: number; date?: string; count?: number }> = [];

    for (let i = 0; i < startOffset; i += 1) {
      cells.push({ key: `empty-${i}` });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = dateKey(new Date(base.getFullYear(), base.getMonth(), day, 12));
      cells.push({
        key: date,
        day,
        date,
        count: filteredSessions.filter((session) => session.date === date).length,
      });
    }

    return cells;
  }, [monthIndex, monthOptions, filteredSessions]);

  const visibleSessions = useMemo(() => {
    const base = monthOptions[monthIndex]?.date ?? monthDates[0];
    const prefix = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
    return filteredSessions.filter((session) => session.date.startsWith(prefix)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [monthIndex, monthOptions, filteredSessions]);

  useEffect(() => {
    if (!selectedSessionId && selectedDaySessions[0]) {
      setSelectedSessionId(selectedDaySessions[0].id);
      setSelectedEventId(selectedDaySessions[0].event.id);
    }
  }, [selectedDaySessions, selectedSessionId]);

  useEffect(() => {
    if (!filteredSessions.length) return;
    if (bookingStep === "confirmation" || paymentFlowState === "awaiting") return;
    const currentStillVisible = selectedSessionId && filteredSessions.some((session) => session.id === selectedSessionId);
    if (currentStillVisible) return;
    const firstSession = filteredSessions[0];
    setSelectedDate(firstSession.date);
    setSelectedSessionId(firstSession.id);
    setSelectedEventId(firstSession.event.id);
    setMonthIndex(0);
    setAvailabilityState("idle");
    setAvailabilityResult(null);
    setBookingStep("event");
  }, [bookingStep, eventFilter, filteredSessions, paymentFlowState, selectedSessionId]);

  function applyPaymentReturnMessage(message: PaymentReturnMessage) {
    const returnedSession = findReturnSession(sessions, message);
    const resolvedMessage: PaymentReturnMessage = returnedSession
      ? {
          ...message,
          sessionId: returnedSession.id,
          eventId: returnedSession.event.id,
          date: returnedSession.date,
          time: returnedSession.time,
        }
      : message;

    if (returnedSession) {
      setSelectedDate(returnedSession.date);
      setSelectedSessionId(returnedSession.id);
      setSelectedEventId(returnedSession.event.id);
      const matchingMonth = monthOptions.findIndex((month) => month.key === returnedSession.date.slice(0, 7));
      if (matchingMonth >= 0) setMonthIndex(matchingMonth);
    } else {
      if (message.sessionId) setSelectedSessionId(message.sessionId);
      if (message.eventId) setSelectedEventId(message.eventId);
      if (message.date) setSelectedDate(message.date);
    }

    if (resolvedMessage.guests > 0 || resolvedMessage.firstName) {
      setCustomer((current) => ({
        ...current,
        guests: resolvedMessage.guests > 0 ? resolvedMessage.guests : current.guests,
        firstName: resolvedMessage.firstName || current.firstName,
      }));
    }

    setBookingReturn(resolvedMessage.bookingReturn);
    setAvailabilityState("available");
    setPaymentFlowState("idle");
    setPendingPaymentSnapshot(null);
    setBookingStep("confirmation");
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("booking_return") !== "1" || !sessions.length) return;
    const returnId = params.get("return_id");
    let storedPending: PaymentReturnMessage | null = null;

    if (returnId) {
      try {
        const rawPending =
          window.sessionStorage.getItem(pendingPaymentKey(returnId)) ||
          window.localStorage.getItem(pendingPaymentKey(returnId)) ||
          window.sessionStorage.getItem(PAYMENT_PENDING_STORAGE_KEY) ||
          window.localStorage.getItem(PAYMENT_PENDING_STORAGE_KEY);
        storedPending = rawPending ? (JSON.parse(rawPending) as PaymentReturnMessage) : null;
      } catch {
        storedPending = null;
      }
    }

    const returnedSession = findReturnSession(sessions, {
      sessionId: params.get("session_id") || returnId || storedPending?.sessionId,
      eventId: params.get("event_id") || storedPending?.eventId,
      date: params.get("date") || storedPending?.date,
      time: params.get("time") || storedPending?.time,
    });
    const returnMessage = storedPending
      ? {
          ...storedPending,
          bookingReturn: buildPaymentReturnPayload(params, returnedSession),
        }
      : createPaymentReturnMessage(params, returnedSession);
    try {
      window.localStorage.setItem(PAYMENT_RETURN_STORAGE_KEY, JSON.stringify(returnMessage));
      if (returnId) {
        window.sessionStorage.removeItem(pendingPaymentKey(returnId));
        window.localStorage.removeItem(pendingPaymentKey(returnId));
      }
    } catch {
      // Storage can be blocked in some embedded contexts. The returned tab still confirms itself.
    }
    applyPaymentReturnMessage(returnMessage);

    const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }, [sessions, monthOptions]);

  useEffect(() => {
    function applyReturnMessage(rawValue: string | null) {
      if (!rawValue) return;
      try {
        const message = JSON.parse(rawValue) as PaymentReturnMessage;
        applyPaymentReturnMessage(message);
      } catch {
        // Ignore malformed storage events.
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key === PAYMENT_RETURN_STORAGE_KEY) {
        applyReturnMessage(event.newValue);
      }
    }

    window.addEventListener("storage", onStorage);

    if (paymentFlowState === "awaiting") {
      try {
        applyReturnMessage(window.localStorage.getItem(PAYMENT_RETURN_STORAGE_KEY));
      } catch {
        // Storage can be blocked in iframes; the returned tab will still display confirmation.
      }
    }

    return () => window.removeEventListener("storage", onStorage);
  }, [paymentFlowState, sessions, monthOptions]);

  useEffect(() => {
    if (!sessions.length) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("booking_return") === "1") return;

    try {
      const rawPending = window.sessionStorage.getItem(PAYMENT_PENDING_STORAGE_KEY) || window.localStorage.getItem(PAYMENT_PENDING_STORAGE_KEY);
      if (!rawPending) return;
      const pending = JSON.parse(rawPending) as PaymentReturnMessage;
      if (pending.createdAt && Date.now() - pending.createdAt > PAYMENT_PENDING_TTL_MS) return;
      const looksLikeDmnReturn = document.referrer.includes("designmynight.com");
      const urlHasFreshDmnFlag = params.get("dmn_return") === "1";
      if (!looksLikeDmnReturn && !urlHasFreshDmnFlag) return;

      applyPaymentReturnMessage(pending);
      window.sessionStorage.removeItem(PAYMENT_PENDING_STORAGE_KEY);
      window.localStorage.removeItem(PAYMENT_PENDING_STORAGE_KEY);
    } catch {
      // Ignore pending restore failures.
    }
  }, [sessions, monthOptions]);

  function selectDate(date: string) {
    setSelectedDate(date);
    const firstSession = sessions.find((session) => session.date === date);
    if (firstSession) {
      setSelectedSessionId(firstSession.id);
      setSelectedEventId(firstSession.event.id);
      setAvailabilityState("idle");
      setAvailabilityResult(null);
      setBookingStep("event");
    }
  }

  function selectSession(session: SessionWithEvent, openDetail = true) {
    setSelectedDate(session.date);
    setSelectedSessionId(session.id);
    setSelectedEventId(session.event.id);
    setAvailabilityState("idle");
    setAvailabilityResult(null);
    setPaymentFlowState("idle");
    setBookingStep("event");
    if (isMobile && openDetail) {
      setShowDetailModal(true);
    }
  }

  if (isLoading) return <LoadingState />;
  if (!sessions.length) return <EmptyCalendarState />;
  if (error || !data || !selectedEvent || !selectedSession) return <ErrorState />;

  const journey = (
    <BookingJourney
      event={selectedSession.event}
      session={selectedSession}
      sessions={selectedEventDaySessions.length ? selectedEventDaySessions : selectedDaySessions}
      eventSessions={selectedEventSessions}
      selectedDate={selectedDate}
      customer={customer}
      setCustomer={setCustomer}
      availabilityState={availabilityState}
      setAvailabilityState={setAvailabilityState}
      availabilityResult={availabilityResult}
      setAvailabilityResult={setAvailabilityResult}
      paymentFlowState={paymentFlowState}
      setPaymentFlowState={setPaymentFlowState}
      setPendingPaymentSnapshot={setPendingPaymentSnapshot}
      bookingReturn={bookingReturn}
      setBookingReturn={setBookingReturn}
      bookingStep={bookingStep}
      setBookingStep={setBookingStep}
      onSelectSession={(session) => selectSession(session, false)}
      onMenu={() => setModalMode("menu")}
      onHow={() => setModalMode("how")}
      onFaq={() => setModalMode("faq")}
      onGuide={() => setModalMode("guide")}
      onVideo={() => setModalMode("video")}
    />
  );

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <Atmosphere />
      <section className="relative mx-auto flex w-full max-w-[1480px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <Header />

        <section className="journey-hero">
          <div className="liquid-panel hero-copy compact-hero">
            <div className="space-y-4">
              <h1 data-testid="text-hero-title">Events Calendar</h1>
              <p data-testid="text-hero-copy">
                Choose your date, preview what’s on and continue through to secure booking with DesignMyNight.
              </p>
            </div>
            <div className="hero-points" aria-label="Booking highlights">
              <span><CalendarDays size={16} /> Choose a date</span>
              <span><UserRound size={16} /> Add your details</span>
              <span><ShieldCheck size={16} /> Secure payment</span>
            </div>
          </div>
        </section>

        <section className="engine-layout" aria-label="Purple Peacock booking widget">
          <section id="calendar" className="liquid-panel calendar-shell primary-calendar">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Events Calendar</p>
                <h2 data-testid="text-calendar-month">{monthOptions[monthIndex]?.label ?? monthLabels[0]}</h2>
              </div>
              <div className="month-controls">
                <button
                  data-testid="button-prev-month"
                  aria-label="Previous month"
                  className="glass-icon"
                  onClick={() => setMonthIndex((index) => Math.max(0, index - 1))}
                  disabled={monthIndex === 0}
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  data-testid="button-next-month"
                  aria-label="Next month"
                  className="glass-icon"
                  onClick={() => setMonthIndex((index) => Math.min(monthOptions.length - 1, index + 1))}
                  disabled={monthIndex === monthOptions.length - 1}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>

            <EventFilter
              value={eventFilter}
              options={eventOptions}
              onChange={(value) => {
                setEventFilter(value);
                setSelectedSessionId(null);
              }}
            />

            <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />

            {viewMode === "calendar" ? (
              <>
                <div className="weekday-row" aria-hidden="true">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
                <div className="calendar-grid">
                  {monthCells.map((cell) => (
                    <button
                      key={cell.key}
                      data-testid={cell.date ? `button-date-${cell.date}` : `cell-empty-${cell.key}`}
                      className={`calendar-day ${cell.date === selectedDate ? "is-selected" : ""} ${cell.count ? "has-events" : ""}`}
                      disabled={!cell.date}
                      onClick={() => cell.date && selectDate(cell.date)}
                    >
                      {cell.day && <span>{cell.day}</span>}
                      {!!cell.count && <small>{cell.count} show{cell.count > 1 ? "s" : ""}</small>}
                    </button>
                  ))}
                </div>
                <WhatOnDate
                  date={selectedDate}
                  sessions={selectedDaySessions}
                  selectedSession={selectedSession}
                  onSelectSession={selectSession}
                />
              </>
            ) : (
              <DateCardView sessions={visibleSessions} selectedSession={selectedSession} onSelectSession={selectSession} />
            )}
          </section>

          <aside className="desktop-journey" data-testid="panel-desktop-journey">
            {journey}
          </aside>
        </section>
      </section>

      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="mobile-booking-modal glass-modal border-white/15 bg-[#14091f]/92 text-white backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>{selectedSession.event.title}</DialogTitle>
            <DialogDescription className="text-white/66">
              {formatLongDate(selectedSession.date)} at {selectedSession.time}
            </DialogDescription>
          </DialogHeader>
          {journey}
        </DialogContent>
      </Dialog>

      <EventModal event={selectedSession.event} mode={modalMode} onOpenChange={(open) => !open && setModalMode(null)} />
    </main>
  );
}

function Header() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <header className="topbar liquid-panel">
      <div className="brand-lockup">
        <img src="./images/purple-peacock-logo-gold.jpg" alt="Purple Peacock" className="brand-logo" />
        <div>
          <strong>Purple Peacock</strong>
          <span>Newcastle show bar</span>
        </div>
      </div>
      <nav aria-label="Event calendar navigation">
        <a data-testid="link-return-website" href="https://www.purplepeacockncl.co.uk/">Return to website</a>
        <button data-testid="button-scroll-calendar" onClick={() => scrollTo("calendar")}>Calendar</button>
        <button data-testid="button-scroll-journey" onClick={() => scrollTo("journey-panel")}>Book</button>
      </nav>
    </header>
  );
}

function ViewToggle({ viewMode, setViewMode }: { viewMode: ViewMode; setViewMode: (mode: ViewMode) => void }) {
  return (
    <div className="view-toggle" aria-label="Calendar view options">
      <button
        data-testid="button-view-calendar"
        className={viewMode === "calendar" ? "active" : ""}
        onClick={() => setViewMode("calendar")}
      >
        Calendar view
      </button>
      <button
        data-testid="button-view-cards"
        className={viewMode === "cards" ? "active" : ""}
        onClick={() => setViewMode("cards")}
      >
        Cards by date
      </button>
    </div>
  );
}

function EventFilter({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; title: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="event-filter" data-testid="control-event-filter">
      <span>Filter events</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} data-testid="select-event-filter">
        <option value="all">All events</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.title}</option>
        ))}
      </select>
    </label>
  );
}

function WhatOnDate({
  date,
  sessions,
  selectedSession,
  onSelectSession,
}: {
  date: string;
  sessions: SessionWithEvent[];
  selectedSession: SessionWithEvent;
  onSelectSession: (session: SessionWithEvent) => void;
}) {
  return (
    <div className="day-stack">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">What’s on this date</p>
          <h3 data-testid="text-selected-date">{formatDate(date)}</h3>
        </div>
      </div>
      {sessions.length ? (
        sessions.map((session) => (
          <button
            key={session.id}
            data-testid={`button-session-${session.id}`}
            className={`session-pill ${selectedSession.id === session.id ? "is-active" : ""}`}
            onClick={() => onSelectSession(session)}
          >
            <span>
              <strong>{session.event.title}</strong>
              <small>{session.time} · {arrivalGuidance()}</small>
            </span>
            <span className={`status-chip ${statusClass(session.status)}`}>{statusLabel(session.status)}</span>
          </button>
        ))
      ) : (
        <div className="empty-card" data-testid="status-empty-date">
          <CircleAlert size={18} />
          <span>No shows on this date. Try a highlighted Friday, Saturday or seasonal date.</span>
        </div>
      )}
    </div>
  );
}

function DateCardView({
  sessions,
  selectedSession,
  onSelectSession,
}: {
  sessions: SessionWithEvent[];
  selectedSession: SessionWithEvent;
  onSelectSession: (session: SessionWithEvent) => void;
}) {
  const grouped = sessions.reduce<Record<string, SessionWithEvent[]>>((acc, session) => {
    acc[session.date] = [...(acc[session.date] ?? []), session];
    return acc;
  }, {});

  return (
    <div className="date-card-list" data-testid="section-card-view">
      {Object.entries(grouped).map(([date, daySessions]) => (
        <article key={date} className="date-group">
          <div className="date-group-heading">
            <CalendarDays size={17} />
            <strong>{formatLongDate(date)}</strong>
          </div>
          {daySessions.map((session) => (
            <button
              key={session.id}
              className={`date-event-card ${selectedSession.id === session.id ? "is-active" : ""}`}
              data-testid={`button-card-session-${session.id}`}
              onClick={() => onSelectSession(session)}
            >
              <img src={eventImage(session.event)} alt={`${session.event.title} preview`} />
              <span>
                <small>{session.time} · {arrivalGuidance()}</small>
                <strong>{session.event.title}</strong>
                <em>From {formatMoney(session.event.priceFromPence)} · Deposit {formatMoney(session.event.depositPence)}</em>
              </span>
              <span className={`status-chip ${statusClass(session.status)}`}>{statusLabel(session.status)}</span>
            </button>
          ))}
        </article>
      ))}
    </div>
  );
}

function BookingJourney({
  event,
  session,
  sessions,
  eventSessions,
  selectedDate,
  customer,
  setCustomer,
  availabilityState,
  setAvailabilityState,
  availabilityResult,
  setAvailabilityResult,
  paymentFlowState,
  setPaymentFlowState,
  setPendingPaymentSnapshot,
  bookingReturn,
  setBookingReturn,
  bookingStep,
  setBookingStep,
  onSelectSession,
  onMenu,
  onHow,
  onFaq,
  onGuide,
  onVideo,
}: {
  event: CalendarEvent;
  session: SessionWithEvent;
  sessions: SessionWithEvent[];
  eventSessions: SessionWithEvent[];
  selectedDate: string;
  customer: typeof defaultCustomer;
  setCustomer: (customer: typeof defaultCustomer) => void;
  availabilityState: AvailabilityState;
  setAvailabilityState: (state: AvailabilityState) => void;
  availabilityResult: AvailabilityResult | null;
  setAvailabilityResult: (result: AvailabilityResult | null) => void;
  paymentFlowState: PaymentFlowState;
  setPaymentFlowState: (state: PaymentFlowState) => void;
  setPendingPaymentSnapshot: (message: PaymentReturnMessage | null) => void;
  bookingReturn: BookingReturn;
  setBookingReturn: (bookingReturn: BookingReturn) => void;
  bookingStep: BookingStep;
  setBookingStep: (step: BookingStep) => void;
  onSelectSession: (session: SessionWithEvent) => void;
  onMenu: () => void;
  onHow: () => void;
  onFaq: () => void;
  onGuide: () => void;
  onVideo: () => void;
}) {
  const available = session.status !== "sold_out";
  const depositTotal = event.depositPence * customer.guests;
  const bookingRef = `PP-${session.date.replaceAll("-", "")}-${session.time.replace(":", "")}`;
  const selectedTicketChoice = event.secondaryTicketEnabled ? customer.ticketOption : "standard";

  return (
    <section id="journey-panel" className="journey-panel liquid-panel" data-testid="section-booking-journey">
      <img className="journey-image" src={eventImage(event)} alt={`${event.title} at Purple Peacock`} />
      <div className="journey-content">
        <div className="journey-topline">
          <Badge className={`status-chip ${statusClass(session.status)}`}>{statusLabel(session.status)}</Badge>
          <span>{formatLongDate(session.date)} · {session.time}</span>
        </div>
        <div>
          <p className="eyebrow">Selected show</p>
          <h2 data-testid="text-journey-title">{event.title}</h2>
          <p>{event.description}</p>
        </div>

        <div className="metric-row">
          <span><Package size={16} /> Pre-order available</span>
          <span><GlassWater size={16} /> Deposit {formatMoney(event.depositPence)} pp</span>
          <span><Clock size={16} /> {arrivalGuidance()}</span>
        </div>

        <div className={`ticket-options-grid ${event.secondaryTicketEnabled ? "has-premium" : ""}`} data-testid={`section-ticket-options-${event.id}`}>
          <button
            type="button"
            className={`ticket-option-card is-standard ${selectedTicketChoice === "standard" ? "is-selected" : ""}`}
            data-testid={`button-standard-ticket-${event.id}`}
            onClick={() => setCustomer({ ...customer, ticketOption: "standard" })}
          >
            <div className="ticket-option-main">
              <span><Ticket size={16} /> {event.standardTicketLabel || "Standard"}</span>
              <strong>{event.standardTicketPriceDisplay || formatMoney(event.priceFromPence)}</strong>
            </div>
            <p>{event.standardTicketDescription || "Standard show night ticket."}</p>
          </button>
          {event.secondaryTicketEnabled && (
            <button
              type="button"
              className={`ticket-option-card is-premium ${selectedTicketChoice === "premium" ? "is-selected" : ""}`}
              data-testid={`button-secondary-ticket-${event.id}`}
              onClick={() => setCustomer({ ...customer, ticketOption: "premium" })}
            >
              <div className="ticket-option-main">
                <span><Ticket size={16} /> {event.secondaryTicketLabel || "Premium"}</span>
                {event.secondaryTicketPriceDisplay && <strong>{event.secondaryTicketPriceDisplay}</strong>}
              </div>
              {event.secondaryTicketDescription && <p>{event.secondaryTicketDescription}</p>}
            </button>
          )}
        </div>

        <div className="action-row">
          <Button data-testid={`button-menu-${event.id}`} variant="outline" className="glass-action" onClick={onMenu}>
            <MenuIcon size={16} /> Menu
          </Button>
          <Button data-testid={`button-how-${event.id}`} variant="outline" className="glass-action" onClick={onHow}>
            <WandSparkles size={16} /> How to book
          </Button>
          <Button data-testid={`button-faq-${event.id}`} variant="outline" className="glass-action" onClick={onFaq}>
            <CircleAlert size={16} /> FAQs
          </Button>
          <Button data-testid={`button-preview-${event.id}`} variant="outline" className="glass-action" onClick={onVideo}>
            <Play size={16} /> Preview show
          </Button>
        </div>

        <StepTabs bookingStep={bookingStep} setBookingStep={setBookingStep} available={available} />

        {bookingStep === "event" && (
          <EventStep
            event={event}
            sessions={sessions}
            eventSessions={eventSessions}
            selectedDate={selectedDate}
            selectedSession={session}
            onSelectSession={onSelectSession}
            onContinue={() => {
              setAvailabilityState("idle");
              setAvailabilityResult(null);
              setBookingStep("availability");
            }}
          />
        )}

        {bookingStep === "availability" && (
          <AvailabilityStep
            customer={customer}
            setCustomer={setCustomer}
            session={session}
            event={event}
            availabilityState={availabilityState}
            setAvailabilityState={setAvailabilityState}
            availabilityResult={availabilityResult}
            setAvailabilityResult={setAvailabilityResult}
            onBack={() => setBookingStep("event")}
            onContinue={() => setBookingStep("details")}
          />
        )}

        {bookingStep === "details" && (
          <DetailsStep
            customer={customer}
            setCustomer={setCustomer}
            onBack={() => setBookingStep("availability")}
            onContinue={() => setBookingStep("transfer")}
          />
        )}

        {bookingStep === "transfer" && (
          <TransferStep
            event={event}
            session={session}
            customer={customer}
            depositTotal={depositTotal}
            availabilityResult={availabilityResult}
            availabilityState={availabilityState}
            paymentFlowState={paymentFlowState}
            setPaymentFlowState={setPaymentFlowState}
            setPendingPaymentSnapshot={setPendingPaymentSnapshot}
            setBookingReturn={setBookingReturn}
            onBack={() => setBookingStep("details")}
            onComplete={() => setBookingStep("confirmation")}
          />
        )}

        {bookingStep === "confirmation" && (
          <ConfirmationStep
            event={event}
            session={session}
            customer={customer}
            bookingRef={bookingRef}
            bookingReturn={bookingReturn}
            availabilityState={availabilityState}
            depositTotal={depositTotal}
            onMenu={onMenu}
            onFaq={onFaq}
            onHow={onHow}
            onGuide={onGuide}
            onNewBooking={() => {
              setCustomer(defaultCustomer);
              setAvailabilityState("idle");
              setAvailabilityResult(null);
              setPaymentFlowState("idle");
              setPendingPaymentSnapshot(null);
              setBookingReturn(null);
              setBookingStep("event");
            }}
          />
        )}
      </div>
    </section>
  );
}

function StepTabs({
  bookingStep,
  setBookingStep,
  available,
}: {
  bookingStep: BookingStep;
  setBookingStep: (step: BookingStep) => void;
  available: boolean;
}) {
  const steps: Array<{ id: BookingStep; label: string }> = [
    { id: "event", label: "Show" },
    { id: "availability", label: "Availability" },
    { id: "details", label: "Details" },
    { id: "transfer", label: "Payment" },
    { id: "confirmation", label: "Welcome" },
  ];
  const currentIndex = steps.findIndex((step) => step.id === bookingStep);

  return (
    <div className="step-tabs" aria-label="Booking progress">
      {steps.map((step, index) => (
        <button
          key={step.id}
          data-testid={`button-step-${step.id}`}
          className={bookingStep === step.id ? "active" : ""}
          onClick={() => available && index <= currentIndex && setBookingStep(step.id)}
          disabled={!available || index > currentIndex}
        >
          <span>{index + 1}</span>{step.label}
        </button>
      ))}
    </div>
  );
}

function EventStep({
  event,
  sessions,
  eventSessions,
  selectedDate,
  selectedSession,
  onSelectSession,
  onContinue,
}: {
  event: CalendarEvent;
  sessions: SessionWithEvent[];
  eventSessions: SessionWithEvent[];
  selectedDate: string;
  selectedSession: SessionWithEvent;
  onSelectSession: (session: SessionWithEvent) => void;
  onContinue: () => void;
}) {
  return (
    <div className="booking-step">
      <div className="date-change-row">
        <div>
          <p className="eyebrow">Selected date and time</p>
          <h3>{formatDate(selectedDate)}</h3>
        </div>
      </div>
      <div className="mini-session-list">
        {sessions.map((candidate) => (
          <button
            key={candidate.id}
            className={selectedSession.id === candidate.id ? "active" : ""}
            onClick={() => onSelectSession(candidate)}
            data-testid={`button-change-session-${candidate.id}`}
          >
            <strong>{formatDate(candidate.date)}</strong>
            <span>{candidate.time}</span>
            <em>{statusLabel(candidate.status)}</em>
          </button>
        ))}
      </div>
      <Button
        data-testid="button-check-availability"
        className="book-button wide"
        onClick={onContinue}
        disabled={selectedSession.status === "sold_out"}
      >
        Check availability
      </Button>
      {eventSessions.length > sessions.length && (
        <div className="other-date-panel">
          <p className="eyebrow">Other dates for this event</p>
          <div className="mini-session-list compact">
            {eventSessions
              .filter((candidate) => candidate.date !== selectedDate)
              .map((candidate) => (
                <button
                  key={candidate.id}
                  onClick={() => onSelectSession(candidate)}
                  data-testid={`button-other-date-${candidate.id}`}
                >
                  <strong>{formatDate(candidate.date)}</strong>
                  <span>{candidate.time}</span>
                  <em>{statusLabel(candidate.status)}</em>
                </button>
              ))}
          </div>
        </div>
      )}
      <ul className="inclusion-list">
        {event.inclusions.map((item) => (
          <li key={item}><Check size={14} /> {item}</li>
        ))}
      </ul>
    </div>
  );
}

function AvailabilityStep({
  customer,
  setCustomer,
  session,
  event,
  availabilityState,
  setAvailabilityState,
  availabilityResult,
  setAvailabilityResult,
  onBack,
  onContinue,
}: {
  customer: typeof defaultCustomer;
  setCustomer: (customer: typeof defaultCustomer) => void;
  session: SessionWithEvent;
  event: CalendarEvent;
  availabilityState: AvailabilityState;
  setAvailabilityState: (state: AvailabilityState) => void;
  availabilityResult: AvailabilityResult | null;
  setAvailabilityResult: (result: AvailabilityResult | null) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const hasChecked = availabilityState === "available" || availabilityState === "enquiry" || availabilityState === "error";
  const isChecking = availabilityState === "checking";
  const hasGuests = customer.guests > 0;
  const isInstantConfirmation = availabilityState === "available";
  const canContinue = availabilityState === "available" || availabilityState === "enquiry" || availabilityState === "error";
  const enquiryMessage =
    "We won’t be able to instantly confirm this booking, but our sales team will contact you regarding your enquiry.";

  async function checkAvailability() {
    if (!hasGuests) return;
    setAvailabilityState("checking");
    setAvailabilityResult(null);

    try {
      const response = await apiRequest("POST", "/api/dmn/availability", {
        type: session.dmnBookingTypeId,
        num_people: customer.guests,
        date: session.date,
        time: session.time,
        durationMinutes: getDmnDurationMinutes(session),
      });
      const result = (await response.json()) as AvailabilityResult;
      setAvailabilityResult(result);
      setAvailabilityState(isInstantAvailability(result) ? "available" : "enquiry");
    } catch (error) {
      setAvailabilityResult({
        available: false,
        valid: false,
        action: "error",
        message: enquiryMessage,
      });
      setAvailabilityState("error");
    }
  }

  return (
    <div className="booking-step">
      <label className="form-field">
        <span>Guests</span>
        <select
          data-testid="select-guests"
          value={customer.guests}
          onChange={(event) => {
            setCustomer({ ...customer, guests: Number(event.target.value) });
            setAvailabilityState("idle");
            setAvailabilityResult(null);
          }}
        >
          <option value={0}>Select guests</option>
          {Array.from({ length: 18 }, (_, index) => index + 2).map((guestCount) => (
            <option key={guestCount} value={guestCount}>{guestCount} guests</option>
          ))}
        </select>
      </label>
      {hasChecked ? (
        <div className={`availability-result ${isInstantConfirmation ? "" : "pending"}`} data-testid="status-availability">
          {isInstantConfirmation ? <ShieldCheck size={20} /> : <CircleAlert size={20} />}
          <div>
            <strong>{isInstantConfirmation ? availabilityResult?.message ?? "Availability confirmed." : enquiryMessage}</strong>
            <p>
              Selected: {event.title}, {formatLongDate(session.date)}, {session.time}.
            </p>
            {!!availabilityResult?.suggestedTimes?.filter((suggestion) => suggestion.time).length && (
              <p>
                Suggested times: {availabilityResult.suggestedTimes.filter((suggestion) => suggestion.time).slice(0, 4).map((suggestion) => suggestion.time).join(", ")}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="availability-result pending" data-testid="status-availability-pending">
          {isChecking ? <Loader2 className="animate-spin" size={20} /> : <ShieldCheck size={20} />}
          <div>
            <strong>{isChecking ? "Checking live availability..." : hasGuests ? "Ready to check this slot." : "Select your guest count first."}</strong>
            <p>{isChecking ? "We’re checking this booking type, date, time and party size with DesignMyNight." : hasGuests ? "We’ll confirm this slot before taking your contact details." : "Availability is checked against the number of guests in your party."}</p>
          </div>
        </div>
      )}
      <div className="button-pair">
        <Button data-testid="button-back-event" variant="outline" className="glass-action" onClick={onBack}>Back</Button>
        {!hasChecked ? (
          <Button data-testid="button-run-availability" className="book-button" disabled={!hasGuests || isChecking} onClick={checkAvailability}>
            {isChecking ? "Checking..." : "Check availability"}
          </Button>
        ) : (
          <Button data-testid="button-continue-details" className="book-button" disabled={!canContinue} onClick={onContinue}>
            {isInstantConfirmation ? "Continue to details" : "Continue enquiry"}
          </Button>
        )}
      </div>
    </div>
  );
}

function DetailsStep({
  customer,
  setCustomer,
  onBack,
  onContinue,
}: {
  customer: typeof defaultCustomer;
  setCustomer: (customer: typeof defaultCustomer) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const canContinue = customer.firstName && customer.lastName && customer.email && customer.phone;

  return (
    <div className="booking-step">
      <div className="form-grid">
        <label className="form-field">
          <span>First name</span>
          <input data-testid="input-first-name" value={customer.firstName} onChange={(event) => setCustomer({ ...customer, firstName: event.target.value })} placeholder="Sophie" />
        </label>
        <label className="form-field">
          <span>Last name</span>
          <input data-testid="input-last-name" value={customer.lastName} onChange={(event) => setCustomer({ ...customer, lastName: event.target.value })} placeholder="Taylor" />
        </label>
        <label className="form-field">
          <span>Email</span>
          <input data-testid="input-email" value={customer.email} onChange={(event) => setCustomer({ ...customer, email: event.target.value })} placeholder="name@email.com" />
        </label>
        <label className="form-field">
          <span>Phone</span>
          <input data-testid="input-phone" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} placeholder="07..." />
        </label>
      </div>
      <label className="form-field">
        <span>Occasion or notes</span>
        <textarea data-testid="textarea-notes" value={customer.notes} onChange={(event) => setCustomer({ ...customer, notes: event.target.value })} placeholder="Birthday, hen party, dietary notes..." />
      </label>
      <div className="button-pair">
        <Button data-testid="button-back-availability" variant="outline" className="glass-action" onClick={onBack}>Back</Button>
        <Button data-testid="button-go-payment" className="book-button" disabled={!canContinue} onClick={onContinue}>Go to secure payment</Button>
      </div>
    </div>
  );
}

function TransferStep({
  event,
  session,
  customer,
  depositTotal,
  availabilityResult,
  availabilityState,
  paymentFlowState,
  setPaymentFlowState,
  setPendingPaymentSnapshot,
  setBookingReturn,
  onBack,
  onComplete,
}: {
  event: CalendarEvent;
  session: SessionWithEvent;
  customer: typeof defaultCustomer;
  depositTotal: number;
  availabilityResult: AvailabilityResult | null;
  availabilityState: AvailabilityState;
  paymentFlowState: PaymentFlowState;
  setPaymentFlowState: (state: PaymentFlowState) => void;
  setPendingPaymentSnapshot: (message: PaymentReturnMessage | null) => void;
  setBookingReturn: (bookingReturn: BookingReturn) => void;
  onBack: () => void;
  onComplete: () => void;
}) {
  const paymentUrl = buildDmnHandoffUrl(session, event, customer);
  const isEnquiryFlow = availabilityState !== "available";
  const needsHostedPayment = requiresHostedDmnPayment(availabilityState, availabilityResult, depositTotal);
  const isDirectConfirmFlow = !isEnquiryFlow && !needsHostedPayment;
  const isBusy = paymentFlowState === "awaiting" || paymentFlowState === "redirecting" || paymentFlowState === "submitting-enquiry";

  async function submitBookingRequest(flow: "direct" | "enquiry") {
    setPaymentFlowState("submitting-enquiry");
    try {
      const response = await apiRequest("POST", "/api/dmn/booking", {
        type: session.dmnBookingTypeId,
        num_people: customer.guests,
        date: session.date,
        time: session.time,
        duration: getDmnDurationMinutes(session),
        first_name: customer.firstName,
        last_name: customer.lastName,
        email: customer.email,
        phone: customer.phone,
        notes: buildDmnNotes(event, customer),
        event_title: event.title,
        session_id: session.id,
      });
      const result = await response.json();
      if (!result.success) {
        console.warn("DMN enquiry submission issue", result);
        setBookingReturn({
          reference: "Not submitted",
          status: "failed",
          flow,
          success: false,
          errorMessage: result.message || (flow === "direct" ? "We were unable to confirm this booking." : "We were unable to make this enquiry."),
          technicalError: false,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
        });
        setPaymentFlowState("idle");
        onComplete();
        return;
      }
      setBookingReturn({
        reference: result.reference || (flow === "direct" ? "Booking received" : "Enquiry received"),
        dmnReference: result.dmnReference || result.reference || undefined,
        status: result.status || (flow === "direct" ? "confirmed" : "enquiry"),
        flow,
        success: true,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
      });
      setPaymentFlowState("idle");
      onComplete();
    } catch (error) {
      console.warn("DMN enquiry request failed before response", error);
      setBookingReturn({
        reference: "Not submitted",
        status: "failed",
        flow,
        success: false,
        errorMessage:
          flow === "direct"
            ? "We were unable to confirm this booking due to a technical issue. Please try again. If the problem persists, contact info@purplepeacockncl.co.uk."
            : "We were unable to submit this enquiry due to a technical issue. Please try again. If the problem persists, contact info@purplepeacockncl.co.uk.",
        technicalError: true,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
      });
      setPaymentFlowState("idle");
      onComplete();
    }
  }

  return (
    <div className="booking-step transfer-screen" data-testid="screen-dmn-transfer">
      <div className="transfer-orb">
        <Loader2 className="animate-spin" size={34} />
      </div>
      <h3>
        {paymentFlowState === "awaiting"
          ? "Awaiting payment confirmation..."
          : isEnquiryFlow
            ? "Submit your enquiry"
            : isDirectConfirmFlow
              ? "Confirm your booking"
              : "Transfer to secure payment"}
      </h3>
      <p data-testid="status-transfer">
        {paymentFlowState === "awaiting"
            ? "Please complete the DesignMyNight payment window. Keep this page open and it will confirm once you return."
          : isEnquiryFlow
            ? "This booking will be sent as an enquiry and our sales team will contact you regarding availability."
            : isDirectConfirmFlow
              ? `${customer.firstName || "Guest"}, your booking details are ready. Confirm below and we’ll add the booking to DesignMyNight.`
              : `${customer.firstName || "Guest"}, your booking details are prepared. Continue to DesignMyNight to complete the secure payment or pre-order step.`}
      </p>
      <div className="payment-summary">
        <span>{event.title}</span>
        <strong>{formatLongDate(session.date)} · {session.time}</strong>
        <span>
          {customer.guests} guests · {getSelectedTicketOption(event, customer.ticketOption).label} ticket
          {needsHostedPayment ? ` · Deposit ${formatMoney(depositTotal)}` : " · No online payment required"}
        </span>
      </div>
      <div className="button-pair">
        <Button data-testid="button-back-details" variant="outline" className="glass-action" onClick={onBack} disabled={isBusy}>Back</Button>
        <Button
          data-testid="button-open-dmn-payment"
          className="book-button"
          disabled={isBusy}
          onClick={() => {
            if (isEnquiryFlow) {
              void submitBookingRequest("enquiry");
              return;
            }
            if (isDirectConfirmFlow) {
              void submitBookingRequest("direct");
              return;
            }
            setPaymentFlowState("redirecting");
            const pendingMessage = {
              ...createPendingPaymentMessage(session, customer),
              createdAt: Date.now(),
            };
            setPendingPaymentSnapshot(pendingMessage);
            try {
              window.sessionStorage.setItem(PAYMENT_PENDING_STORAGE_KEY, JSON.stringify(pendingMessage));
              window.localStorage.setItem(PAYMENT_PENDING_STORAGE_KEY, JSON.stringify(pendingMessage));
              window.sessionStorage.setItem(pendingPaymentKey(session.id), JSON.stringify(pendingMessage));
              window.localStorage.setItem(pendingPaymentKey(session.id), JSON.stringify(pendingMessage));
            } catch {
              // Storage can be restricted in embedded contexts; the explicit return URL still carries details where available.
            }
            window.location.assign(paymentUrl);
          }}
        >
          {paymentFlowState === "submitting-enquiry"
            ? isDirectConfirmFlow
              ? "Confirming booking..."
              : "Submitting enquiry..."
            : paymentFlowState === "awaiting"
              ? "Awaiting payment..."
              : isEnquiryFlow
                ? "Submit enquiry"
                : isDirectConfirmFlow
                  ? "Confirm booking"
                  : "Continue to secure payment"}
        </Button>
      </div>
    </div>
  );
}

function ConfirmationStep({
  event,
  session,
  customer,
  bookingRef,
  bookingReturn,
  availabilityState,
  depositTotal,
  onMenu,
  onFaq,
  onHow,
  onGuide,
  onNewBooking,
}: {
  event: CalendarEvent;
  session: SessionWithEvent;
  customer: typeof defaultCustomer;
  bookingRef: string;
  bookingReturn: BookingReturn;
  availabilityState: AvailabilityState;
  depositTotal: number;
  onMenu: () => void;
  onFaq: () => void;
  onHow: () => void;
  onGuide: () => void;
  onNewBooking: () => void;
}) {
  const reference = bookingReturn?.dmnReference || bookingReturn?.reference || bookingRef;
  const isFailed = bookingReturn?.success === false || bookingReturn?.status === "failed";
  const isEnquiry = bookingReturn?.flow === "enquiry" || availabilityState !== "available" || bookingReturn?.status === "enquiry";
  const isDirectBooking = bookingReturn?.flow === "direct";
  const failureMessage =
    bookingReturn?.errorMessage ||
    "We were unable to make this enquiry. Please try again. If the problem persists, contact info@purplepeacockncl.co.uk.";

  return (
    <div className="booking-step confirmation-screen" data-testid="section-confirmation">
      <div className={`confirmed-icon ${isFailed ? "failed" : ""}`}>{isFailed ? <CircleAlert size={24} /> : <Check size={24} />}</div>
      <p className="eyebrow">{isFailed ? "Unable to complete booking" : isEnquiry ? "Enquiry received" : isDirectBooking ? "Booking confirmed" : "Returned from DesignMyNight"}</p>
      <h3>
        {isFailed
          ? "Unable to complete booking"
          : `${isEnquiry ? "Enquiry received" : "Booking received"}, ${bookingReturn?.firstName || customer.firstName || "guest"}`}
      </h3>
      <div className="booking-receipt">
        <p><strong>Reference</strong><span>{reference}</span></p>
        <p><strong>Show</strong><span>{event.title}</span></p>
        <p><strong>Date</strong><span>{formatLongDate(session.date)} at {session.time}</span></p>
        <p><strong>Guests</strong><span>{customer.guests}</span></p>
        <p>
          <strong>{isFailed ? "Reason" : isEnquiry ? "Status" : "Deposit paid"}</strong>
          <span>{isFailed ? failureMessage : isEnquiry ? "Sales team follow-up" : depositTotal > 0 ? formatMoney(depositTotal) : "No online payment required"}</span>
        </p>
      </div>
      {isFailed ? (
        <div className="failure-panel">
          <CircleAlert size={18} />
          <p>
            Please try another date or time. If you believe this should be available, contact
            {" "}<a href="mailto:info@purplepeacockncl.co.uk">info@purplepeacockncl.co.uk</a>.
          </p>
        </div>
      ) : (
        <div className="welcome-grid">
          <InfoTile icon={<ReceiptText size={18} />} title="How to book" copy="Review arrival, payment and booking notes." onClick={onHow} />
          <InfoTile icon={<MenuIcon size={18} />} title="Menus" copy="View food, drinks and package menus." onClick={onMenu} />
          <InfoTile icon={<CircleAlert size={18} />} title="FAQs" copy="Dress code, deposits, arrival and accessibility." onClick={onFaq} />
        </div>
      )}
      <div className="button-pair">
        <Button variant="outline" className="glass-action" onClick={onNewBooking}>New booking</Button>
        <Button className="book-button" data-testid="button-download-welcome" disabled={isFailed || !event.welcomeGuideUrl} onClick={onGuide}>
          <Download size={16} /> Welcome guide
        </Button>
      </div>
    </div>
  );
}

function InfoTile({ icon, title, copy, onClick }: { icon: ReactNode; title: string; copy: string; onClick?: () => void }) {
  return (
    <button type="button" className="info-tile" onClick={onClick}>
      {icon}
      <strong>{title}</strong>
      <p>{copy}</p>
    </button>
  );
}

type TemplateContent = {
  title?: string;
  subtitle?: string;
  sections?: Array<Record<string, unknown>>;
  faqs?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
  menus?: Array<Record<string, unknown>>;
};

function normaliseTemplateContent(value: unknown): TemplateContent {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as TemplateContent;
    } catch {
      return { sections: [{ heading: "Information", text: value }] };
    }
  }
  if (typeof value === "object") return value as TemplateContent;
  return {};
}

function getTemplateSections(content: TemplateContent, fallback: Array<{ heading: string; text: string }>) {
  const sections = content.sections ?? content.faqs ?? content.items ?? [];
  const mapped = sections
    .map((section) => ({
      heading: String(section.heading ?? section.title ?? section.question ?? "").trim(),
      text: String(section.text ?? section.answer ?? section.description ?? "").trim(),
    }))
    .filter((section) => section.heading && section.text);

  return mapped.length ? mapped : fallback;
}

function cleanExternalUrl(value: unknown) {
  const url = String(value ?? "").trim();
  if (!url || url === "#") return "";
  return url;
}

function getEventMenuLinks(event: CalendarEvent, menuTemplate: TemplateContent) {
  const templateLinks = [...(menuTemplate.links ?? []), ...(menuTemplate.menus ?? []), ...(menuTemplate.sections ?? [])]
    .map((link) => ({
      label: String(link.label ?? link.title ?? link.heading ?? "").trim(),
      url: cleanExternalUrl(link.url ?? link.file_url ?? link.link),
      description: String(link.description ?? link.text ?? "").trim(),
    }))
    .filter((link) => link.label && link.url);

  if (templateLinks.length) return templateLinks;

  if (event.menuLinks?.length) {
    return event.menuLinks
      .map((link) => ({
        label: link.label,
        url: cleanExternalUrl(link.url),
        description: link.description ?? "",
      }))
      .filter((link) => link.label && link.url);
  }

  return event.menuUrl
    ? [{ label: "Food menu", url: event.menuUrl, description: "Open the latest menu in a new tab." }]
    : [];
}

function menuIcon(label: string) {
  const normalised = label.toLowerCase();
  if (normalised.includes("drink") || normalised.includes("cocktail") || normalised.includes("bar")) return <GlassWater />;
  if (normalised.includes("package") || normalised.includes("vip") || normalised.includes("upgrade")) return <Package />;
  return <MenuIcon />;
}

function isImageMenu(url: string) {
  return /\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/i.test(url);
}

function isDirectVideo(url: string) {
  return /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url);
}

type MenuLink = ReturnType<typeof getEventMenuLinks>[number];

function EventModal({
  event,
  mode,
  onOpenChange,
}: {
  event: CalendarEvent;
  mode: ModalMode;
  onOpenChange: (open: boolean) => void;
}) {
  const open = mode !== null;
  const [activeMenu, setActiveMenu] = useState<MenuLink | null>(null);
  const [videoStarted, setVideoStarted] = useState(false);
  const howTemplate = normaliseTemplateContent(event.howToBookTemplate?.content);
  const faqTemplate = normaliseTemplateContent(event.faqTemplate?.content);
  const menuTemplate = normaliseTemplateContent(event.menuTemplate?.content);
  const menuLinks = getEventMenuLinks(event, menuTemplate);
  const title =
    mode === "menu"
      ? "Menus"
      : mode === "how"
        ? howTemplate.title || "How to book"
        : mode === "faq"
          ? faqTemplate.title || "FAQs"
          : mode === "guide"
            ? "Welcome guide"
            : `Preview ${event.title}`;
  const subtitle =
    mode === "how"
      ? howTemplate.subtitle || "Everything you need to know before you arrive."
      : mode === "faq"
        ? faqTemplate.subtitle || "Quick answers before you book."
        : mode === "menu"
          ? menuTemplate.subtitle || "Choose a menu to view in a new tab."
          : mode === "guide"
            ? "Everything you need for your visit."
            : "Event information for your selected booking.";

  useEffect(() => {
    if (mode !== "menu" || !open) setActiveMenu(null);
  }, [mode, open, event.id]);

  useEffect(() => {
    if (mode !== "video" || !open) setVideoStarted(false);
  }, [mode, open, event.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-modal border-white/15 bg-[#14091f]/88 text-white backdrop-blur-2xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle data-testid="text-modal-title">{title}</DialogTitle>
          <DialogDescription className="text-white/66">
            {subtitle}
          </DialogDescription>
        </DialogHeader>

        {mode === "menu" && (
          <div data-testid="modal-menu">
            {activeMenu ? (
              <div className="menu-viewer">
                <div className="menu-viewer-bar">
                  <button type="button" className="glass-action menu-back-button" onClick={() => setActiveMenu(null)}>
                    Back to menus
                  </button>
                  <a href={activeMenu.url} target="_blank" rel="noreferrer">Open full screen</a>
                </div>
                <div className="menu-embed-shell">
                  {isImageMenu(activeMenu.url) ? (
                    <img src={activeMenu.url} alt={activeMenu.label} />
                  ) : (
                    <iframe title={activeMenu.label} src={activeMenu.url} />
                  )}
                </div>
              </div>
            ) : (
              <div className="modal-grid menu-choice-grid">
                {menuLinks.length ? menuLinks.map((link) => (
                  <button
                    key={`${link.label}-${link.url}`}
                    type="button"
                    className="menu-card menu-link-card"
                    onClick={() => setActiveMenu(link)}
                  >
                    {menuIcon(link.label)}
                    <strong>{link.label}</strong>
                    <p>{link.description || "View this menu."}</p>
                  </button>
                )) : (
                  <div className="menu-card">
                    <MenuIcon />
                    <strong>Menus coming soon</strong>
                    <p>Food, drink and package menus will appear here once they have been added in the CMS.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {mode === "guide" && (
          <div className="menu-viewer" data-testid="modal-welcome-guide">
            {event.welcomeGuideUrl ? (
              <>
                <div className="menu-viewer-bar">
                  <span>Welcome guide</span>
                  <a href={event.welcomeGuideUrl} target="_blank" rel="noreferrer">Open full screen</a>
                </div>
                <div className="menu-embed-shell">
                  {isImageMenu(event.welcomeGuideUrl) ? (
                    <img src={event.welcomeGuideUrl} alt={`${event.title} welcome guide`} />
                  ) : (
                    <iframe title={`${event.title} welcome guide`} src={event.welcomeGuideUrl} />
                  )}
                </div>
              </>
            ) : (
              <div className="menu-card">
                <ReceiptText />
                <strong>Welcome guide coming soon</strong>
                <p>The guide will appear here once it has been added in the CMS.</p>
              </div>
            )}
          </div>
        )}

        {mode === "how" && (
          <div className="how-list" data-testid="modal-how-it-works">
            {getTemplateSections(howTemplate, [
              { heading: "Choose your date", text: "Pick a date from the calendar and choose what’s on." },
              { heading: "Check availability", text: "Enter your guest number and we’ll check the booking route." },
              { heading: "Complete securely", text: "Bookings transfer to DesignMyNight for secure payment or pre-order." },
              { heading: "Keep your details", text: "Return to this page for your booking information, menus and FAQs." },
            ]).map((item, index) => (
              <div key={`${item.heading}-${index}`} className="how-step">
                <span>{index + 1}</span>
                <div>
                  <strong>{item.heading}</strong>
                  <p>{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {mode === "faq" && (
          <div className="faq-accordion" data-testid="modal-faq">
            {getTemplateSections(faqTemplate, [
              { heading: "What time should I arrive?", text: "Please arrive at the time shown on your booking so the team can seat you smoothly." },
              { heading: "Do I need to pay a deposit?", text: "Deposits are shown during booking and completed securely through DesignMyNight where required." },
              { heading: "Can I view menus before booking?", text: "Yes, use the Menus button to view food, drinks and package options." },
            ]).map((item, index) => (
              <details key={`${item.heading}-${index}`} className="faq-item">
                <summary>{item.heading}</summary>
                <p>{item.text}</p>
              </details>
            ))}
          </div>
        )}

        {mode === "video" && (
          <div className="video-shell" data-testid="modal-video">
            {event.videoUrl && videoStarted ? (
              isDirectVideo(event.videoUrl) ? (
                <video
                  src={event.videoUrl}
                  controls
                  playsInline
                  autoPlay
                  controlsList="nodownload"
                  poster={eventImage(event)}
                />
              ) : (
                <iframe
                  title={`${event.title} video preview`}
                  src={event.videoUrl}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              )
            ) : (
              <div className="video-placeholder">
                <img src={eventImage(event)} alt={`${event.title} preview placeholder`} />
                <div className="video-placeholder-copy">
                  {event.videoUrl ? (
                    <button type="button" className="play-ring video-play-button" onClick={() => setVideoStarted(true)} aria-label={`Play ${event.title} preview`}>
                      <Play size={22} />
                    </button>
                  ) : (
                    <span className="play-ring"><Play size={22} /></span>
                  )}
                  <strong>{event.videoUrl ? "Click play" : "Preview coming soon"}</strong>
                  <p>{event.videoUrl ? "Click play and take a sneak peek of what you're about to experience!" : "A show preview will appear here when available for this event."}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Atmosphere() {
  return (
    <div className="atmosphere" aria-hidden="true">
      <div className="orb orb-one" />
      <div className="orb orb-two" />
      <div className="orb orb-three" />
      <div className="stage-line" />
    </div>
  );
}

function LoadingState() {
  return (
    <main className="loading-screen">
      <Atmosphere />
      <div className="liquid-panel loading-card" data-testid="status-loading">
        <Sparkles />
        <h1>Preparing the show calendar</h1>
        <div className="skeleton-line" />
        <div className="skeleton-line short" />
      </div>
    </main>
  );
}

function ErrorState() {
  return (
    <main className="loading-screen">
      <div className="liquid-panel loading-card" data-testid="status-error">
        <CircleAlert />
        <h1>Calendar unavailable</h1>
        <p>We couldn’t load the events calendar. Please refresh the page or try again shortly.</p>
      </div>
    </main>
  );
}

function App() {
  return <ThemeShell />;
}

export default App;
