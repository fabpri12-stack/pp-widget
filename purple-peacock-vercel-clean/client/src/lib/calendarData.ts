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
  welcome_guide_url?: string | null;
  welcome_pdf_url?: string | null;
  what_to_expect_pdf_url?: string | null;
  guide_url?: string | null;
  menu_url?: string | null;
  drinks_menu_url?: string | null;
  drink_menu_url?: string | null;
  food_menu_url?: string | null;
  packages_url?: string | null;
  package_url?: string | null;
  menu_links?: unknown;
  menus?: unknown;
  how_it_works_url?: string | null;
  welcome_template_id?: string | null;
  how_it_works_template_id?: string | null;
  how_to_book_template_id?: string | null;
  faq_template_id?: string | null;
  menu_template_id?: string | null;
  dmn_booking_type_id?: string | null;
  price_display?: string | null;
  default_price_display?: string | null;
  deposit_display?: string | null;
  fallback_profile?: string | null;
  run_start?: string | null;
  run_end?: string | null;
  inclusions?: string[] | string | null;
};

type TemplateRow = {
  id: string;
  type?: string | null;
  name?: string | null;
  content_json?: unknown;
  active?: boolean | null;
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
      status?: string | null;
      availability_status?: string | null;
    };

type ScheduleRuleRow = {
  id: string;
  event_series_id: string;
  rule_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
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

function toArray<T>(value: T[] | string | null | undefined | unknown): T[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value !== "string") return [];
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

function toRecord(value: unknown): Record<string, any> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function cleanUrl(value?: string | null) {
  const url = String(value ?? "").trim();
  if (!url || url === "#") return null;
  return url;
}

function normaliseTemplate(template?: TemplateRow | null) {
  if (!template) return null;
  return {
    id: template.id,
    type: template.type ?? undefined,
    name: template.name ?? undefined,
    content: template.content_json ?? null,
  };
}

function findTemplate(templates: TemplateRow[], id?: string | null, fallbackTypes: string[] = []) {
  if (id) {
    const byId = templates.find((template) => template.id === id);
    if (byId) return byId;
  }

  return templates.find((template) => {
    const type = String(template.type ?? "").trim().toLowerCase();
    return fallbackTypes.includes(type);
  }) ?? null;
}

function menuLinksFromTemplate(template?: TemplateRow | null) {
  const content = toRecord(template?.content_json);
  const links = toArray<any>(content?.links ?? content?.menus ?? content?.sections);

  return links
    .map((item) => {
      if (typeof item === "string") return null;
      const label = String(item?.label ?? item?.title ?? item?.heading ?? "").trim();
      const url = cleanUrl(item?.url ?? item?.file_url ?? item?.link);
      const description = String(item?.description ?? item?.text ?? "").trim();
      if (!label || !url) return null;
      return { label, url, description: description || null };
    })
    .filter(Boolean) as Array<{ label: string; url: string; description: string | null }>;
}

function buildMenuLinks(event: EventSeriesRow, menuTemplate?: TemplateRow | null) {
  const templateLinks = menuLinksFromTemplate(menuTemplate);
  if (templateLinks.length) return templateLinks;

  const structuredLinks = toArray<any>(event.menu_links ?? event.menus);
  const mappedLinks = structuredLinks
    .map((item) => {
      if (typeof item === "string") return null;
      const label = String(item?.label ?? item?.title ?? "").trim();
      const url = cleanUrl(item?.url ?? item?.file_url ?? item?.link);
      const description = String(item?.description ?? item?.text ?? "").trim();
      if (!label || !url) return null;
      return { label, url, description: description || null };
    })
    .filter(Boolean) as Array<{ label: string; url: string; description: string | null }>;

  if (mappedLinks.length) return mappedLinks;

  return [
    { label: "Drinks menu", url: cleanUrl(event.drinks_menu_url ?? event.drink_menu_url), description: "Cocktails, fizz, bottles and bar options." },
    { label: "Food menu", url: cleanUrl(event.food_menu_url ?? event.menu_url), description: "Dining, drunch and pre-order food options." },
    { label: "Packages", url: cleanUrl(event.packages_url ?? event.package_url), description: "Celebration upgrades, packages and group options." },
  ].filter((link): link is { label: string; url: string; description: string } => Boolean(link.url));
}

function normaliseScheduleTimes(value: ScheduleRuleRow["times"]): Array<{ time: string; status?: string | null }> {
  const parsed = toArray<ScheduleRuleTime>(value);
  const times = parsed
    .map((item) => {
      if (typeof item === "string") return { time: normaliseTime(item) };
      return {
        time: normaliseTime(
        item.event_time ??
        item.time ??
        item.start_time ??
        item.selected_time ??
        item.value ??
        item.label ??
        null,
        ),
        status: item.status ?? item.availability_status ?? null,
      };
    })
    .filter((item) => Boolean(item.time));

  return times.filter((item, index, array) => array.findIndex((candidate) => candidate.time === item.time) === index);
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

function normaliseWeekday(value: unknown) {
  if (typeof value === "number") return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const weekday = String(value ?? "").trim().toLowerCase();
  const map: Record<string, number> = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
  };
  return map[weekday] ?? NaN;
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
  const value = String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["sold_out", "soldout", "full", "unavailable"].includes(value)) return "sold_out";
  if (["limited", "low", "low_availability"].includes(value)) return "limited";
  if (["enquire", "enquiry", "may_enquire"].includes(value)) return "enquire";
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
      const sessionTimes = times.length ? times : [{ time: "19:00", status: null }];
      const excludedDates = new Set(toArray<string>(rule.excluded_dates));
      const duration = rule.duration_minutes ?? 120;

      const selectedDates = toArray<string>(rule.selected_dates);

      if (selectedDates.length) {
        selectedDates.forEach((date) => {
          if (excludedDates.has(date)) return;
          sessionTimes.forEach((slot, index) => {
            byEvent[event.id].push(createSession({ event, bookingType, date, time: slot.time, duration, doors: rule.doors, status: slot.status ?? rule.status, suffix: `dates-${index}`, scheduleRuleId: rule.id }));
          });
        });
      } else if (rule.rule_type === "weekly") {
        const weekdays = toArray<unknown>(rule.weekdays).map(normaliseWeekday).filter(Number.isFinite);
        const weeklyStart = rule.start_date ? new Date(`${rule.start_date}T12:00:00`) : rangeStart;
        const weeklyEnd = rule.end_date ? new Date(`${rule.end_date}T12:00:00`) : rangeEnd;
        const start = weeklyStart > rangeStart ? weeklyStart : rangeStart;
        const end = weeklyEnd < rangeEnd ? weeklyEnd : rangeEnd;

        for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
          const jsDay = cursor.getDay();
          const mondayFirstDay = jsDay === 0 ? 7 : jsDay;
          if (!weekdays.includes(jsDay) && !weekdays.includes(mondayFirstDay)) continue;
          const date = isoDate(cursor);
          if (excludedDates.has(date)) continue;
          sessionTimes.forEach((slot, index) => {
            byEvent[event.id].push(createSession({ event, bookingType, date, time: slot.time, duration, doors: rule.doors, status: slot.status ?? rule.status, suffix: `weekly-${index}`, scheduleRuleId: rule.id }));
          });
        }
      }
    }
  }

  return byEvent;
}

