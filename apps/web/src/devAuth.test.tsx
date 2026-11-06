import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevLogin } from "./App.js";
import { fakeProviders, isLocalSupabase, localDev } from "./devAuth.js";

afterEach(cleanup);

describe("local test account", () => {
  it("only counts a Supabase on this machine as local", () => {
    expect(isLocalSupabase("http://127.0.0.1:55321")).toBe(true);
    expect(isLocalSupabase("http://localhost:55321")).toBe(true);
    expect(isLocalSupabase("https://abc.supabase.co")).toBe(false);
    expect(isLocalSupabase("::")).toBe(false);
    expect(isLocalSupabase(undefined)).toBe(false);
    // Tests run without a local Supabase configured: no form, no invented providers.
    expect(localDev).toBe(false);
    expect(fakeProviders).toBe(false);
  });

  function fill(signIn: ReturnType<typeof vi.fn>) {
    render(<DevLogin client={{ auth: { signInWithPassword: signIn } } as never} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: " yo@x.test " } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "clave" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar con la cuenta de prueba" }));
  }

  it("signs in with email and password", async () => {
    const signIn = vi.fn(async () => ({ error: null }));
    fill(signIn);
    expect(signIn).toHaveBeenCalledWith({ email: "yo@x.test", password: "clave" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Entrar con la cuenta de prueba" })).toBeTruthy(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says where the credentials are when they are wrong", async () => {
    fill(vi.fn(async () => ({ error: new Error("Invalid login credentials") })));
    expect((await screen.findByRole("alert")).textContent).toMatch(/supabase\/seed\.sql/);
  });

  it("says to start Supabase when it cannot be reached", async () => {
    fill(vi.fn(async () => Promise.reject(new Error("Failed to fetch"))));
    expect((await screen.findByRole("alert")).textContent).toMatch(/supabase start/);
  });
});
