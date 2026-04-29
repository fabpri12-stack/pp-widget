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
type ModalMode = "menu" | "how" | "video" | null;
type ViewMode = "calendar" | "cards";
type BookingStep = "event" | "availability" | "details" | "transfer" | "confirmation";
type AvailabilityState = "idle" | "checking" | "available" | "enquiry" | "error";
type PaymentFlowState = "idle" | "redirecting" | "awaiting" | "submitting-enquiry";
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
  status: string;
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
};

const dmnBookingConfig = {
  venueGroupId: "6141cde2ccb4d7565902c433",
  venueId: "6214cfdb21d4111e033a9433",
  source: "NovaAI",
};

const DRUNCH_BOOKING_TYPE_ID = "65ae86770e1da03dc56bbfc2";
const PAYMENT_RETURN_STORAGE_KEY = "purple-peacock-dmn-return";

function getDmnDurationMinutes(session: EventSession) {
  if (session.dmnBookingTypeId === DRUNCH_BOOKING_TYPE_ID) return 120;
  if (!Number.isFinite(session.durationMinutes) || session.durationMinutes <= 0) return 120;
  return session.durationMinutes;
}

function buildDmnHandoffUrl(session: EventSession, customer: typeof defaultCustomer) {
  const durationMinutes = getDmnDurationMinutes(session);
  const returnUrl = new URL(window.location.href);
  returnUrl.search = "";
  returnUrl.hash = "";
  returnUrl.searchParams.set("booking_return", "1");
  returnUrl.searchParams.set("event_id", session.eventId);
  returnUrl.searchParams.set("session_id", session.id);
  returnUrl.searchParams.set("date", session.date);
  returnUrl.searchParams.set("time", session.time);

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
    return_url: returnUrl.toString(),
  });

  return `https://bookings.designmynight.com/book?${params.toString()}`;
}

function buildPaymentReturnPayload(params: URLSearchParams, session?: SessionWithEvent | null): BookingReturn {
  return {
    reference: params.get("reference") || params.get("booking_ref") || params.get("booking_reference") || "Returned from DesignMyNight",
    status: params.get("status") || "complete",
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
    bookingReturn: buildPaymentReturnPayload(params, session),
  };
}

function formatMoney(pence: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(pence / 100);
}

