import { useCallback, useEffect, useState } from "react";
import { useSync } from "../Connected.js";
import { errorMessage } from "../monitoring.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The owner's list of invited emails (the app is invitation only). Hidden for everyone else. */
export function Invites() {
  const sync = useSync();
  const client = sync?.client;
  const [owner, setOwner] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const { data, error } = await client.from("invites").select("email").order("email");
    if (error) setError(errorMessage(error));
    else setEmails((data as { email: string }[]).map((r) => r.email));
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    // Unanswered (offline, or a database without invitations yet): stays hidden.
    void Promise.resolve()
      .then(() => client.rpc("is_owner"))
      .then(({ data }) => {
        if (cancelled || data !== true) return;
        setOwner(true);
        void load();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, load]);

  if (!client || !owner) return null;

  const add = async () => {
    const value = email.trim().toLowerCase();
    if (!EMAIL.test(value)) {
      setError("Ese email no parece válido.");
      return;
    }
    setError(null);
    const { error } = await client.from("invites").upsert({ email: value });
    if (error) return setError(errorMessage(error));
    setEmail("");
    await load();
  };

  const remove = async (value: string) => {
    const { error } = await client.from("invites").delete().eq("email", value);
    if (error) return setError(errorMessage(error));
    await load();
  };

  return (
    <details className="card prefs">
      <summary className="title">Invitaciones</summary>
      <p className="meta">
        Solo estos emails de Google pueden usar critiCal. Quien entre sin estar en la lista ve que
        la app es por invitación. Quitar a alguien le corta el acceso y la sincronización.
      </p>
      {emails.map((e) => (
        <div key={e} className="check">
          <span style={{ flex: 1 }}>{e}</span>
          <button type="button" aria-label={`Quitar ${e}`} onClick={() => void remove(e)}>
            ✕
          </button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <input
          type="email"
          inputMode="email"
          autoCapitalize="none"
          aria-label="Email a invitar"
          placeholder="amigo@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="button" className="btn small" onClick={() => void add()}>
          Invitar
        </button>
      </div>
      {error && <p className="meta">{error}</p>}
    </details>
  );
}
