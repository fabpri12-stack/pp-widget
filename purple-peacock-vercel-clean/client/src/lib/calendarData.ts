import { createClient } from "@supabase/supabase-js";
import type { CalendarEvent, CalendarResponse, EventSession } from "@shared/schema";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const useSupabaseRpc = import.meta.env.VITE_USE_SUPABASE_RPC === "true";

type EventSeriesRow = {
  id: string;
  title: string;
  slug?: string | null;
  status?: string | null;
  category?: string | null;
  theme?: string | null;
  theme_name?: string | null;
  strapline?: string | null;
  short_description?: string | null;
  description?: string | null;
  full_description?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  menu_url?: string | null;
  how_it_works_url?: string | null;
  dmn_booking_type_id?: string | null;
  price_display?: string | null;
  default_price_display?: string | null;
  deposit_display?: string | null;
  fallback_profile?: string | null;
  run_start?: string | null;
  run_end?: string | null;
  inclusions?: string[] | string | null;
};

type BookingTypeRow = {
  id: string;
  dmn_booking_type_id?: string | null;
  name?: string | null;
  category?: string | null;
  default_price_display?: string | null;
  active?: boolean | null;
};

type ScheduleRuleTime =
  | string
  | {
      time?: string | null;
      start_time?: string | null;
      event_time?: string | null;
      selected_time?: string | null;
      label?: string | null;
      value?: string | null;
    };

type ScheduleRuleRow = {
  id: string;
  event_series_id: string;
  rule_type?: string | null;
  selected_dates?: string[] | string | null;
  weekdays?: number[] | string | null;
  times?: ScheduleRuleTime[] | string | null;
  excluded_dates?: string[] | string | null;
  duration_minutes?: number | null;
  doors?: string | null;
  status?: string | null;
};

type InstanceRow = {
  id?: string | null;
  event_series_id?: string | null;
  event_id?: string | null;
  date?: string | null;
  event_date?: string | null;
  event_time?: string | null;
  start_time?: string | null;
  time?: string | null;
  selected_time?: string | null;
  duration_minutes?: number | null;
  doors?: string | null;
  status?: string | null;
  dmn_booking_type_id?: string | null;
};

function toArray<T>(value: T[] | string | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean) as T[];
  }
}

function normaliseScheduleTimes(value: ScheduleRuleRow["times"]): string[] {
  const parsed = toArray<ScheduleRuleTime>(value);
  const times = parsed
    .map((item) => {
      if (typeof item === "string") return normaliseTime(item);
      return normaliseTime(
        item.event_time ??
        item.time ??
        item.start_time ??
        item.selected_time ??
        item.value ??
        item.label ??
        null,
      );
    })
    .filter(Boolean);

  return Array.from(new Set(times));
}

function inferTone(category?: string | null, title?: string | null): CalendarEvent["imageTone"] {
  const value = `${category ?? ""} ${title ?? ""}`.toLowerCase();
  if (value.includes("christmas") || value.includes("grinch")) return "christmas";
  if (value.includes("drunch") || value.includes("bottomless")) return "drunch";
  return "show";
}

function parseMoneyToPence(value?: string | null, fallback = 0) {
  if (!value) return fallback;
  const match = String(value).match(/[\d]+(?:\.\d{1,2})?/);
  if (!match) return fallback;
  return Math.round(Number(match[0]) * 100);
}

function normaliseTime(value?: string | null) {
  if (!value) return "19:00";
  const match = String(value).match(/\d{1,2}:\d{2}/);
  return match ? match[0].padStart(5, "0") : value;
}

function addDays(date: Date, days: number) {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + days);
  return clone;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildDmnUrl(input: {
  bookingTypeId: string;
  date: string;
  time: string;
  duration: number;
}) {
  const params = new URLSearchParams({
    venue_group: "6141cde2ccb4d7565902c433",
    venue_id: "6214cfdb21d4111e033a9433",
    type: input.bookingTypeId,
    num_people: "2",
    date: input.date,
    time: input.time,
    duration: String(input.duration),
    source: "NovaAI",
    return_url: "https://www.purplepeacockncl.co.uk/thank_you_nova",
  });

  return `https://bookings.designmynight.com/book?${params.toString()}`;
}

