import { format } from "node:util";
import { OtelSDK } from "@dagger.io/telemetry";
import type { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import type { Circus } from "@jest/types";
import type { Attributes, Context, Span } from "@opentelemetry/api";
import { context, isSpanContextValid, SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
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

__prepareLogExporterEnv();

const JEST_ROOT_BLOCK_NAME = "ROOT_DESCRIBE_BLOCK";
const ATTR_UI_BOUNDARY = "dagger.io/ui.boundary";
const STDIO_STREAM_ATTR = "stdio.stream";
const STDIO_STREAM_STDOUT = 1;
const STDIO_STREAM_STDERR = 2;
const __PATCHED_CONSOLE_METHOD = Symbol.for("dagger.io/jest.console.telemetry");
let __emittingConsoleTelemetry = false;

type ConsoleMethodName = "debug" | "error" | "info" | "log" | "warn";
type ConsoleStream = "stderr" | "stdout";

function __prepareLogExporterEnv(): void {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    __setEnvIfUnset(
      "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
      __logEndpoint(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT),
    );
  }

  __setEnvIfUnset(
    "OTEL_EXPORTER_OTLP_LOGS_PROTOCOL",
    process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? process.env.OTEL_EXPORTER_OTLP_PROTOCOL,
  );
}

function __setEnvIfUnset(name: string, value?: string): void {
  if (process.env[name] === undefined && value !== undefined) {
    process.env[name] = value;
  }
}

function __logEndpoint(endpoint?: string): string | undefined {
  const logEndpoint = endpoint?.replace(/\/v1\/traces\/?$/, "/v1/logs");
  return logEndpoint !== endpoint ? logEndpoint : undefined;
}

function __tracer() {
  return trace.getTracer("dagger.io/jest");
}

function __logger() {
  return logs.getLogger("dagger.io/jest");
}

function __consoleTypeStream(type: string): ConsoleStream | undefined {
  if (type === "error" || type === "warn") {
    return "stderr";
  }
  if (type === "debug" || type === "info" || type === "log") {
    return "stdout";
  }
  return undefined;
}

function __emitConsoleTelemetry(stream: ConsoleStream, body: string): void {
  if (__emittingConsoleTelemetry) {
    return;
  }

  const activeContext = context.active();
  const activeSpan = trace.getSpan(activeContext);
  if (!activeSpan || !isSpanContextValid(activeSpan.spanContext())) {
    return;
  }

  __emittingConsoleTelemetry = true;
  try {
    __logger().emit({
      timestamp: Date.now(),
      observedTimestamp: Date.now(),
      severityNumber: stream === "stderr" ? SeverityNumber.ERROR : SeverityNumber.INFO,
      severityText: stream === "stderr" ? "ERROR" : "INFO",
      body,
      attributes: {
        [STDIO_STREAM_ATTR]: stream === "stderr" ? STDIO_STREAM_STDERR : STDIO_STREAM_STDOUT,
      },
      context: activeContext,
    });
  } catch {
    // Do not let telemetry log emission affect the test run.
  } finally {
    __emittingConsoleTelemetry = false;
  }
}

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

      this.patchConsoleTelemetry();

      // Create a testspan and root context based on the test filename.
      this.__topLevelSpan = __tracer().startSpan(
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
        this.patchConsoleTelemetry();

        const ctx = this.getOrCreateContext(event.test.parent);

        const testSpan = __tracer().startSpan(
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
        const span = __tracer().startSpan(
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

    patchConsoleTelemetry(): void {
      const testConsole = (this.global as any).console;
      if (!testConsole) {
        return;
      }

      if (this.patchBufferedConsole(testConsole)) {
        return;
      }

      if (this.patchJestConsole(testConsole)) {
        return;
      }

      this.patchConsoleMethod(testConsole, "debug", "stdout");
      this.patchConsoleMethod(testConsole, "info", "stdout");
      this.patchConsoleMethod(testConsole, "log", "stdout");
      this.patchConsoleMethod(testConsole, "warn", "stderr");
      this.patchConsoleMethod(testConsole, "error", "stderr");
    }

    patchBufferedConsole(testConsole: any): boolean {
      const consoleCtor = testConsole.constructor as
        | { write?: ((...args: any[]) => any) & { [__PATCHED_CONSOLE_METHOD]?: boolean } }
        | undefined;
      const current = consoleCtor?.write;

      if (!consoleCtor || typeof current !== "function") {
        return false;
      }
      if (current[__PATCHED_CONSOLE_METHOD]) {
        return true;
      }

      const patched = function patchedBufferedConsoleWrite(this: any, ...args: any[]) {
        const [, type, message] = args;
        const stream = __consoleTypeStream(String(type));
        if (stream) {
          __emitConsoleTelemetry(
            stream,
            `${typeof message === "string" ? message : format(message)}\n`,
          );
        }
        return current.apply(this, args);
      } as typeof current;

      patched[__PATCHED_CONSOLE_METHOD] = true;
      consoleCtor.write = patched;
      return true;
    }

    patchJestConsole(testConsole: any): boolean {
      let patched = false;
      patched = this.patchJestConsoleMethod(testConsole, "_log", "stdout") || patched;
      patched = this.patchJestConsoleMethod(testConsole, "_logError", "stderr") || patched;
      return patched;
    }

    patchJestConsoleMethod(
      testConsole: any,
      method: string,
      fallbackStream: ConsoleStream,
    ): boolean {
      const current = testConsole[method] as
        | (((...args: any[]) => any) & {
            [__PATCHED_CONSOLE_METHOD]?: boolean;
          })
        | undefined;

      if (typeof current !== "function") {
        return false;
      }
      if (current[__PATCHED_CONSOLE_METHOD]) {
        return true;
      }

      const patched = function patchedJestConsoleMethod(this: any, ...args: any[]) {
        const [type, message] = args;
        const stream = __consoleTypeStream(String(type)) ?? fallbackStream;
        __emitConsoleTelemetry(
          stream,
          `${typeof message === "string" ? message : format(message)}\n`,
        );
        return current.apply(this, args);
      } as typeof current;

      patched[__PATCHED_CONSOLE_METHOD] = true;
      testConsole[method] = patched;
      return true;
    }

    patchConsoleMethod(testConsole: any, method: ConsoleMethodName, stream: ConsoleStream): void {
      const current = testConsole[method] as
        | (((...args: any[]) => void) & { [__PATCHED_CONSOLE_METHOD]?: boolean })
        | undefined;

      if (typeof current !== "function" || current[__PATCHED_CONSOLE_METHOD]) {
        return;
      }

      const original = current.bind(testConsole);
      const patched = ((...args: any[]) => {
        __emitConsoleTelemetry(stream, `${format(...args)}\n`);
        return original(...args);
      }) as typeof current;

      patched[__PATCHED_CONSOLE_METHOD] = true;
      testConsole[method] = patched;
    }

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
