import { Catalog } from "./views/Catalog";
import { Procedure } from "./views/Procedure";
import { Source } from "./views/Source";
import { Diff } from "./views/Diff";
import { Run } from "./views/Run";
import { RunPage, Runs } from "./views/History";
import { Governance } from "./views/Governance";
import { Server } from "./views/Server";
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
          <a href={href({ page: "runs" })}>history</a>
          <a href={href({ page: "governance" })}>governance</a>
        </nav>
        <a className="muted server-link" href={href({ page: "server" })}>{serverUrl() || "same origin"}</a>
      </header>
      <main>
        {route.page === "catalog" && <Catalog />}
        {route.page === "procedure" && <Procedure reference={route.ref} />}
        {route.page === "source" && <Source reference={route.ref} path={route.path} />}
        {route.page === "diff" && <Diff name={route.name} a={route.a} b={route.b} />}
        {route.page === "run" && <Run reference={route.ref} />}
        {route.page === "runs" && <Runs name={route.name} status={route.status} />}
        {route.page === "run-detail" && <RunPage id={route.id} />}
        {route.page === "governance" && <Governance name={route.name} />}
        {route.page === "server" && <Server />}
        {route.page === "missing" && <p className="error">No page at <code>{route.hash}</code>.</p>}
      </main>
    </>
  );
}
