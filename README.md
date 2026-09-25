# Jest Dagger Toolchain

Runs your [Jest](https://jestjs.io) tests in Dagger, one check per project,
with every test span exported to OpenTelemetry.

## Requirements

Dagger engine `v1.0.0-beta.15` or later. That version is not released yet, so
for now the module only loads on a dev engine.

## Installation

```sh
dagger install github.com/dagger/jest
```

## Usage

```console
$ dagger check                                   # every Jest project visible from here
$ dagger check -l --all                          # one line per project and test file
$ dagger check --jest --jest-project=web
$ dagger check --jest --jest-project=web --jest-test-file=src/App.test.jsx
$ dagger check jest/projects/tests/test --jest-test-file=src/App.test.jsx
$ dagger check -l --all --jest -f=cli            # each line as flags to reuse
$ dagger list jest-projects -a
$ dagger list jest-test-files -a --jest-project=web
```

The toolchain has one check, `jest/projects/tests/test`. It runs once per
selected project, over that project's selected test files:

- With every test file of the project selected, it runs `npx jest` with no
  file arguments, so Jest's own configuration decides what runs.
- With some test files filtered out, it runs
  `npx jest --passWithNoTests --runTestsByPath <files>` over the selected
  files only.

### Selection flags

| Flag | Selects |
| --- | --- |
| `--jest`, `--by-jest` | checks from this module |
| `--test`, `--check-test` | checks named `test`, in every installed module |
| `--jest-project=PATH` | one project, by root relative to the workspace root (repeatable) |
| `--jest-projects` | every project |
| `--jest-test-file=PATH` | one test file, by path relative to its project (repeatable) |
| `--jest-test-files` | every test file |

`dagger check --help` lists the flags in effect. They can change when another
installed module has a `JestProject` or `JestTestFile` type too.

### Working directory

Discovery starts at the directory you run Dagger from, so you select a project
by standing in it and need no flag:

```console
# a monorepo holding web/ and api/, each with a jest.config.js
$ dagger check                     # runs web and api
$ cd web/src/components
$ dagger check                     # runs web only
$ dagger list jest-projects -a     # -> web
```

The visible projects are every project at or below the working directory. When
the working directory is inside a project but is not its root, the nearest
enclosing project is included too. Keys are relative to the workspace root,
wherever you stand.

## Discovery

Listing runs no container and no Jest.

**Projects.** A project is a directory holding a `jest.config.*` file (`.js`,
`.mjs`, `.cjs`, `.ts`, `.mts`, `.cts` or `.json`). `node_modules` is not
searched. A `jest` key in `package.json` also configures Jest, but
`package.json` marks every npm package, so it is not a discovery marker.

**Test files.** One search per project matches Jest's default `testMatch`:
`**/__tests__/**/*.[jt]s?(x)` and `**/?(*.)+(spec|test).[jt]s?(x)`, plus the
`.mjs`, `.cjs`, `.mts` and `.cts` variants. The search skips:

- `node_modules`;
- the project's `dist` and `build` directories;
- the subtrees of nested Jest projects, which report their own files;
- empty files.

**Limits of static discovery.** The project's Jest configuration is never
evaluated, so a custom `testMatch`, `testRegex`, `roots` or
`testPathIgnorePatterns` is not seen:

- A file that the config excludes may still be listed. Selecting only that
  file runs nothing and passes.
- A test that only a custom `testMatch` finds is not listed. It still runs
  whenever the whole project runs, because that run uses Jest's own config.
- A project with no file matching the default patterns has no test files, so
  `dagger check` does not run it. Call its `test` function from a module
  instead (see below).
- A whole-project run follows Jest's config, so it can also reach a nested
  project's tests. A filtered run covers only the selected files.

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

Unless `useEnv` is set, the toolchain injects its register hook through
`NODE_OPTIONS`, so tests are traced without any change to your config.

## Using it from another module

`projects(ws)` returns a collection. Build its members with `get(key:)`, narrow
it with `subset(keys:)`, and reach the functions that span the collection
through `batch`:

```dang
let projects = jest.projects(ws)
projects.keys                                   # ["api", "web"]
projects.batch.test(ws)                         # run every project, list the failures
projects.get(key: "web").test(ws)               # run one whole project
projects.get(key: "web").list(ws)               # jest --listTests output

let files = projects.get(key: "web").tests(ws)
files.keys                                      # ["src/App.test.jsx", ...]
run(files.subset(keys: ["src/App.test.jsx"]).batch.test(ws))
run(files.get(key: "src/App.test.jsx").test(ws))
```

`JestProjects.test` and `JestProject.test` are plain functions. They are not
checks, so that `dagger check` does not run the same tests twice. The test-file
`test` functions are checks. A check called through a dependency comes back
unrun, so wrap it in a helper that runs it:

```dang
let run(check: Check!): Void {
  if (check.pass == false) {
    raise check.error.message ?? "check failed"
  }
  null
}
```

Settings are constructor arguments:
`jest(build: true, flags: ["--ci"]).projects(ws)`.

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
