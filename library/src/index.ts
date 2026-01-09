import { afterAll } from "@jest/globals";
import * as otr from "@otel-test-runner/instrumentation";

/**
 * Initialiaze OTEL when this package is imported
 */
otr.initialize();

/**
 * Override jest.afterAll to call otr.close()
 */
afterAll(async () => {
  try {
    await otr.close();
  } catch {
    console.warn("[WARN] couldn't close otel client");
  }
});

import { describe } from "./describe_override";
/**
 * Export Jest bindings with automatic tracing.
 */
import { it, test } from "./test_override";

(globalThis as any).it = it;
(globalThis as any).test = test;
(globalThis as any).describe = describe;

// Optional: expose a symbol for debugging
(globalThis as any).__otelJestWrapped__ = true;
