# Daily Summary FunctionGraph

This directory contains the Huawei Cloud FunctionGraph function used by PetCare Cloud.

## Function Settings

- Function type: Event function
- Runtime: Python 3.10
- Handler: `index.handler`
- Environment variables:
  - `PETCARE_BACKEND_URL`: ECS backend URL, for example `http://124.70.69.49:8000`
  - `PETCARE_FUNCTION_TOKEN`: same value as ECS `.env`

## Trigger

Recommended trigger:

- Timer trigger
- Run once per day, for example 09:00

For classroom demo, you can also use the FunctionGraph console test event:

```json
{
  "trigger_type": "manual-test"
}
```

The function calls:

```text
POST /api/cloud/function/daily-summary
```

The ECS backend stores the execution result in `cloud_function_runs` and shows it on the cloud architecture page.
