# Jest OpenTelemetry auto instruentation

Automatically instrument Jest tests for open telemetry.

### Installation

Install `@dagger.io/jest` in your project

```shell
npm install @dagger.io/jest
```

### Setup

You can either follow a no-configuration setup or update your current `jest.config.js` file.

#### No configuration setup

Add the following import in your `NODE_OPTIONS` to auto-instrument when running your test

```shell
 "NODE_OPTIONS=\"$NODE_OPTIONS --register @dagger.io/jest/register \" jest
```

:bulb: If your project is in ESM, make sure you first followed [ECMAScript Module setup on Jest](https://jestjs.io/docs/ecmascript-modules)

#### Jest config setup

:warning: This setup may not work if you already have custom environment, if so please follow the
no configuration setup that can take any environment.

The library export an environment that you can use to automatically instrument your tests:

```json
testEnvironment: "@dagger.io/jest/node-environment"
```
