import type { Context, Span } from "@opentelemetry/api";

export type TestTree = {
  name: string;
  parent?: TestTree;
  ctx?: Context;
  span?: Span;
};

export const testTree: TestTree[] = [];
