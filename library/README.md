# Jest OTEL Test library

A wrapper around [`jest`](https://jestjs.io/) to automatically traces tests inside `dagger run` or `dagger call`.

### Installation

```shell
npm install @otel-test-runner/jest-test
```

### Usage

Update your `jest` configuration to load the `@otel-test-runner/jest-test` library.

```js
export default {
  testEnvironment: "node",
  injectGlobals: true,
  setupFilesAfterEnv: ["@otel-test-runner/jest-test/register"],
};
```

Then you can use jest as usual, your tests will automatically create spans.

```ts
it("single test", async () => {
  assert.strictEqual(1 + 1, 2);
});

describe("test suite", () => {
  it("hello world", () => {
    assert.strictEqual(1 + 1, 2);
  });
```

### Current support

- [x] `it|test`
- [x] `describe`
- [x] `it|test`.`skip|only|concurrent|todo|failing`
- [x] `describe`.`skip|only`
- [x] `it|test`.`concurrent`.`each|only.each|skip.each`
- [x] `it|test`.`skip|only`.`failing|each`
- [x] `describe`.`skip|only`.`each`
- [x] `each` function

### Dagger integration

You can automatically view your traces on Dagger Cloud with that library.

![dagger-cloud-view-example](./assets/dagger-cloud-view-example.png)
