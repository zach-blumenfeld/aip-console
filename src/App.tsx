import { Catalog } from "./views/Catalog";
import { Procedure } from "./views/Procedure";
import { serverUrl } from "./api/client";
import { href, useRoute } from "./router";

export function App() {
  const route = useRoute();
  return (
    <>
      <header>
        <a href={href({ page: "catalog" })}><strong>aip inspector</strong></a>
        <span className="muted">{serverUrl() || "same origin"}</span>
      </header>
      <main>
        {route.page === "catalog" && <Catalog />}
        {route.page === "procedure" && <Procedure reference={route.ref} />}
        {route.page === "missing" && <p className="error">No page at <code>{route.hash}</code>.</p>}
      </main>
    </>
  );
}
