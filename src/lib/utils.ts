import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

const APP_TIME_ZONE = "Europe/Ljubljana";

const calendarDateFormatter = new Intl.DateTimeFormat("sl-SI", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: APP_TIME_ZONE,
});

const calendarDateTimeFormatter = new Intl.DateTimeFormat("sl-SI", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: APP_TIME_ZONE,
});

export function formatTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((value) => value.toString().padStart(2, "0"))
      .join(":");
  }

  return [minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function formatLectureDuration(seconds: number | null) {
  if (!seconds) {
    return "Neznano trajanje";
  }

  return formatTimestamp(seconds * 1000);
}

export function formatRelativeDate(isoString: string) {
  const parts = calendarDateTimeFormatter.formatToParts(new Date(isoString));
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  const day = valueByType.get("day") ?? "";
  const month = valueByType.get("month") ?? "";
  const year = valueByType.get("year") ?? "";
  const hour = valueByType.get("hour") ?? "00";
  const minute = valueByType.get("minute") ?? "00";

  return `${day}. ${month}. ${year} ob ${hour}:${minute}`;
}

export function formatCalendarDate(isoString: string) {
  const parts = calendarDateFormatter.formatToParts(new Date(isoString));
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  const day = valueByType.get("day") ?? "";
  const month = valueByType.get("month") ?? "";
  const year = valueByType.get("year") ?? "";

  return `${day}. ${month}. ${year}`;
}

export function stripCodeFences(value: string) {
  return value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

export function serializeVector(values: number[]) {
  return `[${values.join(",")}]`;
}

export function safeJsonParse<T>(value: string): T {
  return JSON.parse(stripCodeFences(value)) as T;
}

export function notEmpty<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
