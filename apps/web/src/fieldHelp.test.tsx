// SPEC §14, «Formularios»: a short help line under the fields whose meaning is not obvious,
// tied to the field with aria-describedby (next to its error, when it has one).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Field } from "./components/fields.js";
import { RuleSettings } from "./components/Preferences.js";
import { ToastProvider } from "./components/Toast.js";
import { emptyData } from "./demo.js";
import { StoreProvider } from "./store.js";

afterEach(cleanup);

const described = (input: HTMLElement) =>
  (input.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent);

describe("ayuda bajo los campos", () => {
  it("un campo con ayuda la tiene asociada, y su error va antes", () => {
    const { rerender } = render(
      <Field label="Margen" help="Se suma al traslado." value="10" onChange={() => {}} />,
    );
    expect(described(screen.getByLabelText(/Margen/))).toEqual(["Se suma al traslado."]);
    rerender(
      <Field label="Margen" help="Se suma al traslado." value="x" invalid onChange={() => {}} />,
    );
    const ids =
      screen
        .getByLabelText(/Margen/)
        .getAttribute("aria-describedby")
        ?.split(" ") ?? [];
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe("week-error");
  });

  it("sin ayuda ni error el campo no se describe por nada", () => {
    render(<Field label="Margen" value="10" onChange={() => {}} />);
    expect(screen.getByLabelText("Margen").getAttribute("aria-describedby")).toBeNull();
  });

  it("las reglas explican el margen y el máximo de materias", () => {
    render(
      <ToastProvider>
        <StoreProvider initial={emptyData} persist={false}>
          <RuleSettings />
        </StoreProvider>
      </ToastProvider>,
    );
    expect(described(screen.getByLabelText(/Margen antes de cada evento/))[0]).toMatch(/traslado/);
    expect(described(screen.getByLabelText(/Máximo de materias/))[0]).toMatch(/materias/);
  });
});
