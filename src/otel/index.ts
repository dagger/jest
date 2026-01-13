// TODO: rely on `@dagger.io/telemetry` instead

import type { Context } from "@opentelemetry/api";
import { propagation, ROOT_CONTEXT } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor, type Span } from "@opentelemetry/sdk-trace-base";

/**
 * Live span processor implementation.
 *
 * It's a BatchSpanProcessor whose on_start calls on_end on the underlying
 * SpanProcessor in order to send live telemetry.
 */
class LiveProcessor extends BatchSpanProcessor {
  override onStart(_span: Span, _parentContext: Context): void {
    this.onEnd(_span);
  }
}

/**
 * Context manager to automatically add `TRACEPARENT` when using the dagger otel
 * instrumentation library.
 */
class DaggerContextManager extends AsyncLocalStorageContextManager {
  active() {
    const ctx = super.active();

    if (ctx === ROOT_CONTEXT) {
      return propagation.extract(ROOT_CONTEXT, {
        traceparent: process.env.TRACEPARENT,
      });
    }

    return ctx;
  }
}

/**
 * Batch span processor scheduler delays.
 * We set to 100ms so it's almost live.
 */
const NEARLY_IMMEDIATE = 100;

const exporter = new OTLPTraceExporter();
const processor = new LiveProcessor(exporter, {
  scheduledDelayMillis: NEARLY_IMMEDIATE,
});

/**
 * Create the OTEL Node SDK object but do not initialize it yet.
 *
 */
export const otelSDK = new NodeSDK({
  spanProcessors: [processor],
  contextManager: new DaggerContextManager(),
});
