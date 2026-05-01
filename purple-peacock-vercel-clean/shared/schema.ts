import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  shortDescription: text("short_description").notNull(),
  description: text("description").notNull(),
  imageTone: text("image_tone").notNull(),
  videoUrl: text("video_url"),
  menuUrl: text("menu_url"),
  howItWorksUrl: text("how_it_works_url"),
  dmnBookingType: text("dmn_booking_type").notNull(),
  priceFromPence: integer("price_from_pence").notNull(),
  depositPence: integer("deposit_pence").notNull(),
  runStart: text("run_start").notNull(),
  runEnd: text("run_end").notNull(),
});

export const eventSessions = sqliteTable("event_sessions", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  displayTitle: text("display_title").notNull(),
  displaySubtitle: text("display_subtitle"),
  themeName: text("theme_name"),
  dmnBookingTypeId: text("dmn_booking_type_id").notNull(),
  dmnBookingTypeName: text("dmn_booking_type_name").notNull(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  doors: text("doors").notNull(),
  status: text("status").notNull(),
  dmnUrl: text("dmn_url").notNull(),
  action: text("action").notNull(),
  remaining: integer("remaining").notNull(),
});

export const insertEventSchema = createInsertSchema(events);
export const insertEventSessionSchema = createInsertSchema(eventSessions);

export const eventSessionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  displayTitle: z.string(),
  displaySubtitle: z.string().nullable(),
  themeName: z.string().nullable(),
  dmnBookingTypeId: z.string(),
  dmnBookingTypeName: z.string(),
  date: z.string(),
  time: z.string(),
  durationMinutes: z.number(),
  doors: z.string(),
  status: z.enum(["available", "limited", "enquire", "sold_out"]),
  action: z.enum(["accept", "enquire", "reject"]),
  remaining: z.number(),
  dmnUrl: z.string().url(),
});

export const menuLinkSchema = z.object({
  label: z.string(),
  url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const cmsTemplateSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  name: z.string().optional(),
  content: z.any().nullable().optional(),
});

export const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  strapline: z.string(),
  shortDescription: z.string(),
  description: z.string(),
  imageTone: z.enum(["show", "drunch", "christmas"]),
  imageUrl: z.string().url().nullable().optional(),
  videoUrl: z.string().url().nullable(),
  welcomeGuideUrl: z.string().nullable().optional(),
  menuUrl: z.string().nullable(),
  menuLinks: z.array(menuLinkSchema).optional(),
  howItWorksUrl: z.string().nullable(),
  howToBookTemplate: cmsTemplateSchema.nullable().optional(),
  faqTemplate: cmsTemplateSchema.nullable().optional(),
  welcomeTemplate: cmsTemplateSchema.nullable().optional(),
  menuTemplate: cmsTemplateSchema.nullable().optional(),
  dmnBookingType: z.string(),
  priceFromPence: z.number(),
  depositPence: z.number(),
  secondaryTicketEnabled: z.boolean().optional(),
  secondaryTicketLabel: z.string().nullable().optional(),
  secondaryTicketPriceDisplay: z.string().nullable().optional(),
  secondaryTicketDescription: z.string().nullable().optional(),
  runStart: z.string(),
  runEnd: z.string(),
  inclusions: z.array(z.string()),
  sessions: z.array(eventSessionSchema),
});

export const calendarResponseSchema = z.object({
  events: z.array(eventSchema),
  integration: z.object({
    mode: z.enum(["mock", "designmynight-ready"]),
    paymentHandoffRequired: z.boolean(),
    notes: z.array(z.string()),
  }),
});

export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertEventSession = z.infer<typeof insertEventSessionSchema>;
export type EventSession = z.infer<typeof eventSessionSchema>;
export type CalendarEvent = z.infer<typeof eventSchema>;
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;
