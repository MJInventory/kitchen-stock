import { createOrderingDisplayState } from "./controller-display-state.js";
import { createOrderingDisplayRender } from "./controller-display-render.js";

export function createOrderingDisplayController(options) {
  const state = createOrderingDisplayState(options);
  const render = createOrderingDisplayRender({
    ...options,
    ...state
  });

  return {
    ...state,
    ...render
  };
}
