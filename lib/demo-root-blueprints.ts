import type { RootBlueprint } from "./demo-blueprint-types";
import { ROOT_BLUEPRINTS_A } from "./demo-root-blueprints-a";
import { ROOT_BLUEPRINTS_B } from "./demo-root-blueprints-b";

export const ROOT_BLUEPRINTS: Record<string, RootBlueprint> = {
  ...ROOT_BLUEPRINTS_A,
  ...ROOT_BLUEPRINTS_B,
};