function mapStatus(status?: string | null): EventSession["status"] {
  if (status === "sold_out") return "sold_out";
  if (status === "limited") return "limited";
  if (status === "enquire") return "enquire";
  return "available";
}

function mapAction(status: EventSession["status"]): EventSession["action"] {
  if (status === "sold_out") return "reject";
  if (status === "enquire") return "enquire";
  return "accept";
}

function createSession(input: {
  event: EventSeriesRow;
  bookingType?: BookingTypeRow;
  date: string;
  time: string;
  duration: number;
  doors?: string | null;
  status?: string | null;
  suffix: string;
  scheduleRuleId?: string | null;
}): EventSession {
  const dmnBookingTypeId =
    input.bookingType?.dmn_booking_type_id ??
    input.event.dmn_booking_type_id ??
    input.bookingType?.id ??
    "";
  const status = mapStatus(input.status);
  const time = normaliseTime(input.time);

  return {
    id: `${input.event.id}-${input.scheduleRuleId ?? "schedule"}-${input.date}-${time.replace(":", "")}-${input.suffix}`,
    eventId: input.event.id,
    displayTitle: input.event.theme_name ?? input.event.theme ?? input.event.title,
    displaySubtitle: input.event.short_description ?? input.event.description ?? "",
    themeName: input.event.theme_name ?? input.event.theme ?? null,
    dmnBookingTypeId,
    dmnBookingTypeName: input.bookingType?.name ?? input.event.title,
    date: input.date,
    time,
    durationMinutes: input.duration,
    doors: input.doors ?? "Doors before showtime",
    status,
    action: mapAction(status),
    remaining: status === "sold_out" ? 0 : 20,
    dmnUrl: buildDmnUrl({
      bookingTypeId: dmnBookingTypeId,
      date: input.date,
      time,
      duration: input.duration,
    }),
  };
}

function sessionsFromScheduleRules(
  events: EventSeriesRow[],
  scheduleRules: ScheduleRuleRow[],
  bookingTypes: BookingTypeRow[],
): Record<string, EventSession[]> {
  const byEvent: Record<string, EventSession[]> = {};
  const today = new Date();
  const rangeStart = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  const rangeEnd = addDays(rangeStart, 420);

  for (const event of events) {
    const eventRules = scheduleRules.filter((rule) => rule.event_series_id === event.id);
    const bookingType = bookingTypes.find((type) => type.id === event.dmn_booking_type_id || type.dmn_booking_type_id === event.dmn_booking_type_id);
    byEvent[event.id] = [];

    for (const rule of eventRules) {
      const times = normaliseScheduleTimes(rule.times);
      const sessionTimes = times.length ? times : ["19:00"];
      const excludedDates = new Set(toArray<string>(rule.excluded_dates));
      const duration = rule.duration_minutes ?? 120;

      if (rule.rule_type === "weekly") {
        const weekdays = toArray<number>(rule.weekdays).map(Number);
        for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor = addDays(cursor, 1)) {
          const jsDay = cursor.getDay();
          const mondayFirstDay = jsDay === 0 ? 7 : jsDay;
          if (!weekdays.includes(jsDay) && !weekdays.includes(mondayFirstDay)) continue;
          const date = isoDate(cursor);
          if (excludedDates.has(date)) continue;
          sessionTimes.forEach((time, index) => {
            byEvent[event.id].push(createSession({ event, bookingType, date, time, duration, doors: rule.doors, status: rule.status, suffix: `weekly-${index}`, scheduleRuleId: rule.id }));
          });
        }
      } else {
        const dates = toArray<string>(rule.selected_dates);
        dates.forEach((date) => {
          if (excludedDates.has(date)) return;
          sessionTimes.forEach((time, index) => {
            byEvent[event.id].push(createSession({ event, bookingType, date, time, duration, doors: rule.doors, status: rule.status, suffix: `dates-${index}`, scheduleRuleId: rule.id }));
          });
        });
      }
    }
  }

  return byEvent;
}

