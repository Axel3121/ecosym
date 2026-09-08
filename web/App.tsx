import { useEffect, useState } from "react";
import { inspectSourceFields } from "../src/world-form.ts";
import { loadWorld, type WorldLoadResult } from "./world-client.ts";
import "./App.css";

export function App() {
  const [result, setResult] = useState<WorldLoadResult>();
  useEffect(() => {
    const controller = new AbortController();
    void loadWorld({ signal: controller.signal }).then((loaded) => {
      if (!controller.signal.aborted) setResult(loaded);
    });
    return () => controller.abort();
  }, []);

  return <main aria-label="EcoSym">
    <h1>EcoSym</h1>
    {!result ? <p role="status">Loading stored world snapshot.</p>
      : result.kind === "cancelled" ? <p role="status">World snapshot read cancelled.</p>
      : result.kind === "failure" ? <p role="alert">World snapshot could not be read: {result.reason}{result.reason === "http" ? ` (${result.status})` : ""}.</p>
      : <>
        <p role="status">{result.form.places.length === 0 ? "No civilizations have been founded." : "Stored civilization declarations."}</p>
        <p>Declarations and collected evidence do not establish activity. No semantic terrain is inferred.</p>
        {result.form.places.map(({ declaration, sourcePicture }) => <section key={declaration.civilizationId}>
          <h2>{declaration.name}</h2>
          <details>
            <summary>Inspect stored declaration and source evidence</summary>
            <p>Body readability and mandate status are independent. An unreadable body is unknown, not empty.</p>
            <dl>
              {[{ label: "Schema version", values: [String(result.form.snapshot.schemaVersion)] },
                { label: "Stored declaration", values: [JSON.stringify(declaration)] },
                ...inspectSourceFields(sourcePicture, result.form.snapshot)].map((field) => <div key={field.label}>
                <dt>{field.label}</dt>
                {field.values.map((value, index) => <dd key={index}>{value}</dd>)}
              </div>)}
            </dl>
          </details>
        </section>)}
      </>}
  </main>;
}
