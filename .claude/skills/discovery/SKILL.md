# Discovery Skill

Depth-First Infrastructure Crawling via Claude Agent SDK.

## Strategy

1. `ss -tlnp` + `ps aux` → Overview of listening ports + running processes
2. Explore each service deeper:
   - Databases → list tables/collections
   - Web services → explore endpoints via logs/config
   - Queues → list topics/bindings
3. `save_node` + `save_edge` for each finding
4. `get_catalog` before saving → no duplicates
5. Follow config files: `.env`, `docker-compose.yml`, `application.yml`
6. Backtrack when trail is exhausted

## Port Mapping

| Port | Service |
|------|---------|
| 5432 | postgres |
| 3306 | mysql |
| 27017 | mongodb |
| 6379 | redis |
| 9092 | kafka |
| 5672 | rabbitmq |
| 80/443/8080/3000 | web_service |
| 9090 | prometheus |
| 8500 | consul |
| 8200 | vault |
| 2379 | etcd |

## Rules

- ONLY read-only commands: `ss`, `ps`, `cat`, `head`, `curl -s`, `docker inspect`, `kubectl get`
- Targets ONLY Host:Port — NO URLs, paths, credentials
- Node IDs: `{type}:{host}:{port}` or `{type}:{name}`
- Confidence: 0.9 directly observed, 0.7 from config, 0.5 inferred
- NO credentials stored
