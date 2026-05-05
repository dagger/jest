import { OtelSDK } from "@dagger.io/telemetry";
import type { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import type { Circus } from "@jest/types";
import type { Attributes, Context, Span } from "@opentelemetry/api";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import {
  ATTR_TEST_CASE_NAME,
  ATTR_TEST_CASE_RESULT_STATUS,
  ATTR_TEST_SUITE_NAME,
  ATTR_TEST_SUITE_RUN_STATUS,
  TEST_CASE_RESULT_STATUS_VALUE_FAIL,
  TEST_CASE_RESULT_STATUS_VALUE_PASS,
  TEST_SUITE_RUN_STATUS_VALUE_FAILURE,
  TEST_SUITE_RUN_STATUS_VALUE_IN_PROGRESS,
  TEST_SUITE_RUN_STATUS_VALUE_SUCCESS,
} from "@opentelemetry/semantic-conventions/incubating";
import type { TestEnvironment } from "jest-environment-node";

const tracer = trace.getTracer("dagger.io/jest");

const JEST_ROOT_BLOCK_NAME = "ROOT_DESCRIBE_BLOCK";
const ATTR_UI_BOUNDARY = "dagger.io/ui.boundary";

// A function that take any jest environment and add otel instrumentation on existing tests.
export function wrapEnvironmentClass(BaseEnv: typeof TestEnvironment): any {
  return class OtelJestEnvironment extends BaseEnv {
    /////
    // Some private fields to store span and context so we can handle their
    // lifecycle synchronusly.
    /////

    __testfile: string;

    /**
     * Top level context span created from the test filename.
     */
    __topLevelSpan?: Span;
    __topLevelContext?: Context;
    __topLevelStatus: "success" | "failure" = "success";

    _blockSpanAndContextByBlock = new WeakMap<
      Circus.DescribeBlock,
      { span: Span; ctx: Context; failed: boolean }
    >();

    _testSpanByTest = new WeakMap<Circus.TestEntry, Span>();

    _originalFnByTest = new WeakMap<Circus.TestEntry, Circus.TestFn>();

    _otelSDK = new OtelSDK();

    /////
    // TestEnvironment override
    /////

    constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
      super(config, context);

      /**
       * Save the test file to produce a root span for these tests named
       * after that file.
       */
      this.__testfile = context.testPath.substring(config.globalConfig.rootDir.length + 1);
    }

    /**
     * Start the otel SDK during the setup and
     * propagate symbol for correct context propagation.
     */
    async setup(): Promise<void> {
      await super.setup();

      this._otelSDK.start();

      // Bridge the OpenTelemetry API singleton into the Jest VM realm
      const apiKey = Symbol.for("opentelemetry.js.api.1");
      (this.global as any)[apiKey] = (globalThis as any)[apiKey];

      // Create a testspan and root context based on the test filename.
      this.__topLevelSpan = tracer.startSpan(
        this.__testfile,
        {
          attributes: {
            [ATTR_UI_BOUNDARY]: true,
            [ATTR_TEST_SUITE_NAME]: this.__testfile,
            [ATTR_TEST_SUITE_RUN_STATUS]: TEST_SUITE_RUN_STATUS_VALUE_IN_PROGRESS,
          },
        },
        context.active(),
      );
      this.__topLevelContext = trace.setSpan(context.active(), this.__topLevelSpan);
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

        const testSpan = tracer.startSpan(
          event.test.name,
          { attributes: this.testSpanAttributes(event.test) },
          ctx,
        );
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
            span.setAttribute(ATTR_TEST_CASE_RESULT_STATUS, TEST_CASE_RESULT_STATUS_VALUE_FAIL);

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

            this.setParentAsFailed(event.test.parent);
          } else {
            span.setAttribute(ATTR_TEST_CASE_RESULT_STATUS, TEST_CASE_RESULT_STATUS_VALUE_PASS);
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
        const span = tracer.startSpan(
          event.describeBlock.name,
          { attributes: this.testSuiteSpanAttributes(event.describeBlock) },
          ctx,
        );

        this._blockSpanAndContextByBlock.set(event.describeBlock, {
          span: span,
          ctx: trace.setSpan(ctx, span),
          failed: false,
        });
      }

      // On block end, close the block's span
      if (event.name === "run_describe_finish") {
        const _parent = this._blockSpanAndContextByBlock.get(event.describeBlock);

        if (_parent) {
          const span = _parent.span;
          span.setAttribute(
            ATTR_TEST_SUITE_RUN_STATUS,
            _parent.failed
              ? TEST_SUITE_RUN_STATUS_VALUE_FAILURE
              : TEST_SUITE_RUN_STATUS_VALUE_SUCCESS,
          );

          if (_parent.failed) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            this.setParentAsFailed(event.describeBlock.parent);
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }

          span.end();

          this._blockSpanAndContextByBlock.delete(event.describeBlock);
        }
      }
    }

    /**
     * Flush and shutdown the otel SDK on eading.
     */
    async teardown(): Promise<void> {
      try {
        // Set the status to ERROR if any of the test or test suite failed
        // and close the top level root span.
        this.__topLevelSpan?.setAttribute(
          ATTR_TEST_SUITE_RUN_STATUS,
          this.__topLevelStatus === "failure"
            ? TEST_SUITE_RUN_STATUS_VALUE_FAILURE
            : TEST_SUITE_RUN_STATUS_VALUE_SUCCESS,
        );

        if (this.__topLevelStatus === "failure") {
          this.__topLevelSpan?.setStatus({ code: SpanStatusCode.ERROR });
        } else {
          this.__topLevelSpan?.setStatus({ code: SpanStatusCode.OK });
        }
        this.__topLevelSpan?.end();

        await this._otelSDK.shutdown();
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
     * Return the attributes for a Jest test case span.
     */
    testSpanAttributes(test: Circus.TestEntry): Attributes {
      return {
        [ATTR_UI_BOUNDARY]: true,
        [ATTR_TEST_CASE_NAME]: this.testCaseName(test),
        [ATTR_TEST_SUITE_NAME]: this.testSuiteName(test.parent),
      };
    }

    /**
     * Return the attributes for a Jest describe block span.
     */
    testSuiteSpanAttributes(block: Circus.DescribeBlock): Attributes {
      return {
        [ATTR_UI_BOUNDARY]: true,
        [ATTR_TEST_SUITE_NAME]: this.testSuiteName(block),
        [ATTR_TEST_SUITE_RUN_STATUS]: TEST_SUITE_RUN_STATUS_VALUE_IN_PROGRESS,
      };
    }

    /**
     * Return the fully qualified test case name.
     */
    testCaseName(test: Circus.TestEntry): string {
      return `${this.testSuiteName(test.parent)}::${test.name}`;
    }

    /**
     * Return the fully qualified test suite name.
     */
    testSuiteName(block?: Circus.DescribeBlock): string {
      const names = [this.__testfile, ...this.describeBlockNames(block)];
      return names.join("::");
    }

    /**
     * Return describe block names from outermost to innermost.
     */
    describeBlockNames(block?: Circus.DescribeBlock): string[] {
      const names: string[] = [];
      let current = block;

      while (current && current.name !== JEST_ROOT_BLOCK_NAME) {
        names.unshift(current.name);
        current = current.parent;
      }

      return names;
    }

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
        return this.__topLevelContext || context.active();
      }

      const ctx = this._blockSpanAndContextByBlock.get(parent)?.ctx;
      if (!ctx) {
        return this.__topLevelContext || context.active();
      }

      return ctx;
    }

    /**
     * Set the parent block as failed so we propagate the error.
     */
    setParentAsFailed(parent?: Circus.DescribeBlock) {
      this.__topLevelStatus = "failure";

      if (!parent) {
        return;
      }

      const _parent = this._blockSpanAndContextByBlock.get(parent);
      if (_parent) {
        _parent.failed = true;
        this._blockSpanAndContextByBlock.set(parent, _parent);
      }
    }
  };
}
