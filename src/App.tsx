import { Catalog } from "./views/Catalog";
import { Procedure } from "./views/Procedure";
import { Source } from "./views/Source";
import { Diff } from "./views/Diff";
import { Run } from "./views/Run";
import { serverUrl } from "./api/client";
import { href, useRoute } from "./router";

export function App() {
  const route = useRoute();
  return (
    <>
      <header>
        <a href={href({ page: "catalog" })}><strong>aip inspector</strong></a>
        <nav className="top-nav">
          <a href={href({ page: "catalog" })}>catalog</a>
          <a href={href({ page: "run" })}>run</a>
        </nav>
        <span className="muted">{serverUrl() || "same origin"}</span>
      </header>
      <main>
        {route.page === "catalog" && <Catalog />}
        {route.page === "procedure" && <Procedure reference={route.ref} />}
        {route.page === "source" && <Source reference={route.ref} path={route.path} />}
        {route.page === "diff" && <Diff name={route.name} a={route.a} b={route.b} />}
        {route.page === "run" && <Run reference={route.ref} />}
        {route.page === "missing" && <p className="error">No page at <code>{route.hash}</code>.</p>}
      </main>
    </>
  );
}
