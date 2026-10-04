import { Catalog } from "./views/Catalog";
import { serverUrl } from "./api/client";

export function App() {
  return (
    <>
      <header>
        <strong>aip inspector</strong>
        <span className="muted">{serverUrl() || "same origin"}</span>
      </header>
      <main>
        <Catalog />
      </main>
    </>
  );
}
