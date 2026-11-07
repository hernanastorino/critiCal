import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData } from "./demo.js";

const NOW = Date.UTC(2026, 10, 2, 20);
const tick = () => act(() => new Promise((r) => setTimeout(r, 20)));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  render(<App fixedNow={NOW} initial={demoData} />);
  fireEvent.click(screen.getByLabelText("Ajustes"));
});
afterEach(cleanup);

describe("what is typed in Ajustes and not saved", () => {
  it("is still there after closing and opening Ajustes, marked as unsaved", () => {
    fireEvent.click(screen.getByRole("button", { name: /^Reglas/ }));
    const field = screen.getByLabelText("Margen antes de cada evento (min)") as HTMLInputElement;
    expect(screen.queryByText("Cambios sin guardar")).toBeNull();
    fireEvent.change(field, { target: { value: "35" } });
    expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Cerrar"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Reglas/ }));
    const again = screen.getByLabelText("Margen antes de cada evento (min)") as HTMLInputElement;
    expect(again.value).toBe("35");
    fireEvent.click(screen.getByText("Guardar reglas"));
    expect(screen.queryByText("Cambios sin guardar")).toBeNull();
  });

  it("keeps a half-typed routine", () => {
    fireEvent.click(screen.getByRole("button", { name: /^Rutinas/ }));
    fireEvent.change(screen.getByPlaceholderText("Gimnasio"), { target: { value: "Nadar" } });
    fireEvent.click(screen.getByLabelText("Cerrar"));
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Rutinas/ }));
    expect((screen.getByPlaceholderText("Gimnasio") as HTMLInputElement).value).toBe("Nadar");
  });
});

describe("renaming a subject", () => {
  it("is refused when another subject or routine already has that name", () => {
    fireEvent.click(screen.getByRole("button", { name: /^Materias/ }));
    const heads = screen.getAllByRole("button", { expanded: false });
    const subjects = heads.filter((b) => b.classList.contains("activity-head"));
    fireEvent.click(subjects[0] as HTMLElement);
    const other = (subjects[1] as HTMLElement).textContent?.replace(/[▲▼]/g, "").split("·")[0];
    fireEvent.change(screen.getByLabelText("Nombre de la materia"), {
      target: { value: ` ${other?.toUpperCase().trim()} ` },
    });
    expect(screen.getByText("Ya hay una materia o rutina con ese nombre.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Guardar / }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("repeated names and other forms", () => {
  it("treats inner spaces as nothing when adding a subject", () => {
    fireEvent.click(screen.getByRole("button", { name: /^Inicio de cuatrimestre/ }));
    const field = screen.getByPlaceholderText("Física II");
    fireEvent.change(field, { target: { value: "Gym" } });
    const added = screen.getByRole("button", { name: "Agregar materia" }) as HTMLButtonElement;
    const first = (name: string) => {
      fireEvent.change(field, { target: { value: name } });
      return added.disabled;
    };
    expect(first("Una materia nueva")).toBe(false);
    expect(first("  gym ")).toBe(true);
    expect(screen.getByText("Ya hay una materia o rutina con ese nombre.")).toBeTruthy();
  });

  it("keeps a place being added", () => {
    fireEvent.click(screen.getByRole("button", { name: /^Lugares y traslados/ }));
    fireEvent.click(screen.getByRole("button", { name: /Agregar lugar/ }));
    fireEvent.change(screen.getByPlaceholderText("Facu"), { target: { value: "Taller" } });
    fireEvent.click(screen.getByLabelText("Cerrar"));
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Lugares y traslados/ }));
    expect((screen.getByPlaceholderText("Facu") as HTMLInputElement).value).toBe("Taller");
    expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
  });
});

describe("the system's back", () => {
  it("goes from a screen to the list and from the list to the app", async () => {
    await tick();
    fireEvent.click(screen.getByRole("button", { name: /^Reglas/ }));
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Reglas");
    act(() => history.back());
    await tick();
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Ajustes");
    act(() => history.back());
    await tick();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not leave entries behind when Ajustes is closed with its own buttons", async () => {
    const before = history.length;
    fireEvent.click(screen.getByRole("button", { name: /^Reglas/ }));
    fireEvent.click(screen.getByRole("button", { name: "Volver a Ajustes" }));
    await tick();
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Ajustes");
    fireEvent.click(screen.getByLabelText("Cerrar"));
    await tick();
    expect(history.state?.["critiCal.settings"]).toBeUndefined();
    expect(history.length).toBeGreaterThanOrEqual(before - 1);
  });
});
