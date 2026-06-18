import { createOrderingBootstrapContext } from "./bootstrap-context.js";
import { wireOrderingPage } from "./page-wiring.js";

export function startOrderingPage({ window = globalThis.window, document = globalThis.document, localStorage = globalThis.localStorage } = {}) {
  const context = createOrderingBootstrapContext({ window, document, localStorage });
  wireOrderingPage({ window, document, localStorage, ...context });
}
