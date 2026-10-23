# Deploying Hopi Farms to hopifarms.fun

The game runs on the same DigitalOcean droplet as frontporch.fun (206.189.172.171). That
droplet doesn't use nginx or open web ports: sites reach the internet through a Cloudflare
Tunnel (`cloudflared`, service `frontporch-tunnel`).

```
player ──HTTPS──▶ Cloudflare ──tunnel──▶ cloudflared on the droplet
                                           ├─ hopifarms.fun, www  ──▶ 127.0.0.1:5190  Hopi Farms
                                           └─ everything else     ──▶ 127.0.0.1:5180  Frontporch
```

## Files

| File | Goes to | Does |
|---|---|---|
| `setup.sh` | run once on the droplet | installs everything below and adds hopifarms.fun to the tunnel; safe to re-run |
| `hopi-farms.service` | `/etc/systemd/system/` | runs the server as the `hopi` user on 127.0.0.1:5190 |
| `hopi-farms-backup.service` / `.timer` | `/etc/systemd/system/` | daily DB backup, keeps 14 days |
| `deploy.sh` | run on your computer | push, pull on the server, test, restart |

## First time

1. On your Mac:
   ```bash
   ssh -i ~/.ssh/frontporch_cloud root@206.189.172.171
   ```
2. On the droplet:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/gindi3/hopi-farms/main/deploy/setup.sh -o setup.sh
   sudo bash setup.sh
   ```
   It backs up `/etc/cloudflared/config.yml`, adds hopifarms.fun ahead of the catch-all rule,
   and restarts the tunnel (frontporch.fun blinks for a second or two).
3. In Cloudflare → hopifarms.fun → DNS → Records, delete any `A`/`AAAA`/`CNAME` records for
   `hopifarms.fun` and `www`, then add (both Proxied):
   - `CNAME` `@` → `03ee6b57-71eb-43da-8e65-1f56de257dd1.cfargotunnel.com`
   - `CNAME` `www` → `03ee6b57-71eb-43da-8e65-1f56de257dd1.cfargotunnel.com`
4. Once Cloudflare shows the domain as **Active**, open https://hopifarms.fun.

## Updates

```bash
./deploy/deploy.sh
```

## Useful commands on the droplet

```bash
systemctl status hopi-farms          # is it running?
journalctl -u hopi-farms -f          # live logs
sudo systemctl restart hopi-farms    # restart
ls -lh /var/lib/hopi-farms/backups   # backups
ls /etc/cloudflared/config.yml.bak-* # tunnel config backups made by setup.sh
```

To restore a database backup: `sudo systemctl stop hopi-farms`, copy the backup over
`/var/lib/hopi-farms/hopi.db` (keep it owned by `hopi`), delete the `hopi.db-wal` and
`hopi.db-shm` files next to it, then `sudo systemctl start hopi-farms`.
