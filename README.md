# Jest Dagger Toolchain

## Installation

```
dagger install github.com/dagger/jest
```

Requires Dagger engine `v1.0.0-beta.15` or later.

## Projects and test files

`projects` returns the Jest projects visible from the directory you run Dagger
from, as a collection keyed by project root. Each project's test files are a
collection too, keyed by path relative to the project. `dagger check` runs one
check per project, `jest/projects/tests/test`, over the selected test files:

```console
$ dagger list jest-projects
$ dagger list jest-test-files --jest-project=web
$ dagger check -l --all --jest -f=cli            # one line per test file, as flags to reuse
$ dagger check --jest                            # every visible project
$ dagger check --jest --jest-project=web         # one project
$ dagger check --jest --jest-project=web --jest-test-file=src/App.test.jsx
$ dagger check jest/projects/tests/test --jest-test-file=src/App.test.jsx
```

With every test file of a project selected, the check runs `npx jest` in the
project with no file arguments, so Jest's own configuration decides what runs.
With some filtered out, it runs `npx jest --runTestsByPath <files>` over the
selected files only.

On a project: `test` (run all its tests; a plain function, not a check, so
`dagger check` does not run them twice), `tests`, `list` (`jest --listTests`)
and `source`. The `projects` collection also has a batch `test` that runs every
selected project and lists each failing one by path.

### Project discovery

Discovery is anchored at the directory you run Dagger from: `dagger check`
tests the project you are in and the projects beneath it. A project is any
directory holding a `jest.config.*` file (`node_modules` excluded); a `jest` key
in `package.json` also configures Jest, but `package.json` marks every npm
package, so it is not a discovery marker.

A directory holding no config of its own sits inside its enclosing project, so
that project is included too. Project keys are always relative to the
workspace root, wherever you stand:

```console
# a monorepo holding a/ and b/
$ dagger list jest-projects        # -> a, b
$ cd a && dagger list jest-projects  # -> a
```

### Test file discovery

Test files are found by matching the workspace against Jest's default
`testMatch` (`**/__tests__/**/*.[jt]s?(x)` and
`**/?(*.)+(spec|test).[jt]s?(x)`, with the `.mjs`/`.cjs`/`.mts`/`.cts`
variants), so listing them runs no container. `node_modules`, the project's
`dist` and `build` directories and nested Jest projects are left out.

The project's Jest configuration is not evaluated: a custom `testMatch`,
`testRegex`, `roots` or `testPathIgnorePatterns` in a JavaScript config is not
seen. A file that Jest's config excludes may still be listed, and selecting it
alone runs nothing. A test that only a custom `testMatch` finds is not listed,
but still runs whenever the whole project runs. A project in which no test file
matches the default pattern reports no test files, so `dagger check` does not
run it; call its `test` function instead.

## Settings

Configure the toolchain in your workspace `dagger.toml`:

```toml
[modules.jest.settings]
baseImageAddress = "node:22"   # default: node:25-alpine; use any container image
packageManager = "yarn"        # default: npm; alternatively use yarn, pnpm, or bun
build = true                   # default: false; run the build script before testing
useEnv = true                  # default: false; use the project's own Jest environment
flags = ["--ci"]               # default: []; flags passed to every jest run
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
