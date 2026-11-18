import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Loading } from "./components/Loading.js";
import { RoyLine } from "./components/Roy.js";

describe("Roy at twice the size where there is room", () => {
  afterEach(cleanup);

  it("RoyLine big stacks Roy over the text and doubles him", () => {
    const small = render(<RoyLine anim="puente">texto</RoyLine>).container;
    const smallHeight = Number.parseInt((small.querySelector(".roy") as HTMLElement).style.height);
    cleanup();
    const { container } = render(
      <RoyLine anim="puente" big>
        texto
      </RoyLine>,
    );
    expect(container.querySelector(".roy-line.big")).toBeTruthy();
    const height = Number.parseInt((container.querySelector(".roy") as HTMLElement).style.height);
    expect(height).toBeGreaterThan(smallHeight);
  });

  it("an inline wait can be large, and stays small by default", () => {
    const { container, rerender } = render(<Loading kind="sync" inline />);
    expect(container.querySelector(".loading.large")).toBeNull();
    rerender(<Loading kind="sync" inline large />);
    expect(container.querySelector(".loading.inline.large")).toBeTruthy();
  });
});
