# Deploying Hopi Farms to hopifarms.fun

The game server runs on a DigitalOcean droplet behind nginx, with Cloudflare in front
for DNS and HTTPS.

```
player ──HTTPS──▶ Cloudflare ──HTTPS (origin cert)──▶ nginx :443 ──▶ node 127.0.0.1:5180
                                                                     └─ /var/lib/hopi-farms/hopi.db
```

## Files

| File | Goes to | Does |
|---|---|---|
| `setup.sh` | run once on the droplet | installs everything below; safe to re-run |
| `hopi-farms.service` | `/etc/systemd/system/` | runs the server as the `hopi` user |
| `hopi-farms-backup.service` / `.timer` | `/etc/systemd/system/` | daily DB backup, keeps 14 days |
| `nginx-hopifarms.conf` | `/etc/nginx/sites-available/hopifarms.fun` | HTTPS site, real visitor IPs from Cloudflare |
| `deploy.sh` | run on your computer | push, pull on the server, test, restart |

## First time

1. **Cloudflare DNS:** add an `A` record `@` → droplet IP (proxied) and a `CNAME` record `www` → `hopifarms.fun` (proxied).
2. **Cloudflare SSL/TLS:** set the mode to **Full (strict)**. Under **Origin Server**, create a certificate (keep the defaults) and leave the page open.
3. **On the droplet:**
   ```bash
   curl -fsSL https://raw.githubusercontent.com/gindi3/hopi-farms/main/deploy/setup.sh -o setup.sh
   sudo bash setup.sh
   ```
   The first run starts the game and asks for the certificate. Paste it into `/etc/ssl/hopifarms/origin.pem`
   and the key into `/etc/ssl/hopifarms/origin.key`, then run `sudo bash setup.sh` again.
4. Open https://hopifarms.fun.

## Updates

```bash
HOPI_HOST=root@YOUR_DROPLET_IP ./deploy/deploy.sh
```

## Useful commands on the droplet

```bash
systemctl status hopi-farms          # is it running?
journalctl -u hopi-farms -f          # live logs
sudo systemctl restart hopi-farms    # restart
ls -lh /var/lib/hopi-farms/backups   # backups
```

To restore a backup: `sudo systemctl stop hopi-farms`, copy the backup over
`/var/lib/hopi-farms/hopi.db` (keep it owned by `hopi`), delete the `hopi.db-wal` and
`hopi.db-shm` files next to it, then `sudo systemctl start hopi-farms`.