function isInstantAvailability(result: AvailabilityResult) {
  return result.available && (!result.action || result.action === "accept" || result.action === "book");
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
  const [monthIndex, setMonthIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [bookingStep, setBookingStep] = useState<BookingStep>("event");
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [customer, setCustomer] = useState(defaultCustomer);
  const [availabilityState, setAvailabilityState] = useState<AvailabilityState>("idle");
  const [availabilityResult, setAvailabilityResult] = useState<AvailabilityResult | null>(null);
  const [paymentFlowState, setPaymentFlowState] = useState<PaymentFlowState>("idle");
  const [bookingReturn, setBookingReturn] = useState<BookingReturn>(null);

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

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0];
  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ??
    sessions.find((session) => session.date === selectedDate) ??
    sessions[0];

  const monthOptions = useMemo(() => {
    const uniqueMonths = Array.from(
      new Set(sessions.map((session) => session.date.slice(0, 7))),
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
  }, [sessions]);

  const selectedDaySessions = useMemo(() => {
    return sessions
      .filter((session) => session.date === selectedDate)
      .sort((a, b) => `${a.time}${a.event.title}`.localeCompare(`${b.time}${b.event.title}`));
  }, [selectedDate, sessions]);

  const selectedEventDaySessions = useMemo(() => {
    return sessions.filter((session) => session.event.id === selectedSession?.event.id && session.date === selectedDate);
  }, [selectedDate, selectedSession?.event.id, sessions]);

  const selectedEventSessions = useMemo(() => {
    return sessions
      .filter((session) => session.event.id === selectedSession?.event.id)
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [selectedSession?.event.id, sessions]);

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
        count: sessions.filter((session) => session.date === date).length,
      });
    }

    return cells;
  }, [monthIndex, monthOptions, sessions]);

  const visibleSessions = useMemo(() => {
    const base = monthOptions[monthIndex]?.date ?? monthDates[0];
    const prefix = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
    return sessions.filter((session) => session.date.startsWith(prefix)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [monthIndex, monthOptions, sessions]);

  useEffect(() => {
    if (!selectedSessionId && selectedDaySessions[0]) {
      setSelectedSessionId(selectedDaySessions[0].id);
      setSelectedEventId(selectedDaySessions[0].event.id);
    }
  }, [selectedDaySessions, selectedSessionId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("booking_return") !== "1" || !sessions.length) return;

    const returnedSession =
      sessions.find((session) => session.id === params.get("session_id")) ??
      sessions.find((session) => session.event.id === params.get("event_id") && session.date === params.get("date") && session.time === params.get("time")) ??
      selectedSession;

    if (returnedSession) {
      setSelectedDate(returnedSession.date);
      setSelectedSessionId(returnedSession.id);
      setSelectedEventId(returnedSession.event.id);
    }

    const returnMessage = createPaymentReturnMessage(params, returnedSession);
    try {
      window.localStorage.setItem(PAYMENT_RETURN_STORAGE_KEY, JSON.stringify(returnMessage));
    } catch {
      // Storage can be blocked in some embedded contexts. The returned tab still confirms itself.
    }

    setBookingReturn(returnMessage.bookingReturn);
    setPaymentFlowState("idle");
    setBookingStep("confirmation");

    const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, document.title, cleanUrl);

    if (window.opener && !window.opener.closed) {
      setTimeout(() => window.close(), 700);
    }
  }, [sessions, selectedSession]);

  useEffect(() => {
    function applyReturnMessage(rawValue: string | null) {
      if (!rawValue) return;
      try {
        const message = JSON.parse(rawValue) as ReturnType<typeof createPaymentReturnMessage>;
        if (message.sessionId) setSelectedSessionId(message.sessionId);
        if (message.eventId) setSelectedEventId(message.eventId);
        if (message.date) setSelectedDate(message.date);
        setBookingReturn(message.bookingReturn);
        setPaymentFlowState("idle");
        setBookingStep("confirmation");
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
  }, [paymentFlowState]);

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
      bookingReturn={bookingReturn}
      setBookingReturn={setBookingReturn}
      bookingStep={bookingStep}
      setBookingStep={setBookingStep}
      onSelectSession={(session) => selectSession(session, false)}
      onMenu={() => {
        if (selectedSession.event.menuUrl) {
          window.open(selectedSession.event.menuUrl, "_blank", "noopener,noreferrer");
          return;
        }
        setModalMode("menu");
      }}
      onHow={() => setModalMode("how")}
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
        <svg aria-label="Purple Peacock mark" viewBox="0 0 64 64" className="brand-mark">
          <path d="M32 8C18 26 16 43 32 58C48 43 46 26 32 8Z" fill="none" stroke="currentColor" strokeWidth="4" />
          <circle cx="32" cy="31" r="7" fill="currentColor" />
          <path d="M20 36C26 34 30 37 32 43C34 37 38 34 44 36" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div>
          <strong>Purple Peacock</strong>
          <span>Newcastle show bar</span>
        </div>
      </div>
      <nav aria-label="Event calendar navigation">
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
              <small>{session.time} · {session.doors}</small>
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
                <small>{session.time} · {session.doors}</small>
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
  bookingReturn,
  setBookingReturn,
  bookingStep,
  setBookingStep,
  onSelectSession,
  onMenu,
  onHow,
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
  bookingReturn: BookingReturn;
  setBookingReturn: (bookingReturn: BookingReturn) => void;
  bookingStep: BookingStep;
  setBookingStep: (step: BookingStep) => void;
  onSelectSession: (session: SessionWithEvent) => void;
  onMenu: () => void;
  onHow: () => void;
  onVideo: () => void;
}) {
  const available = session.status !== "sold_out";
  const depositTotal = event.depositPence * customer.guests;
  const bookingRef = `PP-${session.date.replaceAll("-", "")}-${session.time.replace(":", "")}`;

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
          <span><Ticket size={16} /> From {formatMoney(event.priceFromPence)}</span>
          <span><GlassWater size={16} /> Deposit {formatMoney(event.depositPence)} pp</span>
          <span><Clock size={16} /> {session.doors}</span>
        </div>

        <div className="action-row">
          <Button data-testid={`button-menu-${event.id}`} variant="outline" className="glass-action" onClick={onMenu}>
            <MenuIcon size={16} /> Menu
          </Button>
          <Button data-testid={`button-how-${event.id}`} variant="outline" className="glass-action" onClick={onHow}>
            <WandSparkles size={16} /> How it works
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
            availabilityState={availabilityState}
            paymentFlowState={paymentFlowState}
            setPaymentFlowState={setPaymentFlowState}
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
            onNewBooking={() => {
              setCustomer(defaultCustomer);
              setAvailabilityState("idle");
              setAvailabilityResult(null);
              setPaymentFlowState("idle");
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
      {eventSessions.length > sessions.length && (
        <div className="other-date-panel">
          <p className="eyebrow">Other dates for this event</p>
          <div className="mini-session-list compact">
            {eventSessions
              .filter((candidate) => candidate.date !== selectedDate)
              .slice(0, 8)
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
      <Button
        data-testid="button-check-availability"
        className="book-button wide"
        onClick={onContinue}
        disabled={selectedSession.status === "sold_out"}
      >
        Check availability
      </Button>
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
              Selected: {event.title}, {formatLongDate(session.date)}, {session.time}. We’ll pass your details through so the team can follow up if instant confirmation is not available.
            </p>
            {!!availabilityResult?.suggestedTimes?.length && (
              <p>
                Suggested times: {availabilityResult.suggestedTimes.slice(0, 4).map((suggestion) => suggestion.time).join(", ")}
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
  availabilityState,
  paymentFlowState,
  setPaymentFlowState,
  setBookingReturn,
  onBack,
  onComplete,
}: {
  event: CalendarEvent;
  session: SessionWithEvent;
  customer: typeof defaultCustomer;
  depositTotal: number;
  availabilityState: AvailabilityState;
  paymentFlowState: PaymentFlowState;
  setPaymentFlowState: (state: PaymentFlowState) => void;
  setBookingReturn: (bookingReturn: BookingReturn) => void;
  onBack: () => void;
  onComplete: () => void;
}) {
  const paymentUrl = buildDmnHandoffUrl(session, customer);
  const isEnquiryFlow = availabilityState !== "available";
  const isBusy = paymentFlowState === "awaiting" || paymentFlowState === "redirecting" || paymentFlowState === "submitting-enquiry";

  async function submitEnquiry() {
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
        notes: customer.notes,
        event_title: event.title,
        session_id: session.id,
      });
      const result = await response.json();
      if (!result.success) {
        console.warn("DMN enquiry submission issue", result);
        setBookingReturn({
          reference: "Not submitted",
          status: "failed",
          success: false,
          errorMessage: result.message || "We were unable to make this enquiry.",
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
        reference: result.reference || "Enquiry received",
        status: result.status || "enquiry",
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
        success: false,
        errorMessage: "We were unable to submit this enquiry due to a technical issue. Please try again. If the problem persists, contact info@purplepeacockncl.co.uk.",
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
            : "Transfer to secure payment"}
      </h3>
      <p data-testid="status-transfer">
        {paymentFlowState === "awaiting"
          ? "Please complete the DesignMyNight payment window. This page will confirm once you return."
          : isEnquiryFlow
            ? "This booking will be sent as an enquiry and our sales team will contact you regarding availability."
            : `${customer.firstName || "Guest"}, your booking details are prepared. Continue to DesignMyNight to complete the secure payment or pre-order step.`}
      </p>
      <div className="payment-summary">
        <span>{event.title}</span>
        <strong>{formatLongDate(session.date)} · {session.time}</strong>
        <span>{customer.guests} guests · Deposit {formatMoney(depositTotal)}</span>
      </div>
      <div className="button-pair">
        <Button data-testid="button-back-details" variant="outline" className="glass-action" onClick={onBack} disabled={isBusy}>Back</Button>
        <Button
          data-testid="button-open-dmn-payment"
          className="book-button"
          disabled={isBusy}
          onClick={() => {
            if (isEnquiryFlow) {
              void submitEnquiry();
              return;
            }
            setPaymentFlowState("awaiting");
            const paymentWindow = window.open(paymentUrl, "_blank", "noopener,noreferrer");
            if (!paymentWindow) {
              window.location.href = paymentUrl;
            }
          }}
        >
          {paymentFlowState === "submitting-enquiry"
            ? "Submitting enquiry..."
            : paymentFlowState === "awaiting"
              ? "Awaiting payment..."
              : isEnquiryFlow
                ? "Submit enquiry"
                : "Open secure payment"}
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
  onNewBooking,
}: {
  event: CalendarEvent;
  session: SessionWithEvent;
  customer: typeof defaultCustomer;
  bookingRef: string;
  bookingReturn: BookingReturn;
  availabilityState: AvailabilityState;
  depositTotal: number;
  onNewBooking: () => void;
}) {
  const reference = bookingReturn?.reference || bookingRef;
  const isFailed = bookingReturn?.success === false || bookingReturn?.status === "failed";
  const isEnquiry = availabilityState !== "available" || bookingReturn?.status === "enquiry";
  const failureMessage =
    bookingReturn?.errorMessage ||
    "We were unable to make this enquiry. Please try again. If the problem persists, contact info@purplepeacockncl.co.uk.";

  return (
    <div className="booking-step confirmation-screen" data-testid="section-confirmation">
      <div className={`confirmed-icon ${isFailed ? "failed" : ""}`}>{isFailed ? <CircleAlert size={24} /> : <Check size={24} />}</div>
      <p className="eyebrow">{isFailed ? "Unable to make enquiry" : isEnquiry ? "Enquiry received" : "Returned from DesignMyNight"}</p>
      <h3>
        {isFailed
          ? "Unable to make enquiry"
          : `${isEnquiry ? "Enquiry received" : "Booking received"}, ${bookingReturn?.firstName || customer.firstName || "guest"}`}
      </h3>
      <div className="booking-receipt">
        <p><strong>Reference</strong><span>{reference}</span></p>
        <p><strong>Show</strong><span>{event.title}</span></p>
        <p><strong>Date</strong><span>{formatLongDate(session.date)} at {session.time}</span></p>
        <p><strong>Guests</strong><span>{customer.guests}</span></p>
        <p>
          <strong>{isFailed ? "Reason" : isEnquiry ? "Status" : "Deposit paid"}</strong>
          <span>{isFailed ? failureMessage : isEnquiry ? "Sales team follow-up" : formatMoney(depositTotal)}</span>
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
          <InfoTile icon={<ReceiptText size={18} />} title="What to expect" copy="Arrive on time, check in with the host and keep your booking reference handy." />
          <InfoTile icon={<MenuIcon size={18} />} title="Menus" copy="Pre-orders and menus can sit here dynamically based on show type." />
          <InfoTile icon={<CircleAlert size={18} />} title="FAQs" copy="Dress code, deposits, arrival, accessibility and table notes can be templated here." />
        </div>
      )}
      <div className="button-pair">
        <Button variant="outline" className="glass-action" onClick={onNewBooking}>New booking</Button>
        <Button className="book-button" data-testid="button-download-welcome" disabled={isFailed}>
          <Download size={16} /> Download welcome PDF
        </Button>
      </div>
    </div>
  );
}

function InfoTile({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return (
    <div className="info-tile">
      {icon}
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  );
}

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
  const title =
    mode === "menu" ? `${event.title} menu` : mode === "how" ? "How the booking works" : `Preview ${event.title}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-modal border-white/15 bg-[#14091f]/88 text-white backdrop-blur-2xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle data-testid="text-modal-title">{title}</DialogTitle>
          <DialogDescription className="text-white/66">
            Event information for your selected booking.
          </DialogDescription>
        </DialogHeader>

        {mode === "menu" && (
          <div className="modal-grid" data-testid="modal-menu">
            <div className="menu-card">
              <GlassWater />
              <strong>Menus</strong>
              <p>
                Menu information will be shown here when no menu link has been added for this event.
              </p>
            </div>
            <div className="menu-card">
              <Ticket />
              <strong>Deposit clarity</strong>
              <p>Deposits and balances are shown before the user leaves for DesignMyNight payment.</p>
            </div>
          </div>
        )}

        {mode === "how" && (
          <div className="how-list" data-testid="modal-how-it-works">
            {[
              "Pick a date from the calendar.",
              "Choose what’s on that date.",
              "Check availability and enter contact details.",
              "Transfer to DesignMyNight for secure payment only.",
              "Return to a branded welcome page with booking details and info.",
            ].map((item, index) => (
              <div key={item} className="how-step">
                <span>{index + 1}</span>
                <p>{item}</p>
              </div>
            ))}
          </div>
        )}

        {mode === "video" && (
          <div className="video-shell" data-testid="modal-video">
            {event.videoUrl ? (
              <iframe
                title={`${event.title} video preview`}
                src={event.videoUrl}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div className="video-placeholder">
                <img src={eventImage(event)} alt={`${event.title} preview placeholder`} />
                <div className="video-placeholder-copy">
                  <span className="play-ring"><Play size={22} /></span>
                  <strong>Preview coming soon</strong>
                  <p>A show preview will appear here when available for this event.</p>
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
