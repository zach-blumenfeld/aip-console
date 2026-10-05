import { useEffect, useState } from "react";

// Hash routes, so the bundle serves from one path under `aip server --inspector`
// with no fallback rule:  #/            catalog
//                         #/p/<ref>     procedure page, ref = name or name@rev
export type Route = { page: "catalog" } | { page: "procedure"; ref: string } | { page: "missing"; hash: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/^\/+/, "");
  if (path === "") return { page: "catalog" };
  const m = /^p\/([^/]+)$/.exec(path);
  if (m) return { page: "procedure", ref: decodeURIComponent(m[1]) };
  return { page: "missing", hash };
}

export function href(route: Route): string {
  switch (route.page) {
    case "catalog": return "#/";
    case "procedure": return `#/p/${encodeURIComponent(route.ref)}`;
    case "missing": return route.hash;
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
