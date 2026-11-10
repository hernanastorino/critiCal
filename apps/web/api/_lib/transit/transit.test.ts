import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { fakeGtfs, zipStore } from "../fake-providers.js";
import { readDbf } from "./dbf.js";
import { decodeFeed, encodeFeed, FeedBuilder } from "./feed.js";
import { makeDbf } from "./fixtures.js";
import { haversine, utm21sToLatLon, walkMinutes } from "./geo.js";
import { csvRows, parseGtfs } from "./gtfs.js";
import { parseStm } from "./stm.js";
import { unzip } from "./zip.js";

describe("zip", () => {
  it("reads stored and deflated entries, and skips folders", () => {
    for (const deflate of [false, true]) {
      const zip = unzip(zipStore({ "a.txt": "hola", "dir/b.csv": "x;y\n1;2" }, deflate));
      expect([...zip.keys()]).toEqual(["a.txt", "dir/b.csv"]);
      expect(zip.get("dir/b.csv")?.toString()).toBe("x;y\n1;2");
    }
  });

  it("refuses what is not a zip, or has cut or unsupported entries", () => {
    expect(() => unzip(Buffer.from("not a zip at all, but long enough to have an end"))).toThrow(
      "zip_invalid",
    );
    const good = zipStore({ "a.txt": "hola" });
    expect(() => unzip(good.subarray(0, good.length - 30))).toThrow("zip_invalid");
    const odd = Buffer.from(good);
    odd.writeUInt16LE(99, odd.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
    expect(() => unzip(odd)).toThrow("zip_method_unsupported");
    const huge = Buffer.from(good);
    huge.writeUInt32LE(0xffffffff, huge.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    expect(() => unzip(huge)).toThrow("zip_entry_too_big");
    expect(deflateRawSync(Buffer.from("x")).length).toBeGreaterThan(0);
  });
});

describe("dbf", () => {
  it("reads rows as trimmed text, in UTF-8, skipping deleted ones", () => {
    const buf = makeDbf(
      [
        ["CALLE", 12],
        ["N", 6],
      ],
      [
        { CALLE: "CORUÑA", N: 7 },
        { CALLE: "gone", N: 8 },
        { CALLE: "", N: 9 },
      ],
    );
    const headerLen = buf.readUInt16LE(8);
    buf[headerLen + buf.readUInt16LE(10)] = 0x2a;
    expect(readDbf(buf)).toEqual([
      { CALLE: "CORUÑA", N: "7" },
      { CALLE: "", N: "9" },
    ]);
  });

  it("refuses a truncated table", () => {
    expect(() => readDbf(Buffer.alloc(10))).toThrow("dbf_invalid");
    const buf = makeDbf([["A", 3]], [{ A: "x" }, { A: "y" }]);
    expect(() => readDbf(buf.subarray(0, buf.length - 6))).toThrow("dbf_invalid");
  });
});

describe("geo", () => {
  it("projects UTM 21S back to latitude and longitude", () => {
    // The central meridian at the equator.
    const o = utm21sToLatLon(500000, 10_000_000);
    expect(o.lat).toBeCloseTo(0, 6);
    expect(o.lon).toBeCloseTo(-57, 6);
    // A real stop from the Intendencia's file lands inside Montevideo.
    const p = utm21sToLatLon(577981.398, 6140774.574);
    expect(p.lat).toBeGreaterThan(-34.95);
    expect(p.lat).toBeLessThan(-34.8);
    expect(p.lon).toBeGreaterThan(-56.3);
    expect(p.lon).toBeLessThan(-56.0);
    // 1 km east along the same parallel is ~1 km on the ground.
    const q = utm21sToLatLon(578981.398, 6140774.574);
    expect(haversine(p, q)).toBeGreaterThan(995);
    expect(haversine(p, q)).toBeLessThan(1005);
  });

  it("estimates walks along streets", () => {
    expect(walkMinutes(0)).toBe(0);
    expect(walkMinutes(800)).toBe(13);
    expect(haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
  });
});

describe("feed storage", () => {
  const sample = () => {
    const b = new FeedBuilder();
    const s0 = b.stop({ id: "1", name: "Uno", lat: -34.9, lon: -56.1 });
    const s1 = b.stop({ id: "2", name: "Dos", lat: -34.91, lon: -56.11 });
    expect(b.stop({ id: "1", name: "otra vez", lat: 0, lon: 0 })).toBe(s0);
    expect(b.hasStop("2")).toBe(true);
    const r = b.route({ line: "L", head: "Dos", company: null });
    b.trip(r, [s0, s1], [0, 5], 1, 600);
    b.trip(r, [s0, s1], [0, 5], 1, 570);
    b.trip(r, [s0, s1], [0, 5], 1, 570);
    b.trip(r, [s0, s1], [0, 6], 2, 600, { from: 20260101, to: 20261231 });
    return b.build("stm", "2026-12-31");
  };

  it("keeps each pattern once, sorts and dedupes departures", () => {
    const feed = sample();
    expect(feed.patterns).toHaveLength(2);
    expect(feed.deps[0]?.t).toEqual([570, 600]);
    expect(feed.deps).toHaveLength(2);
  });

  it("round-trips through the stored text and has a stable, content-based version", () => {
    const feed = sample();
    expect(feed.version).toMatch(/^[0-9a-f]{12}$/);
    expect(sample().version).toBe(feed.version);
    expect(decodeFeed(encodeFeed(feed))).toEqual(feed);
    const other = new FeedBuilder();
    other.stop({ id: "1", name: "Uno", lat: -34.9, lon: -56.1 });
    expect(other.build("stm", null).version).not.toBe(feed.version);
  });

  it("refuses a stored feed of another format", () => {
    const text = JSON.stringify({ v: 2 });
    const { gzipSync } = require("node:zlib") as typeof import("node:zlib");
    expect(() => decodeFeed(gzipSync(text).toString("base64"))).toThrow("feed_version_unsupported");
  });
});

describe("STM import", () => {
  const paradas = makeDbf(
    [
      ["COD_UBIC_P", 8],
      ["DESC_LINEA", 8],
      ["COD_VARIAN", 8],
      ["ORDINAL", 4],
      ["CALLE", 20],
      ["ESQUINA", 20],
      ["X", 16],
      ["Y", 16],
    ],
    [
      {
        COD_UBIC_P: 1,
        DESC_LINEA: "402",
        COD_VARIAN: 10,
        ORDINAL: 1,
        CALLE: "Rio Branco",
        ESQUINA: "Colonia",
        X: 577000,
        Y: 6140000,
      },
      {
        COD_UBIC_P: 2,
        DESC_LINEA: "402",
        COD_VARIAN: 10,
        ORDINAL: 2,
        CALLE: "Ejido",
        ESQUINA: "Mercedes",
        X: 577800,
        Y: 6140000,
      },
      {
        COD_UBIC_P: 3,
        DESC_LINEA: "402",
        COD_VARIAN: 10,
        ORDINAL: 3,
        CALLE: "Malvín",
        ESQUINA: "Italia",
        X: 578600,
        Y: 6140000,
      },
      {
        COD_UBIC_P: 4,
        DESC_LINEA: "",
        COD_VARIAN: 99,
        ORDINAL: 1,
        CALLE: "Sola",
        ESQUINA: "",
        X: 579000,
        Y: 6141000,
      },
      {
        COD_UBIC_P: "bad",
        DESC_LINEA: "402",
        COD_VARIAN: 10,
        ORDINAL: 4,
        CALLE: "x",
        ESQUINA: "",
        X: "",
        Y: "",
      },
    ],
  );
  const noMaximal = makeDbf(
    [
      ["COD_VARIAN", 8],
      ["COD_VAR_01", 8],
    ],
    [{ COD_VARIAN: 11, COD_VAR_01: 10 }],
  );
  // tipo_dia;cod_variante;frecuencia;cod_ubic_parada;ordinal;hora;dia_anterior — day types interleave.
  const variante = [
    "tipo_dia;cod_variante;frecuencia;cod_ubic_parada;ordinal;hora;dia_anterior",
    "1;10;8000;1;1;804;N",
    "2;10;8000;1;1;806;N",
    "1;10;8000;2;2;810;N",
    "2;10;8000;2;2;812;N",
    "1;10;8000;3;3;820;N",
    "1;11;23500;1;1;2352;N",
    "1;11;23500;2;2;5;S",
    "1;11;300;1;1;32;N",
    "1;11;300;2;2;40;N",
    "1;77;9000;1;1;900;N",
    "1;77;9000;2;2;910;N",
    "1;10;10000;1;1;1000;N",
    "4;10;11000;1;1;1100;N",
    "4;10;11000;2;1;1110;N",
    "",
  ].join("\n");
  const circular = [
    "tipo_dia;cod_circular;frecuencia;cod_ubic_parada;cod_variante;parte;ordinal;hora;dia_anterior",
    " 0001; 000000001; 000009000; 000000000000002; 000000010; 000000002; 000000001; 000000915;N",
    " 0001; 000000001; 000009000; 000000000000001; 000000010; 000000001; 000000002; 000000905;N",
    " 0001; 000000001; 000009000; 000000000000001; 000000010; 000000001; 000000001; 000000900;N",
  ].join("\n");

  const out = parseStm({ variante, circular, paradas, noMaximal });

  it("builds the line, heading and stops from the stop table", () => {
    const { feed } = out;
    expect(feed.stops.map((s) => s.name)).toEqual([
      "Rio Branco y Colonia",
      "Ejido y Mercedes",
      "Malvín y Italia",
    ]);
    expect(feed.stops[0]?.lat).toBeLessThan(-34.8);
    expect(feed.routes.map((r) => `${r.line}>${r.head}`)).toContain("402>Malvín");
  });

  it("stores offsets from the departure, per day type, deduplicating the pattern", () => {
    const { feed } = out;
    const weekday = feed.deps.filter((d) => d.d === 1);
    const saturday = feed.deps.filter((d) => d.d === 2);
    // 08:00 weekday: passes at +4, +10, +20; the Saturday pattern differs (+6, +12).
    const p = feed.patterns.find((p) => p.off.join() === "4,10,20");
    expect(p).toBeDefined();
    expect(
      weekday.some((d) => d.p === feed.patterns.indexOf(p as never) && d.t.includes(480)),
    ).toBe(true);
    expect(feed.patterns.some((p) => p.off.join() === "6,12")).toBe(true);
    expect(saturday).toHaveLength(1);
  });

  it("reads past-midnight passes and early departures as the day before's service", () => {
    const { feed } = out;
    // 23:50 trip reaching 00:05: +2 then +15; the 00:30 departure belongs to the previous service day (1470).
    const night = feed.patterns.find((p) => p.off.join() === "2,15");
    expect(night).toBeDefined();
    const times = feed.deps
      .filter((d) => d.p === feed.patterns.indexOf(night as never))
      .flatMap((d) => d.t);
    expect(times).toContain(1430);
    const early = feed.deps.flatMap((d) => d.t);
    expect(early).toContain(1470);
  });

  it("joins the parts of a circular trip into one", () => {
    const { feed } = out;
    const circ = feed.patterns.find((p) => p.off.join() === "0,5,15");
    expect(circ?.seq).toHaveLength(3);
  });

  it("counts what it had to leave out", () => {
    expect(out.stats.unresolvedVariants).toBe(1);
    // variant 77 (no line), the single-stop trip and day type 4.
    expect(out.stats.skippedTrips).toBeGreaterThanOrEqual(3);
    expect(out.stats.trips).toBeGreaterThan(3);
  });
});

describe("metropolitan GTFS", () => {
  const files = (stopTimes: string) => ({
    agency: '"agency_id","agency_name"\n13,"CASANOVA"',
    routes:
      '"route_id","agency_id","route_short_name","route_long_name","route_type"\n5002,13,"6R6","MDEO./SAUCE (x 6,33,17m)",3\n5003,13,"7","PLAZA",3\n5004,99,"","",3',
    calendar:
      '"service_id","monday","tuesday","wednesday","thursday","friday","saturday","sunday","start_date","end_date"\n1,1,1,1,1,1,0,0,20260302,20261225\n2,0,0,0,0,0,1,1,20260302,20261225\n3,0,0,0,0,0,0,0,20260302,20261225',
    trips: '"route_id","service_id","trip_id"\n5002,1,t1\n5002,2,t2\n5003,3,t3\n5002,1,t4\n9,1,t9',
    stops:
      '"stop_id","stop_code","stop_name","stop_desc","stop_lat","stop_lon"\n1,"1","Bruno, ""Brum""","",-34.9,-56.19\n2,"2","Medio","",-34.8,-56.1\n3,"3","Fin","",-34.7,-56.0\n4,"4","Sin coordenadas","",,',
    stopTimes,
  });
  const times = [
    '"trip_id","arrival_time","departure_time","stop_id","stop_sequence"',
    "t1,06:45:00,06:45:00,1,1",
    "t1,,,2,2",
    "t1,07:15:00,07:15:00,3,3",
    "t2,25:00:00,25:00:00,1,1",
    "t2,25:20:00,25:20:00,3,2",
    "t3,08:00:00,08:00:00,1,1",
    "t3,08:10:00,08:10:00,3,2",
    "t4,09:00:00,09:00:00,1,1",
    "t4,,,4,2",
    "t9,09:00:00,09:00:00,1,1",
  ].join("\r\n");
  const { feed, stats } = parseGtfs(files(times));

  it("reads quoted names, the heading after the slash and the company", () => {
    expect(feed.stops[0]?.name).toBe('Bruno, "Brum"');
    expect(feed.routes[0]).toEqual({ line: "6R6", head: "SAUCE", company: "CASANOVA" });
    expect(feed.routes[1]?.head).toBe("PLAZA");
  });

  it("interpolates blank times and keeps trips past 24:00 on their service day", () => {
    const weekday = feed.patterns.find((p) => p.seq.length === 3);
    expect(weekday?.off).toEqual([0, 15, 30]);
    const sat = feed.deps.filter((d) => d.d === 2);
    expect(sat[0]?.t).toEqual([1500]);
    expect(feed.deps.filter((d) => d.d === 3).map((d) => d.t[0])).toEqual([1500]);
  });

  it("keeps the validity range and skips trips it cannot use", () => {
    expect(feed.validTo).toBe("2026-12-25");
    expect(feed.deps[0]?.from).toBe(20260302);
    // t3 (service without days), t4 (one stop located), t9 (unknown route).
    expect(stats.skippedTrips).toBe(3);
    expect(stats.trips).toBe(2);
  });

  it("refuses stop times that are not grouped by trip", () => {
    expect(() => parseGtfs(files(`${times}\nt1,06:00:00,06:00:00,1,9`))).toThrow(
      "gtfs_rows_not_contiguous",
    );
  });

  it("parses the invented feed the dev server serves", () => {
    const zip = unzip(fakeGtfs());
    const text = (n: string) => zip.get(n)?.toString("utf8") ?? "";
    const dev = parseGtfs({
      agency: text("agency.txt"),
      routes: text("routes.txt"),
      calendar: text("calendar.txt"),
      trips: text("trips.txt"),
      stops: text("stops.txt"),
      stopTimes: text("stop_times.txt"),
    });
    expect(dev.feed.routes.map((r) => r.line)).toEqual(["L1", "L1", "L2", "L2"]);
    expect(dev.feed.stops).toHaveLength(62);
  });

  it("reads CSV with a byte-order mark, blank lines and short rows", () => {
    expect([...csvRows("﻿a,b\n\n1\n")]).toEqual([{ a: "1", b: "" }]);
  });
});
