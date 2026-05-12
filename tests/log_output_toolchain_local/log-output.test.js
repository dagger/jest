const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("OTel log routing example", () => {
  test("routes stdout and stderr to the first test", () => {
    console.log("[otel-log-routing:first] stdout from first test");
    console.error("[otel-log-routing:first] stderr from first test");

    expect(true).toBe(true);
  });

  test("routes async logs to the second test", async () => {
    console.log("[otel-log-routing:second] stdout before await");
    await delay(25);
    console.error("[otel-log-routing:second] stderr after await");

    expect(1 + 1).toBe(2);
  });

  describe("nested suite", () => {
    test("keeps nested test logs under the nested test", () => {
      console.log("[otel-log-routing:nested] stdout from nested test");

      expect("nested").toContain("nest");
    });
  });
});
