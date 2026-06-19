import { buildPageRouteDefinitions } from "./page-route-definitions.js";

function normalizeAliases(pathname, aliases = []) {
  return [pathname, ...aliases];
}

export function createPageRouteBuilder(helpers) {
  const routeMap = new Map();
  let routeMapPromise = null;

  async function getRouteMap() {
    if (routeMapPromise) return routeMapPromise;
    routeMapPromise = (async () => {
      const routeDefinitions = await buildPageRouteDefinitions(helpers);
      for (const route of routeDefinitions) {
        for (const alias of normalizeAliases(route.path, route.aliases)) {
          routeMap.set(alias, route);
        }
      }
      return routeMap;
    })();
    return routeMapPromise;
  }

  return async function buildPageRoute(url) {
    const pathname = new URL(url, "http://localhost").pathname;
    const resolvedRouteMap = await getRouteMap();
    const route = resolvedRouteMap.get(pathname);
    if (!route) return null;
    return {
      view: route.view,
      options: route.options
    };
  };
}