function mapEvents(
  events: EventSeriesRow[],
  sessionsByEvent: Record<string, EventSession[]>,
  templates: TemplateRow[] = [],
): CalendarEvent[] {
  return events
    .map((event) => {
      const sessions = (sessionsByEvent[event.id] ?? []).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
      const runStart = sessions[0]?.date ?? new Date().toISOString().slice(0, 10);
      const runEnd = sessions[sessions.length - 1]?.date ?? runStart;
      const description = event.full_description ?? event.description ?? event.short_description ?? "Purple Peacock event.";
      const menuTemplate = findTemplate(templates, event.menu_template_id, ["menu", "menus"]);
      const howToBookTemplate = findTemplate(templates, event.how_to_book_template_id ?? event.how_it_works_template_id, ["how_to_book", "how_it_works"]);
      const faqTemplate = findTemplate(templates, event.faq_template_id, ["faq", "faqs"]);
      const welcomeTemplate = findTemplate(templates, event.welcome_template_id, ["welcome"]);

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
        welcomeGuideUrl: cleanUrl(event.welcome_guide_url ?? event.welcome_pdf_url ?? event.what_to_expect_pdf_url ?? event.guide_url),
        menuUrl: event.menu_url ?? null,
        menuLinks: buildMenuLinks(event, menuTemplate),
        howItWorksUrl: event.how_it_works_url ?? null,
        howToBookTemplate: normaliseTemplate(howToBookTemplate),
        faqTemplate: normaliseTemplate(faqTemplate),
        welcomeTemplate: normaliseTemplate(welcomeTemplate),
        menuTemplate: normaliseTemplate(menuTemplate),
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

export async function loadCalendarData(): Promise<CalendarResponse> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      events: [],
      integration: {
        mode: "designmynight-ready",
        paymentHandoffRequired: true,
        notes: ["Supabase is not configured."],
      },
    };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const [{ data: eventRows, error: eventError }, { data: bookingTypeRows }, { data: scheduleRows }, { data: templateRows }] = await Promise.all([
    supabase.from("event_series").select("*").eq("status", "published"),
    supabase.from("booking_types").select("*"),
    supabase.from("schedule_rules").select("*"),
    supabase.from("templates").select("*").eq("active", true),
  ]);

  if (eventError || !eventRows?.length) {
    return {
      events: [],
      integration: {
        mode: "designmynight-ready",
        paymentHandoffRequired: true,
        notes: eventError ? [eventError.message] : ["No published events found."],
      },
    };
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

  const events = mapEvents(eventRows as EventSeriesRow[], sessionsByEvent, (templateRows ?? []) as TemplateRow[]);
  if (!events.length) {
    return {
      events: [],
      integration: {
        mode: "designmynight-ready",
        paymentHandoffRequired: true,
        notes: ["No upcoming published event dates found."],
      },
    };
  }

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
