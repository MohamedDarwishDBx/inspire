# Use case billing tags

Inspire tags the jobs, job runs and assets it creates so DBUs can be summed per use case from `system.billing.usage`.

## Tag keys

| Key | Value | Set on |
|---|---|---|
| `dbx_inspire_ai_version` | Agent version, for example `v1.5.3` | every Inspire job and asset |
| `dbx_inspire_ai_business` | Business name, cleaned | every Inspire job and asset |
| `dbx_inspire_ai_session_id` | Session id | every Inspire job and asset |
| `dbx_inspire_ai_run_type` | `discovery`, `implement`, `training`, `analysis`, `genie_regen` | every job |
| `dbx_inspire_ai_usecase_id` | Use case id, for example `N01-U01` | use case runs |
| `dbx_inspire_ai_usecase_name` | Full use case name, lower snake_case, for example `predict_customer_churn` | use case runs with one use case |
| `dbx_inspire_ai_usecase` | Same value as `dbx_inspire_ai_usecase_name` (legacy key, kept for existing readers) | Genie jobs |
| `dbx_inspire_ai_app_name` / `dbx_inspire_ai_app_id` | App name and id | the job that builds an App |

Encoding of `dbx_inspire_ai_usecase_name`:

- Lower case, every run of characters outside `a-z0-9` becomes one `_`, leading and trailing `_` are removed.
- Accents are folded (`Café` becomes `cafe`). Non-Latin characters become separators, so a name with no ASCII letters writes no name tag.
- Longer than the tag value limit (255 on AWS and Azure, 63 on GCP or when the cloud is unknown), the value is cut at the last `_` inside the limit.
- A Discover run, or any run that covers more than one use case, carries no name tag. It has no single name to report.

The encoder is `useCaseNameTag` in `app/backend/lib/inspireJobParams.js` and `inspire_usecase_name_tag` in the agent notebook. Both read `app/agent/tests/fixtures/usecase_name_cases.json`.

## Which billing rows carry which tags

| Compute | Attribution | Use case key |
|---|---|---|
| Job compute and serverless jobs | Job tags reach `custom_tags`; `usage_metadata.job_id` is set | `custom_tags['dbx_inspire_ai_usecase_name']` |
| Databricks Apps | `usage_metadata.app_id` is set. `custom_tags` is filled only when the App runs under a serverless usage policy, which Inspire does not set | join `app_id` to the job tag `dbx_inspire_ai_app_id` |
| SQL warehouse (App statements) | Statement `query_tags` carry `dbx_inspire_ai_app_name` and `dbx_inspire_ai_usecase_id`; the warehouse DBUs are shared, so they are apportioned | see `docs/inspire_usage_report.sql`, statement 5 (query-duration apportionment) |

## Example: DBUs per use case name

Replace `system.lakeflow.jobs` and `system.billing.usage` with your central copies if the principal cannot read `system.*`.

```sql
WITH inspire_jobs AS (                       -- latest tags of every Inspire job
  SELECT job_id, workspace_id, tags
  FROM (
    SELECT job_id, workspace_id, tags, delete_time,
           ROW_NUMBER() OVER (PARTITION BY workspace_id, job_id ORDER BY change_time DESC) AS rn
    FROM system.lakeflow.jobs
    WHERE change_time >= current_timestamp() - INTERVAL 365 DAYS
  )
  WHERE rn = 1 AND delete_time IS NULL AND try_element_at(tags, 'dbx_inspire_ai_version') IS NOT NULL
),
job_usecase AS (
  SELECT job_id, workspace_id,
         try_element_at(tags, 'dbx_inspire_ai_usecase_name') AS usecase_name,
         try_element_at(tags, 'dbx_inspire_ai_app_id') AS app_id,
         try_element_at(tags, 'dbx_inspire_ai_warehouse_id') AS warehouse_ids
  FROM inspire_jobs
),
warehouse_owner AS (                         -- a warehouse is one use case's only when a single named use case uses it
  SELECT workspace_id, warehouse_id, MIN(usecase_name) AS usecase_name
  FROM (
    SELECT j.workspace_id, w.warehouse_id, j.usecase_name
    FROM job_usecase j
    LATERAL VIEW explode(split(coalesce(j.warehouse_ids, ''), ',')) w AS warehouse_id
    WHERE coalesce(w.warehouse_id, '') <> '' AND j.usecase_name IS NOT NULL
  )
  GROUP BY workspace_id, warehouse_id
  HAVING COUNT(DISTINCT usecase_name) = 1
),
usage_by_kind AS (
  SELECT u.workspace_id, 'job' AS kind, CAST(u.usage_metadata.job_id AS STRING) AS asset_id, u.usage_quantity
  FROM system.billing.usage u
  WHERE u.usage_unit = 'DBU' AND u.usage_metadata.job_id IS NOT NULL
  UNION ALL
  SELECT u.workspace_id, 'app', CAST(u.usage_metadata.app_id AS STRING), u.usage_quantity
  FROM system.billing.usage u
  WHERE u.usage_unit = 'DBU' AND u.usage_metadata.app_id IS NOT NULL
  UNION ALL
  SELECT u.workspace_id, 'warehouse', CAST(u.usage_metadata.warehouse_id AS STRING), u.usage_quantity
  FROM system.billing.usage u
  WHERE u.usage_unit = 'DBU' AND u.usage_metadata.warehouse_id IS NOT NULL
)
SELECT coalesce(
         CASE WHEN b.kind = 'warehouse' THEN wo.usecase_name ELSE j.usecase_name END,
         'unattributed') AS usecase_name,
       b.kind,
       SUM(b.usage_quantity) AS dbus
FROM usage_by_kind b
LEFT JOIN job_usecase j
  ON (b.kind = 'job' AND b.asset_id = CAST(j.job_id AS STRING) AND b.workspace_id = j.workspace_id)
  OR (b.kind = 'app' AND b.asset_id = j.app_id AND b.workspace_id = j.workspace_id)
LEFT JOIN warehouse_owner wo
  ON b.kind = 'warehouse' AND b.asset_id = wo.warehouse_id AND b.workspace_id = wo.workspace_id
GROUP BY 1, 2
ORDER BY dbus DESC;
```
Notes:

- A warehouse that more than one use case names has no single owner, so its DBUs show as `unattributed`. For an apportioned figure use statement 5 of `docs/inspire_usage_report.sql` (query duration).
- A job with several use case ids has no name tag, so its DBUs show as `unattributed`.
- Rows before the tag set existed have no name tag and show as `unattributed`.
- The join assumes one job per asset. Confirm one sample row per kind before you rely on the totals.
