import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InviteGate } from "./App.js";
import { Connected } from "./Connected.js";
import { Invites } from "./components/Invites.js";
import { clearLocal } from "./offline.js";
import { session, stubApi } from "./testing.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  localStorage.clear();
  await clearLocal();
});

/** A database with an invite list; `owner` says whether the caller owns the app. */
function client(owner: boolean) {
  let invites = ["ana@gmail.com"];
  const ok = Promise.resolve({ data: [], error: null });
  const from = (table: string) => ({
    select: () => {
      if (table === "invites") {
        const list = () =>
          Promise.resolve({ data: invites.map((email) => ({ email })), error: null });
        return { order: list };
      }
      return Object.assign(ok, {
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      });
    },
    upsert: (row: { email?: string }) => {
      if (table === "invites" && row.email) invites = [...invites, row.email];
      return Promise.resolve({ error: null });
    },
    insert: () => Promise.resolve({ error: null }),
    delete: () => ({
      in: () => Promise.resolve({ error: null }),
      eq: (_c: string, v: string) => {
        invites = invites.filter((e) => e !== v);
        return Promise.resolve({ error: null });
      },
    }),
  });
  const rpc = async (name: string) => ({ data: name === "is_owner" ? owner : null, error: null });
  stubApi(vi.fn(async () => ({ data: { connected: true }, error: null })));
  return { from, rpc, auth: session } as never;
}

describe("invitations", () => {
  it("lets the owner invite and remove emails", async () => {
    render(
      <Connected client={client(true)} session={{ user: { id: "owner" } } as never}>
        <Invites />
      </Connected>,
    );
    expect(await screen.findByText("ana@gmail.com")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Email a invitar"), {
      target: { value: "  Beto@Gmail.com " },
    });
    fireEvent.click(screen.getByText("Invitar"));
    expect(await screen.findByText("beto@gmail.com")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Email a invitar"), { target: { value: "nope" } });
    fireEvent.click(screen.getByText("Invitar"));
    expect(await screen.findByText("Ese email no parece válido.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Quitar ana@gmail.com"));
    await waitFor(() => expect(screen.queryByText("ana@gmail.com")).toBeNull());
  });

  it("is hidden for everyone else", async () => {
    render(
      <Connected client={client(false)} session={{ user: { id: "friend" } } as never}>
        <Invites />
      </Connected>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Invitaciones")).toBeNull();
  });
});

describe("invite gate", () => {
  const gate = (answer: unknown, error: unknown = null) => {
    const signOut = vi.fn();
    const rpc = vi.fn(async () => ({ data: answer, error }));
    render(
      <InviteGate
        client={{ rpc } as never}
        session={{ user: { id: "x", email: "otro@gmail.com" } } as never}
        onSignOut={signOut}
      >
        <p>la app</p>
      </InviteGate>,
    );
    return { signOut, rpc };
  };

  it("tells an account that is not invited, and lets it sign out", async () => {
    const { signOut } = gate({ invited: false, owner: false });
    expect(await screen.findByText("Esta app es por invitación.")).toBeTruthy();
    expect(screen.queryByText("la app")).toBeNull();
    expect(screen.getByText(/otro@gmail.com no está invitado/)).toBeTruthy();
    fireEvent.click(screen.getByText("Salir"));
    expect(signOut).toHaveBeenCalled();
  });

  it("opens the app for invited accounts, and when the answer cannot be had", async () => {
    const { rpc } = gate({ invited: true, owner: false });
    expect(screen.getByText("la app")).toBeTruthy();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("my_access"));
    cleanup();
    gate(null, { message: "Failed to fetch" });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("la app")).toBeTruthy();
  });
});
