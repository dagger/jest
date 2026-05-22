# Migration Report

Dagger migrated `dagger.json`, but some old settings need a manual check.

ACTION: Review each item below. If your project still relies on it, add the setting back manually.

Legacy config: `dagger.json`

## 1. `jest` needs a manual check

Dagger could not migrate this setting automatically: constructor arg "source" has 'defaultPath', which workspace settings do not support

Original setting:

```json
{
  "argument": "source",
  "defaultPath": "/tests/log_output_toolchain_local"
}
```
