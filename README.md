# Jest Dagger Toolchain

## Installation

```
dagger toolchain install github.com/dagger/jest
```

## Functions

- `projects`: List the Jest projects visible from the current directory
- `testAll`: Execute the tests of every visible project (the automatic check)
- `test`: Execute the tests of a single project
- `list`: List the tests of a single project

## Project discovery

Discovery is anchored at the directory you run Dagger from, not at the workspace
root: `dagger check` tests the project you are in and the projects beneath it. A
project is any directory holding a `jest.config.*` file (`node_modules`
excluded); a `jest` key in `package.json` also configures Jest, but
`package.json` marks every npm package, so it is not a discovery marker.

```bash
# from the workspace root of a monorepo holding a/ and b/
dagger call jest projects   # -> a, b

# from a/
dagger call jest projects   # -> .
```

A directory holding no config of its own sits inside its enclosing project, so
that project is reported as a `..`-relative path and runs too. To run a single
project, enter it.

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

Automatically instrument Jest tests for Open Telemetry.

The toolchain does this automatically, however you can use the library without the toolchain as described below.

### Span attributes

Test spans include `dagger.io/ui.boundary` plus OpenTelemetry test semantic convention attributes: `test.case.name`, `test.case.result.status`, and `test.suite.name`.

Suite spans include `dagger.io/ui.boundary`, `test.suite.name`, and `test.suite.run.status`.

### Test output

Console output emitted with `console.log`, `console.info`, `console.debug`, `console.warn`,
and `console.error` is exported as OpenTelemetry logs on the active test span.

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

:warning: This setup may not work if you already have custom environment. If so please follow the
no configuration setup that can take any environment.

The library export an environment that you can use to automatically instrument your tests:

```json
testEnvironment: "@dagger.io/jest/node-environment"
```
