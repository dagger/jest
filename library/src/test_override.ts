import * as jest from "@jest/globals";
import * as optl from "@opentelemetry/api";
import * as otr from "@otel-test-runner/instrumentation";
import formatTitle from "./format_title";
import { testTree } from "./test_tree";
import { runTestInsideSpan } from "./tracer";

function wrapTestFunction(
  originalFunction:
    | typeof jest.it
    | typeof jest.it.skip
    | typeof jest.it.only
    | typeof jest.it.todo
    | typeof jest.it.failing
    | typeof jest.it.concurrent
    | typeof jest.it.concurrent.only
    | typeof jest.it.concurrent.skip,
): any {
  return (name: string, fn: (...args: any[]) => any | Promise<any>, timeout?: number) => {
    const node = testTree[testTree.length - 1];
    return originalFunction(name, async function (this: any, ...args: any[]) {
      const parentCtx = node?.ctx ?? otr.injectTraceParentInContext();
      return await optl.context.with(
        parentCtx,
        async () => {
          if (fn === undefined) {
            // Create the span if the test is pending but simply do nothing
            return runTestInsideSpan(name, () => {});
          }

          return runTestInsideSpan(name, () => fn.apply(this, args));
        },
        timeout,
      );
    });
  };
}

function wrapIterableFunction(originalFunction: typeof baseTest): any {
  return (cases: Array<any>) => {
    return (title: string, fn: (...args: any[]) => any | Promise<any>, timeout?: number) => {
      return cases.map((row, index) => {
        const testTitle = formatTitle(title, row, index);

        if (Array.isArray(row)) {
          // Spread array items as individual args
          return originalFunction(testTitle, () => fn(...row), timeout);
        } else {
          // Pass non-array rows as a single arg
          return originalFunction(testTitle, () => fn(row), timeout);
        }
      });
    };
  };
}

const baseTest = wrapTestFunction(jest.it);

baseTest.skip = wrapTestFunction(jest.it.skip);
baseTest.skip.failing = wrapTestFunction(jest.it.skip.failing);
baseTest.skip.each = wrapIterableFunction(baseTest.skip);

baseTest.only = wrapTestFunction(jest.it.only);
baseTest.only.failing = wrapTestFunction(jest.it.only.failing);
baseTest.only.each = wrapIterableFunction(baseTest.only);

baseTest.todo = jest.it.todo;

baseTest.failing = wrapTestFunction(jest.it.failing);
baseTest.failing.each = wrapIterableFunction(baseTest.failing);

baseTest.concurrent = wrapTestFunction(jest.it.concurrent);
baseTest.concurrent.each = wrapIterableFunction(baseTest.concurrent);
baseTest.concurrent.only = wrapTestFunction(jest.it.concurrent.only);
baseTest.concurrent.skip = wrapTestFunction(jest.it.concurrent.skip);
baseTest.concurrent.only.each = wrapIterableFunction(baseTest.concurrent.only);
baseTest.concurrent.skip.each = wrapIterableFunction(baseTest.concurrent.skip);

baseTest.each = wrapIterableFunction(baseTest);

/**
 * @see https://jestjs.io/docs/api
 */
export const it: typeof jest.it = baseTest;

/**
 * @see https://jestjs.io/docs/api
 */
export const test: typeof jest.test = baseTest;
