import { describe, expect, it } from "vitest";
import { makeDbf, zipStore } from "./fixtures.js";
import { buildDnt, buildStm, importSource } from "./import.js";

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
      CALLE: "A",
      ESQUINA: "B",
      X: 577000,
      Y: 6140000,
    },
    {
      COD_UBIC_P: 2,
      DESC_LINEA: "402",
      COD_VARIAN: 10,
      ORDINAL: 2,
      CALLE: "C",
      ESQUINA: "D",
      X: 577800,
      Y: 6140000,
    },
  ],
);
const noMaximal = makeDbf(
  [
    ["COD_VARIAN", 8],
    ["COD_VAR_01", 8],
  ],
  [{ COD_VARIAN: 10, COD_VAR_01: 10 }],
);
const header = "tipo_dia;cod_variante;frecuencia;cod_ubic_parada;ordinal;hora;dia_anterior";
const csv = `${header}\n1;10;8000;1;1;800;N\n1;10;8000;2;2;810;N\n`;
const circular =
  "tipo_dia;cod_circular;frecuencia;cod_ubic_parada;cod_variante;parte;ordinal;hora;dia_anterior\n";
const gis = (table: string) =>
  `<!-- generator -->Listo<form name=formito action = '/sit/tmp/${table}.zip'></form>`;

function fetcher(overrides: Record<string, () => Response> = {}): typeof fetch {
  const routes: Record<string, () => Response> = {
    "https://datos-abiertos.montevideo.gub.uy/uptu_pasada_variante.zip": () =>
      new Response(new Uint8Array(zipStore({ "uptu_pasada_variante.csv": csv }, true))),
    "https://datos-abiertos.montevideo.gub.uy/uptu_pasada_circular.zip": () =>
      new Response(new Uint8Array(zipStore({ "uptu_pasada_circular.csv": circular }))),
    "https://intgis.montevideo.gub.uy/sit/php/common/datos/generar_zip2.php?nom_tab=v_uptu_paradas&tipo=gis":
      () => new Response(gis("v_uptu_paradas")),
    "https://intgis.montevideo.gub.uy/sit/tmp/v_uptu_paradas.zip": () =>
      new Response(
        new Uint8Array(zipStore({ "v_uptu_paradas.dbf": paradas, "v_uptu_paradas.shp": "x" })),
      ),
    "https://intgis.montevideo.gub.uy/sit/php/common/datos/generar_zip2.php?nom_tab=uptu_variante_no_maximal&tipo=gis":
      () => new Response(gis("uptu_variante_no_maximal")),
    "https://intgis.montevideo.gub.uy/sit/tmp/uptu_variante_no_maximal.zip": () =>
      new Response(new Uint8Array(zipStore({ "uptu_variante_no_maximal.dbf": noMaximal }))),
    ...overrides,
  };
  return (async (input: string | URL | Request) => {
    const make = routes[String(input)];
    return make ? make() : new Response("", { status: 404 });
  }) as typeof fetch;
}

describe("STM download", () => {
  it("assembles the feed from the Intendencia's files, following the GIS portal's two steps", async () => {
    const { feed, stats } = await buildStm(fetcher());
    expect(stats.trips).toBe(1);
    expect(feed.routes[0]?.line).toBe("402");
    expect(feed.stops).toHaveLength(2);
  });

  it("fails clearly when a file is missing, huge, or the portal's link is gone", async () => {
    const gone = {
      "https://datos-abiertos.montevideo.gub.uy/uptu_pasada_circular.zip": () =>
        new Response("", { status: 404 }),
    };
    await expect(buildStm(fetcher(gone))).rejects.toThrow("download_404");
    const noLink = {
      "https://intgis.montevideo.gub.uy/sit/php/common/datos/generar_zip2.php?nom_tab=v_uptu_paradas&tipo=gis":
        () => new Response("<html>Error</html>"),
    };
    await expect(buildStm(fetcher(noLink))).rejects.toThrow("gis_link_missing");
    const evil = {
      "https://intgis.montevideo.gub.uy/sit/php/common/datos/generar_zip2.php?nom_tab=v_uptu_paradas&tipo=gis":
        () => new Response("action = '/../../etc/passwd.zip'"),
    };
    await expect(buildStm(fetcher(evil))).rejects.toThrow("gis_link_missing");
    const big = {
      "https://datos-abiertos.montevideo.gub.uy/uptu_pasada_variante.zip": () =>
        new Response("x", { headers: { "content-length": String(200 * 1024 * 1024) } }),
    };
    await expect(buildStm(fetcher(big))).rejects.toThrow("download_too_big");
    const noCsv = {
      "https://datos-abiertos.montevideo.gub.uy/uptu_pasada_variante.zip": () =>
        new Response(new Uint8Array(zipStore({ "readme.txt": "x" }))),
    };
    await expect(buildStm(fetcher(noCsv))).rejects.toThrow("zip_missing_.csv");
  });

  it("keeps the stored feed when the new one is too small to be real", async () => {
    const admin = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    };
    const r = await importSource(admin as never, "stm", fetcher());
    expect(r).toMatchObject({ ok: false, error: "feed_too_small", source: "stm" });
  });
});

describe("metropolitan download", () => {
  const catalog = (resources: unknown[]) => () => Response.json({ result: { resources } });
  const url =
    "https://catalogodatos.gub.uy/api/3/action/package_show?id=ministerio-de-transporte-y-obras-publicas-horarios-de-omnibus-en-lineas-interdepartamentales";

  it("refuses a catalog without the GTFS, or one that points off the portal", async () => {
    await expect(buildDnt(fetcher({ [url]: catalog([]) }))).rejects.toThrow("gtfs_link_missing");
    await expect(
      buildDnt(
        fetcher({
          [url]: catalog([{ name: "GTFS", format: "ZIP", url: "https://evil.example/x.zip" }]),
        }),
      ),
    ).rejects.toThrow("gtfs_link_missing");
  });

  it("refuses a zip without one of the tables", async () => {
    const zipUrl = "https://catalogodatos.gub.uy/x/gtfs_1.zip";
    const f = fetcher({
      [url]: catalog([
        { name: "Horarios GTFS", format: "ZIP", url: zipUrl, last_modified: "2026-01-01" },
      ]),
      [zipUrl]: () => new Response(new Uint8Array(zipStore({ "agency.txt": "a" }))),
    });
    await expect(buildDnt(f)).rejects.toThrow("gtfs_missing_routes.txt");
  });
});
