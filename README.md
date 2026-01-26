# Jest Dagger Toolchain

## Installation

```
dagger toolchain install github.com/dagger/jest
```

## Functions

- `test`: Execute the tests
- `list`: List the tests

## Customization

The toolchain can be customized in your `dagger.json` to meet your needs:

```json
{
  "name": "my-module",
  "engineVersion": "...",
  "toolchains": [
    {
      "name": "jest",
      "source": "github.com/dagger/jest@main",
      "pin": "...",
      "customizations": [
        {
          "argument": "source",
          "defaultPath": "/src",         # default: /; custom default path
          "ignore": ["**/node_modules"]  # custom ignore filter
        },
        {
          "argument": "baseImageAddress",
          "default": "node:22"       # default: node:25-alpine; use any container image 
        },
        {
          "argument": "packageManager",
          "default": "yarn"          # default: npm; alternatively use yarn, pnpm, or bun
        },
        {
          "function": ["test"],
          "argument": "files",
          "default": ["Test1.js", "Test2.js"]   # default: [] (all); List of files to test
        },
        {
          "function": ["test"],
          "argument": "build",
          "default": true   # default: false; Run build before test
        },
        {
          "function": ["test"],
          "argument": "useEnv",
          "default": true   # default: false; Use jest-defined environment
        },
        {
          "function": ["test"],
          "argument": "flags",
          "default": ["--debug"]   # default: []; Flags to pass to jest
        }
      ]
    }
  ]
}
```

## Jest OpenTelemetry auto instrumentation

Automatically instrument Jest tests for open telemetry.

The toolchain does this automatically, however you can use the library without the toolchain as described below.

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
 "NODE_OPTIONS=\"$NODE_OPTIONS --require @dagger.io/jest/register \" jest
```

:bulb: If your project is in ESM, make sure you first followed [ECMAScript Module setup on Jest](https://jestjs.io/docs/ecmascript-modules)

#### Jest config setup

:warning: This setup may not work if you already have custom environment, if so please follow the
no configuration setup that can take any environment.

The library export an environment that you can use to automatically instrument your tests:

```json
testEnvironment: "@dagger.io/jest/node-environment"
```
