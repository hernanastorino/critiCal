import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { reducer, StoreProvider } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20);
const start = () => reducer(demoData(NOW), { type: "refresh", now: NOW });

const mount = () =>
  render(
    <StoreProvider initial={start} persist={false} fixedNow={NOW}>
      <ToastProvider>
        <Silos />
      </ToastProvider>
    </StoreProvider>,
  );

const openNew = () => fireEvent.click(screen.getByLabelText("Nueva actividad"));
const typeName = (v: string) =>
  fireEvent.change(screen.getByPlaceholderText("Parcial Física I"), { target: { value: v } });

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

// 23.ª y 24.ª vuelta: recargar perdía el formulario abierto y Escape lo descartaba sin avisar.
describe("borradores de formularios (SPEC §14)", () => {
  it("un formulario sin cambios se cierra sin preguntar", () => {
    mount();
    openNew();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sessionStorage.getItem("critical.drafts")).toBeNull();
  });

  it("con cambios, Escape, ✕ y el fondo preguntan; Escape en la pregunta sigue editando", () => {
    mount();
    openNew();
    typeName("Parcial de Algebra");
    fireEvent.keyDown(document.body, { key: "Escape" });
    const ask = screen.getByRole("alertdialog", { name: "¿Descartar los cambios?" });
    expect(document.activeElement).toBe(
      within(ask).getByRole("button", { name: "Seguir editando" }),
    );
    // Escape inside the question is «Seguir editando»: the form and its text stay.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((screen.getByPlaceholderText("Parcial Física I") as HTMLInputElement).value).toBe(
      "Parcial de Algebra",
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Cerrar" })[0] as HTMLElement);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("«Descartar» cierra y borra el borrador", () => {
    mount();
    openNew();
    typeName("Algo");
    expect(sessionStorage.getItem("critical.drafts")).toContain("Algo");
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sessionStorage.getItem("critical.drafts")).toBeNull();
  });

  it("guardar borra el borrador", () => {
    mount();
    openNew();
    typeName("Entrega final");
    expect(sessionStorage.getItem("critical.drafts")).toContain("Entrega final");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sessionStorage.getItem("critical.drafts")).toBeNull();
  });

  it("recargar restaura el formulario abierto con lo escrito", () => {
    const first = mount();
    openNew();
    typeName("Parcial de Algebra");
    // A reload: the page is gone, the tab's sessionStorage is not.
    first.unmount();
    mount();
    expect(screen.getByRole("dialog", { name: "Nueva actividad" })).toBeTruthy();
    expect((screen.getByPlaceholderText("Parcial Física I") as HTMLInputElement).value).toBe(
      "Parcial de Algebra",
    );
  });
});
