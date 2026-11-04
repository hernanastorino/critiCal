import { describe, expect, it } from "vitest";
import { parseDuration, parseIcs } from "./ics.js";

const ics = [
  "BEGIN:VCALENDAR",
  "BEGIN:VTIMEZONE",
  "TZID:America/Montevideo",
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:abc",
  "DTSTART;TZID=America/Montevideo:20261105T080000",
  "DTEND;TZID=America/Montevideo:20261105T110000",
  "SUMMARY:Parcial Física I\\, teórico",
  "LOCATION:Facultad de Ingenier",
  " ía",
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "DESCRIPTION:Alarm should not leak",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:all",
  "DTSTART;VALUE=DATE:20261106",
  "SUMMARY:Entrega TP",
  "TRANSP:TRANSPARENT",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:rec",
  "RECURRENCE-ID:20261110T120000Z",
  "DTSTART:20261110T120000Z",
  "DURATION:PT1H30M",
  "STATUS:CANCELLED",
  "SUMMARY:Clase",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:nostart",
  "SUMMARY:sin fecha",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs", () => {
  it("reads timed, all-day, recurring and cancelled events", () => {
    const [exam, allDay, rec] = parseIcs(ics, "America/Montevideo");
    expect(exam).toMatchObject({
      uid: "abc",
      summary: "Parcial Física I, teórico",
      location: "Facultad de Ingeniería",
      start: Date.UTC(2026, 10, 5, 11),
      end: Date.UTC(2026, 10, 5, 14),
      allDay: false,
      busy: true,
      cancelled: false,
    });
    expect(allDay).toMatchObject({
      allDay: true,
      busy: false,
      start: Date.UTC(2026, 10, 6, 3),
      end: Date.UTC(2026, 10, 7, 3),
    });
    expect(rec).toMatchObject({
      cancelled: true,
      end: Date.UTC(2026, 10, 10, 13, 30),
      recurrenceId: String(Date.UTC(2026, 10, 10, 12)),
    });
    expect(parseIcs(ics, "UTC")).toHaveLength(3);
  });

  it("parses durations and rejects bad dates", () => {
    expect(parseDuration("P1DT2H")).toBe(26 * 3_600_000);
    expect(parseDuration("-PT15M")).toBe(-900_000);
    expect(parseDuration("nope")).toBe(0);
    expect(() => parseIcs("BEGIN:VEVENT\nDTSTART:garbage\nEND:VEVENT", "UTC")).toThrow(/bad date/);
  });
});
