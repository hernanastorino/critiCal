import { checkFeasibility } from "@critical/engine";

const engineReady = checkFeasibility(
  [{ id: "probe", deadline: 1, minRemaining: 0 }],
  () => 0,
).feasible;

export function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>critiCal</h1>
      <p data-testid="engine-status">Motor: {String(engineReady && "listo")}</p>
    </main>
  );
}
