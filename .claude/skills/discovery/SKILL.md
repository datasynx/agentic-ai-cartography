# Discovery Skill

Depth-First Infrastruktur-Crawling via Claude Agent SDK.

## Strategie

1. `ss -tlnp` + `ps aux` → Überblick über lauschende Ports + laufende Prozesse
2. Jeden Service tiefer erkunden:
   - Datenbanken → Tabellen/Collections auflisten
   - Web-Services → Endpoints via Logs/Config erkunden
   - Queues → Topics/Bindings auflisten
3. `save_node` + `save_edge` für jeden Fund
4. `get_catalog` vor dem Speichern → keine Duplikate
5. Config-Files folgen: `.env`, `docker-compose.yml`, `application.yml`
6. Backtrack wenn Spur erschöpft

## Port-Mapping

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

## Regeln

- NUR read-only Commands: `ss`, `ps`, `cat`, `head`, `curl -s`, `docker inspect`, `kubectl get`
- Targets NUR Host:Port — KEINE URLs, Pfade, Credentials
- Node IDs: `{type}:{host}:{port}` oder `{type}:{name}`
- Confidence: 0.9 direkt beobachtet, 0.7 aus Config, 0.5 Vermutung
- KEINE Credentials speichern
