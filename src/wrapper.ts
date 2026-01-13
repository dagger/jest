import type { Circus } from "@jest/types";
import type { Context, Span } from "@opentelemetry/api";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import type { TestEnvironment } from "jest-environment-node";

import { otelSDK } from "./otel";

const tracer = trace.getTracer("dagger.io/jest");

const JEST_ROOT_BLOCK_NAME = "ROOT_DESCRIBE_BLOCK";

// A function that take any jest environment and add otel instrumentation on existing tests.
export function wrapEnvironmentClass(BaseEnv: typeof TestEnvironment): any {
  return class OtelJestEnvironment extends BaseEnv {
    /////
    // Some private fields to store span and context so we can handle their
    // lifecycle synchronusly.
    /////

    _blockSpanAndContextByBlock = new WeakMap<Circus.DescribeBlock, { span: Span; ctx: Context }>();

    _testSpanByTest = new WeakMap<Circus.TestEntry, Span>();

    _originalFnByTest = new WeakMap<Circus.TestEntry, Circus.TestFn>();

    /////
    // TestEnvironment override
    /////

    /**
     * Start the otel SDK during the setup and
     * propagate symbol for correct context propagation.
     */
    async setup(): Promise<void> {
      await super.setup();

      otelSDK.start();

      // Bridge the OpenTelemetry API singleton into the Jest VM realm
      const apiKey = Symbol.for("opentelemetry.js.api.1");
      (this.global as any)[apiKey] = (globalThis as any)[apiKey];
    }

    /**
     * Handle Jest event to automatically instrument test.
     */
    async handleTestEvent(event: Circus.AsyncEvent): Promise<void> {
      // On test start, create a new span and wrap the test function inside
      // the test span context so any span created inside it will be correctly
      // nested.
      if (event.name === "test_start") {
        const ctx = this.getOrCreateContext(event.test.parent);

        const testSpan = tracer.startSpan(event.test.name, {}, ctx);
        this._testSpanByTest.set(event.test, testSpan);

        // Wrap the test function so any spans created in the test body are children
        // of the test span
        if (event.test && typeof event.test.fn === "function") {
          if (!this._originalFnByTest.has(event.test)) {
            this._originalFnByTest.set(event.test, event.test.fn);
          }

          const original = this._originalFnByTest.get(event.test);

          event.test.fn = function wrappedTestFn() {
            // Activate test span for the duration of the test body
            return context.with(trace.setSpan(ctx, testSpan), () => {
              return (original as any).apply(this, arguments);
            });
          };
        }
      }

      // On test end, record potential error, close span and set back
      // the original function.
      if (event.name === "test_done") {
        const span = this._testSpanByTest.get(event.test);

        if (span) {
          const hasErrors = event.test?.errors && event.test.errors.length > 0;
          if (hasErrors) {
            const err = this.firstJestError(event.test.errors);
            if (err) {
              span.recordException(err);
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: err.message,
              });
            } else {
              span.setStatus({ code: SpanStatusCode.ERROR });
            }
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }

          span.end();

          this._testSpanByTest.delete(event.test);
        }

        // Restore original test function (helps for retries or re-runs)
        const original = this._originalFnByTest.get(event.test);
        if (original) {
          event.test.fn = original;

          this._originalFnByTest.delete(event.test);
        }
      }

      // On block start, start a new span
      if (
        event.name === "run_describe_start" &&
        event.describeBlock.name !== JEST_ROOT_BLOCK_NAME
      ) {
        const ctx = this.getOrCreateContext(event.describeBlock.parent);
        const span = tracer.startSpan(event.describeBlock.name, {}, ctx);

        this._blockSpanAndContextByBlock.set(event.describeBlock, {
          span: span,
          ctx: trace.setSpan(ctx, span),
        });
      }

      // On block end, close the block's span
      if (event.name === "run_describe_finish") {
        const span = this._blockSpanAndContextByBlock.get(event.describeBlock)?.span;

        if (span) {
          span.end();
        }
      }
    }

    /**
     * Flush and shutdown the otel SDK on eading.
     */
    async teardown(): Promise<void> {
      try {
        await otelSDK.shutdown();
      } catch {
        console.warn("warning: failed to shutdown OTEL");
      } finally {
        super.teardown();
      }
    }

    //////
    // Utility functions
    //////

    /**
     * Unwrap the first Jest Error that triggered a test failure.
     */
    firstJestError(errors: any[]): Error | null {
      if (!errors || !errors.length) return null;

      const first = errors[0];
      if (Array.isArray(first)) {
        const [original, asyncErr] = first;
        if (original?.stack) return original;
        if (typeof original === "string") return new Error(original);

        return asyncErr || new Error("Unknown Jest error");
      }

      if (typeof first === "string") return new Error(first);

      return first;
    }

    /**
     * Create a context or return the one inside the parent if available.
     * This simplify context management when creating span for block/test.
     */
    getOrCreateContext(parent?: Circus.DescribeBlock) {
      // If no parent is detected, create a new context by calling context.active() that will
      // automatically add `TRACEPARENT` so it's correctly displayed on dagger cloud.
      if (!parent) {
        return context.active();
      }

      const ctx = this._blockSpanAndContextByBlock.get(parent)?.ctx;
      if (!ctx) {
        return context.active();
      }

      return ctx;
    }
  };
}