function mapEvents(
  events: EventSeriesRow[],
  sessionsByEvent: Record<string, EventSession[]>,
): CalendarEvent[] {
  return events
    .map((event) => {
      const sessions = (sessionsByEvent[event.id] ?? []).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
      const runStart = sessions[0]?.date ?? new Date().toISOString().slice(0, 10);
      const runEnd = sessions[sessions.length - 1]?.date ?? runStart;
      const description = event.full_description ?? event.description ?? event.short_description ?? "Purple Peacock event.";

      return {
        id: event.id,
        title: event.title,
        category: event.category ?? "Purple Peacock",
        strapline: event.strapline ?? event.short_description ?? event.title,
        shortDescription: event.short_description ?? description,
        description,
        imageTone: inferTone(event.category, event.title),
        imageUrl: event.image_url ?? null,
        videoUrl: event.video_url ?? null,
        menuUrl: event.menu_url ?? null,
        howItWorksUrl: event.how_it_works_url ?? null,
        dmnBookingType: event.dmn_booking_type_id ?? "",
        priceFromPence: parseMoneyToPence(event.price_display ?? event.default_price_display, 2995),
        depositPence: parseMoneyToPence(event.deposit_display, event.category?.toLowerCase().includes("drunch") ? 2000 : 1000),
        runStart,
        runEnd,
        inclusions: toArray<string>(event.inclusions).length
          ? toArray<string>(event.inclusions)
          : ["Reserved table", "Immersive entertainment", "DMN secure payment"],
        sessions,
      };
    })
    .filter((event) => event.sessions.length > 0);
}

async function loadFallbackCalendar(): Promise<CalendarResponse> {
  const response = await fetch("/calendar.json");
  if (!response.ok) {
    throw new Error("Unable to load calendar data");
  }
  return response.json();
}

export async function loadCalendarData(): Promise<CalendarResponse> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return loadFallbackCalendar();
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const [{ data: eventRows, error: eventError }, { data: bookingTypeRows }, { data: scheduleRows }] = await Promise.all([
    supabase.from("event_series").select("*").eq("status", "published"),
    supabase.from("booking_types").select("*"),
    supabase.from("schedule_rules").select("*"),
  ]);

  if (eventError || !eventRows?.length) {
    return loadFallbackCalendar();
  }

  let sessionsByEvent = sessionsFromScheduleRules(
    eventRows as EventSeriesRow[],
    (scheduleRows ?? []) as ScheduleRuleRow[],
    (bookingTypeRows ?? []) as BookingTypeRow[],
  );

  try {
    if (!useSupabaseRpc) {
      throw new Error("RPC disabled; using schedule data directly");
    }

    const from = new Date();
    const to = addDays(from, 420);
    const { data: instanceRows, error: instanceError } = await supabase.rpc("get_event_instances", {
      p_from: isoDate(from),
      p_to: isoDate(to),
    });

    if (!instanceError && Array.isArray(instanceRows) && instanceRows.length) {
      sessionsByEvent = {};
      const bookingTypes = (bookingTypeRows ?? []) as BookingTypeRow[];
      const events = eventRows as EventSeriesRow[];
      for (const row of instanceRows as InstanceRow[]) {
        const eventId = row.event_series_id ?? row.event_id;
        const event = events.find((candidate) => candidate.id === eventId);
        if (!event || !row.date && !row.event_date) continue;
        const bookingType = bookingTypes.find((type) => type.id === event.dmn_booking_type_id || type.dmn_booking_type_id === (row.dmn_booking_type_id ?? event.dmn_booking_type_id));
        const date = row.date ?? row.event_date ?? "";
        sessionsByEvent[event.id] = [
          ...(sessionsByEvent[event.id] ?? []),
          createSession({
            event,
            bookingType,
            date,
            time: row.event_time ?? row.time ?? row.start_time ?? row.selected_time ?? "19:00",
            duration: row.duration_minutes ?? 120,
            doors: row.doors,
            status: row.status,
            suffix: row.id ?? "rpc",
            scheduleRuleId: row.id,
          }),
        ];
      }
    }
  } catch {
    // If the RPC signature differs during setup, schedule data still provides a working first pass.
  }

  const events = mapEvents(eventRows as EventSeriesRow[], sessionsByEvent);
  if (!events.length) return loadFallbackCalendar();

  return {
    events,
    integration: {
      mode: "designmynight-ready",
      paymentHandoffRequired: true,
      notes: [
        "Loaded from Supabase events, schedules and booking types.",
        "DesignMyNight remains the secure payment and pre-order step.",
      ],
    },
  };
}
