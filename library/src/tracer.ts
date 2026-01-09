import * as optl from "@opentelemetry/api";
import * as otr from "@otel-test-runner/instrumentation";

export const tracer = otr.getTracer("test-tracer/jest");

/**
 * Utility function to automatically inject `TRACEPARENT` if the span
 * is the root span. This is useful in the context of Dagger so traces
 * produced by the tests are displayed by the TUI and Dagger Cloud.
 *
 * If we are already in a span, then the newly created span must be children
 * if the parent.
 */
export async function runTestInsideSpan<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const currentCtx = optl.context.active();

  if (optl.trace.getSpan(currentCtx) === undefined) {
    return await optl.context.with(otr.injectTraceParentInContext(), async () => {
      return tracer.startActiveSpan(name, async () => fn());
    });
  }

  return tracer.startActiveSpan(name, async () => fn());
}
