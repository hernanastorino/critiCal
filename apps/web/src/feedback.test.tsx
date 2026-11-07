import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { Connected } from "./Connected.js";
import {
  AppSkeleton,
  ErrorNote,
  ScreenSkeleton,
  Skeleton,
  WAIT_MS,
  Wait,
} from "./components/Feedback.js";
import { readTimeout } from "./components/SyllabusImport.js";
import { clearLocal } from "./offline.js";
import { session, stubApi } from "./testing.js";

beforeEach(async () => {
  localStorage.clear();
  await clearLocal();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Wait", () => {
  it("is silent for the first second, then says what is being done", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<Wait label="Sincronizando Google" />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(WAIT_MS - 1));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status").textContent).toBe("Sincronizando Google…");
  });

  it("shows progress when it is known: the step in progress and a bar", () => {
    render(<Wait label="Calculando traslados" done={2} total={8} delay={0} />);
    expect(screen.getByText("Calculando traslados 3 de 8…")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("8");
  });

  it("never counts past the total", () => {
    render(<Wait label="Leyendo" done={5} total={2} delay={0} />);
    expect(screen.getByText("Leyendo 2 de 2…")).toBeTruthy();
  });
});

describe("ErrorNote", () => {
  it("says what happened and runs its action", () => {
    const onClick = vi.fn();
    render(
      <ErrorNote action={{ label: "Reintentar", onClick }}>Sin conexión con Google.</ErrorNote>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Sin conexión con Google.");
    fireEvent.click(screen.getByText("Reintentar"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("has no button when nothing on the screen can fix it", () => {
    render(<ErrorNote>Falta la clave en el servidor.</ErrorNote>);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("skeletons", () => {
  it("draw the shape of the app and of a screen, hidden from VoiceOver", () => {
    const { container } = render(
      <>
        <AppSkeleton label="Leyendo tus datos" />
        <ScreenSkeleton label="Cargando la bandeja" />
        <Skeleton />
      </>,
    );
    expect(container.querySelectorAll(".skeleton-day")).toHaveLength(7);
    expect(container.querySelectorAll(".skeleton-tabs span")).toHaveLength(3);
    expect(container.querySelectorAll(".skeleton-card")).toHaveLength(3);
    for (const s of container.querySelectorAll(".skeleton")) {
      expect(s.getAttribute("aria-hidden")).toBe("true");
    }
    expect(screen.getByText("Leyendo tus datos…")).toBeTruthy();
    expect(screen.getByText("Cargando la bandeja").getAttribute("role")).toBe("status");
  });

  it("lose the shimmer with reduced motion", () => {
    const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");
    expect(css).toMatch(/\.skeleton \{[^}]*animation: shimmer/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.skeleton \{\s*animation: none;/,
    );
  });
});

function client() {
  const ok = Promise.resolve({ data: [], error: null });
  return {
    from: () => ({
      select: () =>
        Object.assign(ok, { maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      upsert: () => Promise.resolve({ error: null }),
      insert: () => Promise.resolve({ error: null }),
      delete: () => ({ in: () => Promise.resolve({ error: null }) }),
    }),
    auth: session,
  } as never;
}

type Api = (name: string, body: Record<string, unknown>) => unknown;

async function openSettings(api: Api) {
  stubApi(async (name, opts) => ({ data: await api(name, opts.body), error: null }));
  render(
    <Connected client={client()} session={{ user: { id: `t${Math.random()}` } } as never}>
      <Shell />
    </Connected>,
  );
  await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Ajustes"));
}

describe("opening the app", () => {
  it("shows the app's shape and what it is doing, not a blank or a spinner", async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    stubApi(async () => {
      await gate;
      return { data: { connected: true }, error: null };
    });
    render(
      <Connected client={client()} session={{ user: { id: "boot" } } as never}>
        <Shell />
      </Connected>,
    );
    expect(await screen.findByText("Sincronizando Google e iCloud…")).toBeTruthy();
    expect(document.querySelectorAll(".skeleton-day")).toHaveLength(7);
    await act(async () => open());
    await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
  });

  it("says what failed and what to do when the data cannot be loaded", async () => {
    stubApi(async () => ({ data: { connected: true }, error: null }));
    const failing = {
      auth: session,
      from: () => ({
        select: () =>
          Object.assign(Promise.resolve({ data: null, error: new Error("Failed to fetch") }), {
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
      }),
    };
    render(
      <Connected client={failing as never} session={{ user: { id: "off" } } as never}>
        <Shell />
      </Connected>,
    );
    expect(await screen.findByText(/No hay conexión con el servidor/)).toBeTruthy();
    expect(screen.getByText("Reintentar")).toBeTruthy();
    expect(screen.getByText(/«Reintentar» vuelve a cargar/)).toBeTruthy();
  });
});

describe("calendar sync errors", () => {
  it("offers «Reconectar Google» where the permission is the problem", async () => {
    await openSettings((name) =>
      name === "google-sync"
        ? { connected: false, error: "no_refresh_token" }
        : { connected: true },
    );
    const status = await screen.findByTestId("google-status");
    expect(status.closest('[role="alert"]')).toBeTruthy();
    expect(status.textContent).toMatch(/Reconectar Google/);
    expect(
      within(status.closest('[role="alert"]') as HTMLElement).getByText("Reconectar Google"),
    ).toBeTruthy();
  });

  it("offers «Reintentar» for a failure that may pass, and it syncs again", async () => {
    const calls: string[] = [];
    await openSettings((name) => {
      calls.push(name);
      return name === "google-sync"
        ? { connected: false, error: "unreachable" }
        : { connected: true };
    });
    const status = await screen.findByTestId("google-status");
    expect(status.textContent).toMatch(/revisá tu internet/);
    const before = calls.filter((c) => c === "google-sync").length;
    await act(async () => fireEvent.click(screen.getAllByText("Reintentar")[0] as HTMLElement));
    await waitFor(() =>
      expect(calls.filter((c) => c === "google-sync").length).toBeGreaterThan(before),
    );
  });

  it("sends a rejected iCloud password to the password field", async () => {
    await openSettings((name) =>
      name === "icloud-sync"
        ? { connected: false, error: "icloud_auth_failed", status: 401 }
        : { connected: true },
    );
    await screen.findByTestId("icloud-status");
    fireEvent.click(screen.getByText("Calendarios", { selector: ".settings-label" }));
    fireEvent.click(await screen.findByText("Escribir la contraseña de nuevo"));
    expect(document.activeElement).toBe(screen.getByPlaceholderText("xxxx-xxxx-xxxx-xxxx"));
  });
});

describe("reading a syllabus", () => {
  const pdf = () => new File(["%PDF"], "p.pdf", { type: "application/pdf" });

  it("says what it is doing once it takes more than a second", async () => {
    await openSettings(async (name) => {
      if (name !== "syllabus") return { connected: true };
      await new Promise((r) => setTimeout(r, 1500));
      return { ok: false, error: "unreadable" };
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Programa en PDF"), { target: { files: [pdf()] } });
    });
    expect(screen.queryByText(/Leyendo el programa/)).toBeNull();
    expect(
      await screen.findByText("Leyendo el programa 2 de 2…", {}, { timeout: 2500 }),
    ).toBeTruthy();
    expect(
      await screen.findByText(/No pude entender el programa/, {}, { timeout: 2500 }),
    ).toBeTruthy();
  });

  it("offers to try the same file again when Gemini is busy, with no «más tarde»", async () => {
    let calls = 0;
    await openSettings((name) => {
      if (name !== "syllabus") return { connected: true };
      calls++;
      return { ok: false, error: "gemini_busy" };
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Programa en PDF"), { target: { files: [pdf()] } });
    });
    const note = await screen.findByText(/Gemini está saturado/);
    expect(note.textContent).not.toMatch(/más tarde/);
    await act(async () => fireEvent.click(screen.getByText("Probar de nuevo")));
    expect(calls).toBe(2);
  });

  it("tells an expired session from a busy Gemini", async () => {
    stubApi(async () => ({ data: null, error: null }));
    const { readSyllabus } = await import("./remote.js");
    const answer = (status: number) =>
      vi.stubGlobal("fetch", async () => new Response("<html>", { status }));
    for (const [status, error] of [
      [401, "unauthorized"],
      [413, "too_large"],
      [429, "gemini_busy"],
      [500, "syllabus_failed"],
    ] as const) {
      answer(status);
      expect(await readSyllabus(client(), "x")).toEqual({ ok: false, error });
    }
  });

  it("gives up on a read that never answers and offers to try again", async () => {
    await openSettings((name) =>
      name === "syllabus" ? new Promise(() => {}) : { connected: true },
    );
    readTimeout.ms = 50;
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Programa en PDF"), { target: { files: [pdf()] } });
    });
    expect(await screen.findByText(/Gemini tardó demasiado/)).toBeTruthy();
    readTimeout.ms = 90_000;
    expect(screen.getByText("Probar de nuevo")).toBeTruthy();
  });

  it("offers another file when the PDF is the problem", async () => {
    await openSettings(() => ({ ok: false, error: "unreadable" }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Programa en PDF"), { target: { files: [pdf()] } });
    });
    await screen.findByText(/No pude entender el programa/);
    const input = screen.getByLabelText("Programa en PDF");
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByText("Elegir otro PDF"));
    expect(click).toHaveBeenCalled();
  });

  it("sends the user to their own key when the server has none", async () => {
    await openSettings(() => ({ ok: false, error: "server_not_configured" }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Programa en PDF"), { target: { files: [pdf()] } });
    });
    expect(await screen.findByText(/Cargá la tuya en «Tu IA \(Gemini\)»/)).toBeTruthy();
  });
});

describe("Gemini key", () => {
  it("shows a grey placeholder while it finds out which key is used", async () => {
    let open: (v: unknown) => void = () => {};
    const gate = new Promise((resolve) => {
      open = resolve;
    });
    await openSettings((name, body) =>
      name === "syllabus" && body.action === "key_status" ? gate : { connected: true },
    );
    expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    await act(async () => open({ ok: true, own: false, fallback: true }));
    expect(await screen.findByText(/Usás la clave de critiCal/)).toBeTruthy();
  });

  it("retries a busy Gemini and focuses the field for a rejected key", async () => {
    let answer = "gemini_busy";
    let sets = 0;
    await openSettings((name, body) => {
      if (name !== "syllabus") return { connected: true };
      if (body.action === "key_status") return { ok: true, own: false, fallback: true };
      sets++;
      return { ok: false, error: answer };
    });
    fireEvent.click(screen.getByText("Tu IA (Gemini)", { selector: ".settings-label" }));
    await screen.findByText(/Usás la clave de critiCal/);
    const field = screen.getByLabelText("Clave de Gemini");
    fireEvent.change(field, { target: { value: "AIza-x" } });
    await act(async () => fireEvent.click(screen.getByText("Guardar")));
    const note = await screen.findByText(/Gemini no responde ahora/);
    expect(note.textContent).not.toMatch(/Probá/);
    await act(async () => fireEvent.click(screen.getByText("Probar de nuevo")));
    expect(sets).toBe(2);
    answer = "invalid_key";
    await act(async () => fireEvent.click(screen.getByText("Probar de nuevo")));
    fireEvent.click(await screen.findByText("Pegar otra clave"));
    expect(document.activeElement).toBe(field);
  });
});

describe("widget", () => {
  it("names what failed and retries it", async () => {
    let ok = false;
    await openSettings((name) =>
      name === "widget" ? (ok ? { ok: true, token: "cw_t" } : { ok: false }) : { connected: true },
    );
    await act(async () => fireEvent.click(screen.getByText("Generar script")));
    expect(await screen.findByText("No se pudo generar el script.")).toBeTruthy();
    ok = true;
    await act(async () => fireEvent.click(screen.getByText("Probar de nuevo")));
    expect(await screen.findByLabelText("Script del widget")).toBeTruthy();
  });

  it("says the widget keeps working when it could not be switched off", async () => {
    await openSettings((name) => (name === "widget" ? { ok: false } : { connected: true }));
    await act(async () => fireEvent.click(screen.getByText("Desactivar el widget")));
    expect(await screen.findByText(/sigue funcionando/)).toBeTruthy();
  });
});

describe("account", () => {
  it("repeats the same action from the error's button", async () => {
    let calls = 0;
    await openSettings((name) => {
      if (name !== "account") return { connected: true };
      calls++;
      return { ok: false, error: "unreachable" };
    });
    fireEvent.change(await screen.findByLabelText(/Escribí BORRAR/), {
      target: { value: "BORRAR" },
    });
    await act(async () => fireEvent.click(screen.getByText("Borrar mi cuenta")));
    expect(await screen.findByText(/No se borró nada: hace falta internet/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("Probar de nuevo")));
    expect(calls).toBe(2);
  });
});

describe("backup", () => {
  it("offers another file when the one chosen is not a backup", async () => {
    await openSettings(() => ({ connected: true }));
    const input = screen.getByLabelText("Archivo de respaldo");
    const bad = new File(["no es json"], "x.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [bad] } });
    });
    const click = vi.spyOn(input, "click");
    fireEvent.click(await screen.findByText("Elegir otro archivo"));
    expect(click).toHaveBeenCalled();
  });
});

describe("calls that never answer, and an expired session", () => {
  it("every server call gives up with «timeout» instead of waiting for ever", async () => {
    const { callTimeouts, syncICloud, widgetToken, geminiKey, closeAccount, computeTravel } =
      await import("./remote.js");
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      await new Promise((_, reject) =>
        init.signal?.addEventListener("abort", () => reject(new DOMException("t", "TimeoutError"))),
      );
    });
    callTimeouts.ms = 20;
    callTimeouts.slowMs = 20;
    try {
      const c = client();
      expect(await syncICloud(c)).toMatchObject({ connected: false, error: "timeout" });
      expect(await widgetToken(c, "create")).toMatchObject({ ok: false, error: "timeout" });
      expect(await geminiKey(c, "set_key", "k")).toMatchObject({ ok: false, error: "timeout" });
      expect(await closeAccount(c, "revoke", false)).toMatchObject({ ok: false, error: "timeout" });
      expect(await computeTravel(c)).toMatchObject({ ok: false, error: "timeout" });
    } finally {
      callTimeouts.ms = 30_000;
      callTimeouts.slowMs = 90_000;
    }
  });

  it("an expired session says so and offers to reload, in every zone", async () => {
    await openSettings((name) =>
      name === "widget" ? { ok: false, error: "unauthorized" } : { connected: true },
    );
    await act(async () => fireEvent.click(screen.getByText("Generar script")));
    expect(await screen.findByText("Tu sesión venció.")).toBeTruthy();
    expect(screen.getByText("Recargar para entrar de nuevo")).toBeTruthy();
  });

  it("«Quitar mi clave» talks about removing, not saving", async () => {
    await openSettings((name, body) => {
      if (name !== "syllabus") return { connected: true };
      return body.action === "key_status"
        ? { ok: true, own: true, fallback: true }
        : { ok: false, error: "unreachable" };
    });
    await screen.findByText(/Usás tu propia clave/);
    await act(async () => fireEvent.click(screen.getByText("Quitar mi clave")));
    expect(await screen.findByText("Sin conexión: no se pudo quitar.")).toBeTruthy();
  });
});
