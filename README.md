# Jest Dagger Toolchain

Runs your [Jest](https://jestjs.io) tests in Dagger, one check per test, with
one Jest run per project, and every test exported to OpenTelemetry as a span.

## Requirements

Requires Dagger v1.0.0-beta.22 or later, the first release that passes a
check its selected collection.

## Installation

```sh
dagger install github.com/dagger/jest
```

## Usage

```sh
dagger check                                   # every Jest project visible from here
dagger check -l --all                          # one line per project, test file and test
dagger check --jest --jest-project=web
dagger check --jest --jest-project=web --jest-test-file=src/App.test.jsx
dagger check --jest --jest-test='App renders the header'
dagger check jest/projects/test-files/tests/test --jest-test-file=src/App.test.jsx
dagger check -l --all --jest -f=cli            # each line as flags to reuse
dagger list jest-projects -a
dagger list jest-test-files -a --jest-project=web
dagger list jest-tests -a --jest-test-file=src/App.test.jsx
```

The toolchain has one check, `test`, at `jest/projects/test-files/tests/test`:
one per selected test. Every selected test of a project shares one Jest run
(see [How tests run](#how-tests-run)).

`dagger check -l` without `--all` prints a single row with `*` in the
`JEST-PROJECT`, `JEST-TEST-FILE` and `JEST-TEST` columns. The `*` stands for
every project, test file and test in view; add `--all` to list them one per
row. (A `*` in the `JEST-TEST` column of a listed row is the
[unnamed-tests key](#tests).) Listing runs no container: no install, no Jest.

Use `dagger check` to run tests, in CI too: it fails when a test fails.

### Selection flags

| Flag | Selects |
| --- | --- |
| `--jest`, `--by-jest` | checks from this module |
| `--check test` | checks named `test`, in every installed module |
| `--jest-project=PATH` | one project, by root relative to the workspace root (repeatable) |
| `--jest-projects` | every project |
| `--jest-test-file=PATH` | one test file, by path relative to its project (repeatable) |
| `--jest-test-files` | every test file |
| `--jest-test=NAME` | one test, by the name Jest calls it by, or `*` (repeatable) |
| `--jest-tests` | every test |

`dagger check --help` lists the flags in effect. They can change when another
installed module has a `JestProject`, `JestTestFile` or `JestTest` type too.

Each test is its own check. A failure names the project, and the test file
or the step that failed, with the end of its output:

```
Jest project a: install failed (npm install, exit 1):
npm error ...
Jest project b, src/sum.test.js: adds failed:
● adds
expect(received).toBe(expected) ...
Jest project c: jest failed (exit 127) without a report:
jest is not installed: add it to the devDependencies of c/package.json (...)
```

### How tests run

All test checks of a project call the same helper with the same
engine-filtered selection, so they build one byte-identical command, which
the engine runs once. Projects run separately, each with its own install and
container.

- With nothing filtered out of the project, Jest runs the project as its own
  config sees it: `jest --json --outputFile=... --passWithNoTests`.
- Otherwise it runs the selected files by path, in sorted key order,
  `--runTestsByPath <files>`, leaving out files with no selected test. When
  tests were filtered out of them, it adds one anchored `--testNamePattern`
  over the sorted union of the selected names. A selected `*` adds an
  alternative matching every name that no selected file's source holds,
  `(?!(?:<names>)$).*`.

The pattern applies to every file of the run, so a name selected in one file
also runs a test of that name in another, and a selected `*` also runs the
unnamed tests of the other files.

The run writes Jest's JSON report to a file and never fails by itself. A small
indexer, in a pinned Node image shared by every project, reads the report once
and writes one bounded result per selected test, keeping the last 32 KiB of
each diagnostic; each check reads only its own. A check then fails when:

- its own test failed; for `*`, any test of its file the source does not
  name;
- its file failed outside its tests: it failed to run, or a hook threw;
- a test in its file with no selected check of its own failed -- an unnamed
  test when `*` is not selected, or a named test the pattern could not leave
  out: it cannot be told apart from the file's selected tests;
- its test did not run although its file did: discovery read a test Jest does
  not declare, so the check says so rather than passing. `*` with no tests
  passes, since an empty `.each` table is legitimate;
- or the project's run failed for all of them: the install or build failed,
  the config failed to load, Jest wrote no report (`--bail`, a failing global
  setup or teardown), a test file without a check failed (only the whole
  project run reaches those), Jest did not run a listed file, or Jest exited
  non-zero with no failure in its report.

A selected test that is skipped or `todo` passes. Logs and test spans belong
to the check that started the shared run; the other checks share its result.
The run is cached like any other Dagger operation, so rerunning with the same
inputs reuses its results.

## Projects

A project is a directory holding a `jest.config.js`, `.mjs`, `.cjs`, `.ts`,
`.mts`, `.cts` or `.json`: the names Jest loads on its own when run there.
`node_modules` is not searched. Keys are relative to the workspace root.

- A `jest` key in `package.json` also configures Jest, but `package.json`
  marks every npm package, so it is not a marker.
- A named variant such as `jest.config-eslint-7.js` is not a marker either:
  Jest never loads it by itself, only through `--config` or a `projects`
  entry, so its directory is not a project Jest would run on its own. It is
  still used when a root config's `projects` names it (below).

### Your working directory selects projects

Which projects you see depends on where you run `dagger`:

- **Inside a project's subdirectory:** the enclosing project, plus any
  projects nested below that directory.
- **At a project root:** that project and the projects below it, never the
  ones above it.
- **In a directory that belongs to no project:** the projects below it.

Given `web/jest.config.js` and `api/jest.config.js`:

```sh
dagger check                    # runs web and api
cd web/src && dagger check      # runs web only
cd web && dagger list jest-projects -a   # web
```

### Monorepos with a root `projects` config

When a project's config lists `projects` as string literals, for example

```js
module.exports = {
  projects: ["<rootDir>/packages/*/jest.config.js"],
};
```

the projects it names are run by it, so they are not keyed again: `dagger
check` from the root runs the root project once, and Jest runs every package
through it. Their test files are keyed under the root project
(`packages/a/src/a.test.js`) and read with each package's own config. From
inside a package (`cd packages/a && dagger check`) the package is a project of
its own and runs alone. A `projects` list that is not all string literals is
not read, and its nested projects are keyed on their own as well.

## Test files

Test files are found in one search of the project, with `node_modules` and
git-ignored files skipped; listing runs no container and no Jest. They are
the files the project's Jest config would run, read statically from its
config file:

- `testMatch`, `testRegex`, `testPathIgnorePatterns`, `roots` and `rootDir`
  are honoured when they are literal strings or arrays of them.
- Anything else, and a config that exports something other than an object
  literal (a function call such as `module.exports = buildConfig(...)`, an
  import), falls back to Jest's defaults: `testMatch`
  `**/__tests__/**/*.?([mc])[jt]s?(x)` and `**/?(*.)+(spec|test).?([mc])[jt]s?(x)`,
  ignoring `/node_modules/`.
- Nested projects report their own files, unless a `projects` list names them.

So static discovery can be wrong about a config it cannot read:

- It may list a helper that the config excludes. Its check fails, saying
  Jest did not run the file.
- It may miss a test file that only the config's own logic finds. That file
  has no check. It runs when nothing is filtered out of its project, since
  Jest then runs the project with its own config, and if it fails, every check
  of the project fails, naming it. A narrowed run leaves it out.
- A project with no test file it can find reports no test files, so `dagger
  check` does not run it; call its `test` function from a module instead.
- A config file discovery cannot read or make sense of takes Jest's defaults,
  so listing never fails on it. If Jest cannot load it either, the project's
  checks fail when it runs, naming the file, and other projects are
  unaffected.

## Tests

A test file's tests are read from its source, with no container and no Jest.
A test is keyed by the name Jest calls it by: the names of the `describe`
blocks around it and its own, separated by spaces, so selecting it runs
`--testNamePattern` over that exact name.

A test is named only where the source fixes its name:

- its name, and every enclosing `describe`'s, is a string literal that is the
  whole first argument (`'a'`, not `'a ' + b`, and not a template with
  `${}`);
- every scope around it is the file's top level, a `describe` callback or a
  plain `{}` block. A test declared in any other function -- a shared helper,
  a `forEach` callback, a class or object method -- gets its name from where
  it runs, and one in a loop or under a condition -- `if`/`else`, `try`/
  `catch`/`finally`, `switch`, a ternary, `&&`, `||` -- may run many times or
  not at all;
- it is not a `.each` row.

Names with characters outside ASCII are left out too.

The tests the source does not name share one key, `*`, which a file has
whenever it declares any such test, or none Jest's syntax shows (a file whose
tests come from a helper it imports). Selecting `*` runs exactly those, with a
pattern that excludes the named ones, and its check fails when any of them
does. A file whose tests are all named has no `*`; a file whose tests are all
unnamed has only `*`.

A test counts as run when Jest's report lists it with any status. A test
skipped because another in its file has `.only`, and `.skip`, `x`-prefixed and
`.todo` tests, are listed as pending, so their checks pass. A named test Jest
does not list at all, though it ran the file, fails its check as not run.

## Dependencies

Jest runs from the project directory.

**Without a `package.json`** at or above the project, `npx` fetches Jest.

**With one**, dependencies are installed and the project's own Jest runs: the
nearest `node_modules/.bin/jest` between the project and the install root, or
yarn's under Plug'n'Play. If there is none, the check fails with `jest is not
installed: add it to the devDependencies of ...` rather than fetching a
different version.

- **Install root.** The nearest workspace root at or above the project: a
  directory with `pnpm-workspace.yaml`, or a `package.json` with
  `"workspaces"`. Failing that, the nearest lockfile's directory, then the
  nearest `package.json`'s. A package inside a monorepo therefore installs
  with the whole workspace and sees the files above it, such as a shared
  `jest.base.config.js`.
- **Package manager.** The `packageManager` setting if set. Otherwise the
  `packageManager` field of the install root's `package.json`, then its
  lockfile (`pnpm-lock.yaml` or `pnpm-workspace.yaml`: pnpm, `yarn.lock`:
  yarn, `bun.lock`/`bun.lockb`: bun), then npm. pnpm and yarn run through
  corepack, installed when the image lacks it, at the version the
  `packageManager` field pins.
- **Caching.** The install sees only what it reads: every `package.json`,
  lockfiles, `pnpm-workspace.yaml`, `.npmrc`, `.yarnrc*`,
  `.yarn/{releases,plugins,patches}`, `.pnpmfile.cjs`, `bunfig.toml` and
  `patches/`, plus the directories of local dependencies (`file:`, `link:`,
  `portal:` specs), which the install copies or links, and the files
  workspace packages name in `"bin"`, which it links into
  `node_modules/.bin`. The rest of the source
  is laid over the result, so editing a source file does not reinstall. With
  pnpm's `dependenciesMeta` `injected`, or a local dependency outside the
  install root, the install gets the whole source instead. Package manager
  caches, the pnpm store and corepack live on cache volumes.
- **Less noise.** Browser downloads (Playwright, Puppeteer, Cypress) and git
  hook installers (husky, simple-git-hooks) are switched off.
- **Install scripts** still run, but they see only the install inputs, so a
  `postinstall` or `prepare` script that builds from source fails. Pass
  `installFlags = ["--ignore-scripts"]`, and set `build = true` if the tests
  need the build output.

The install root, or the project itself, is mounted at `/src` without
`node_modules` and without files ignored by `.gitignore`.

With `build` set, the package manager's `run build` runs in the project
before the tests, when the nearest `package.json` at or above the project has
a `build` script; a package without one just runs its tests. The build runs
only in the selected project: running `packages/app` alone does not build the
workspace packages it depends on, so give it a `build` script that builds
them first, or run from the workspace root, whose own `build` script usually
builds every package.

## Settings

Set them with `dagger settings`, or in `dagger.toml`:

```sh
dagger settings jest environment TZ=UTC
dagger settings jest installFlags -- --ignore-scripts   # "--" before a value that starts with -
dagger settings -u jest installFlags                    # back to the default
```

```toml
[modules.jest.settings]
baseImageAddress = "node:22-alpine"   # default: node:25-alpine; any image with node and npm
packageManager = "pnpm"               # default: "" (detect); npm, yarn, pnpm or bun
installFlags = ["--ignore-scripts"]   # default: []; appended to the install command
environment = ["TZ=UTC"]              # default: []; KEY=VALUE for the build and the tests
build = true                          # default: false; run the build script before testing
useEnv = true                         # default: false; use the project's own Jest environment
flags = ["--ci"]                      # default: []; flags passed to every jest run
```

Unless `useEnv` is set, the toolchain preloads its register hook through
`NODE_OPTIONS`, so tests are traced without any change to your config. With
`useEnv`, the toolchain's build of `@dagger.io/jest` is linked into
`node_modules`, for a config that names `@dagger.io/jest/node-environment`.

## Using it from another module

`projects(ws)` returns a collection. Build its members with `get(key:)` and
narrow it with `subset(keys:)`. Collection functions are called on the
collection itself; there is no `batch` namespace:

```dang
let projects = jest.projects(ws)
projects.keys                                   # ["api", "web"]
projects.test(ws)                               # run every project, list the failures
projects.get(key: "web").test(ws)               # run one whole project
projects.get(key: "web").list(ws)               # jest --listTests output
projects.get(key: "web").installRoot(ws)        # where dependencies are installed

let files = projects.get(key: "web").testFiles(ws)
files.keys                                      # ["src/App.test.jsx", ...]
files.subset(keys: ["src/App.test.jsx"]).test(ws)
files.get(key: "src/App.test.jsx").test(ws)     # run one whole file

let tests = files.get(key: "src/App.test.jsx").tests
tests.keys                                      # ["App renders the header", ...]
tests.subset(keys: ["App renders the header"]).test(ws)
run(tests.get(key: "App renders the header").test(ws, selection: files))
```

`tests` is now a field rather than `tests(ws)`, so that the engine can filter
it along with the files.

The project, test-file and tests `test` functions are plain functions, each
running Jest on its own. They are not checks, so that `dagger check` does not
run the same tests twice; they raise on failure.

The test `test` function is the check. Its `selection` is the project's test
files: `dagger check` passes the collection it has filtered, and every check
it passes it to shares one run over the selection. Called directly, pass the
collection you want run; a direct `subset` does not filter the tests inside
each file, so it runs their files whole. A check called through a dependency
comes back unrun, so wrap it in a helper that runs it:

```dang
let run(check: Check!): Void {
  if (check.pass == false) {
    raise check.error.message ?? "check failed"
  }
  null
}
```

Settings are constructor arguments:
`jest(build: true, installFlags: ["--ignore-scripts"]).projects(ws)`.

From the command line, `dagger call` cannot select a collection item yet; the
Dagger shell can:

```sh
dagger -c 'jest | projects | get web | list'
```

The end-to-end tests in `.dagger/modules/e2e` exercise all of this. Direct
Dang calls do not apply the engine's filtered view of a selection, so the
`selected-*` checks run the engine-provided CLI on fixture workspaces in an
isolated session, and assert check totals and messages: several projects and
files, unselected tests left out, one Jest run per project, a single test
run alone, a failing test, a file that fails to run, a config that fails to
load or to parse, a failing `.each` row landing on `*`, an unnamed failure
landing on its file's tests, helper-defined tests and nested describes,
conditional tests, `.only` and pending tests, a failure outside any selected
test, and a selected test that never ran.
`listing-runs-nothing-check` lists a workspace whose base image does not
exist and whose install fails, proving listing runs no container.

```sh
dagger check 'e2e/*'            # the whole suite
dagger check 'e2e/selected-*'   # the selection checks
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
