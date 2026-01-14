import { trace } from "@opentelemetry/api";

test("test", async () => {
  trace.getTracer("test").startActiveSpan("hello inside test", (span) => {
    expect(1 + 1).toBe(2);
    span.end();
  });
});

it("it", async () => {
  expect(1 + 1).toBe(2);
});

describe("describe", () => {
  it("describe.it", () => {
    expect(1 + 1).toBe(2);
  });

  test("describe.test", () => {
    expect(1 + 1).toBe(2);
  });

  describe("describe.describe", () => {
    it("describe.describe.it", () => {
      expect(1 + 1).toBe(2);
    });

    test("describe.describe.test", () => {
      expect(1 + 1).toBe(2);
    });
    
    test("describe.describe.fail", () => {
      expect(1).toBe(2);
    });
  });
});

test.each([2, 3])("test.%s", async (value) => {
  trace
    .getTracer("test")
    .startActiveSpan("hello inside test: " + value, (span) => {
      try {
        expect(value).toBe(2);
      } finally {
        span.end();
      }
    });
});
