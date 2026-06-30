# FA Grafana Alert Templates

These files are source templates for the Fishing Assistant Grafana alerting setup.

Grafana Cloud does not consume file provisioning directly. Use these templates
as the repo-owned source for the Grafana provisioning API, Terraform, or manual
import/export workflows.

`dashboard-fa-logs.json` is the source dashboard definition for the
`Fishing Assistant Logs` dashboard in the shared Grafana Cloud stack.

Keep webhook URLs, datasource UIDs, and shared secrets as placeholders. Do not commit rendered files with live Grafana URLs, API tokens, webhook secrets, or contact-point secrets.

Expected placeholders:

- `${FA_GRAFANA_LOKI_DATASOURCE_UID}`
- `${FA_ALERT_ROUTER_WEBHOOK_URL}`
- `${FA_ALERT_ROUTER_WEBHOOK_SECRET}`
