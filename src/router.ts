import { useEffect, useState } from "react";

// Hash routes, so the bundle serves from one path under `aip server --inspector`
// with no fallback rule:  #/                          catalog
//                         #/p/<ref>                   procedure page, ref = name or name@rev
//                         #/p/<ref>/files[/<path>]    source: the manifest, and one file open
//                         #/p/<name>/diff[/<a>..<b>]  diff between two revisions of name
//                         #/run[/<ref>]               run console: pick a procedure, then drive it
export type Route =
  | { page: "catalog" }
  | { page: "procedure"; ref: string }
  | { page: "source"; ref: string; path?: string }
  | { page: "diff"; name: string; a?: string; b?: string }
  | { page: "run"; ref?: string }
  | { page: "missing"; hash: string };

const decodePath = (p: string) => p.split("/").map(decodeURIComponent).join("/");
const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/^\/+/, "");
  if (path === "") return { page: "catalog" };
  let m = /^p\/([^/]+)$/.exec(path);
  if (m) return { page: "procedure", ref: decodeURIComponent(m[1]) };
  m = /^p\/([^/]+)\/files(?:\/(.+))?$/.exec(path);
  if (m) return { page: "source", ref: decodeURIComponent(m[1]), path: m[2] ? decodePath(m[2]) : undefined };
  m = /^p\/([^/@]+)\/diff(?:\/([^.]+)\.\.([^.]+))?$/.exec(path);
  if (m) {
    return { page: "diff", name: decodeURIComponent(m[1]),
             a: m[2] ? decodeURIComponent(m[2]) : undefined, b: m[3] ? decodeURIComponent(m[3]) : undefined };
  }
  m = /^run(?:\/([^/]+))?$/.exec(path);
  if (m) return { page: "run", ref: m[1] ? decodeURIComponent(m[1]) : undefined };
  return { page: "missing", hash };
}

export function href(route: Route): string {
  switch (route.page) {
    case "catalog": return "#/";
    case "procedure": return `#/p/${encodeURIComponent(route.ref)}`;
    case "source":
      return `#/p/${encodeURIComponent(route.ref)}/files${route.path ? "/" + encodePath(route.path) : ""}`;
    case "diff": {
      const pair = route.a && route.b ? `/${encodeURIComponent(route.a)}..${encodeURIComponent(route.b)}` : "";
      return `#/p/${encodeURIComponent(route.name)}/diff${pair}`;
    }
    case "run": return `#/run${route.ref ? "/" + encodeURIComponent(route.ref) : ""}`;
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
