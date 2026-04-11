# Foundry VTT Server Assets

If you're reading this, you probably need a refresher on how the EC2 instance manages Foundry VTT. This folder holds the core scripts required to initialize the server, establish disaster recovery processes, and manage the system on AWS.

## Architecture & Install Scripts

### `setup-foundry.sh`
This is your foundational installation script. It is designed to be injected completely automatically when the EC2 instance first boots up via the AWS CDK (UserData). 

However, if you ever need to run it manually on a fresh Amazon Linux server, simply upload it and execute it:
```bash
chmod +x setup-foundry.sh
sudo ./setup-foundry.sh
```

**What it does:**
1. Installs Docker and Docker Compose.
2. Generates the Foundry and NGINX configs.
3. Automatically requests HTTPS certs via Let's Encrypt for the domain.
4. Wraps everything into a durable `systemd` service (`foundryvtt.service`).
5. Generates the continuous backup tools!

### Process Management
Thanks to `setup-foundry.sh`, Foundry isn't just a raw docker container—it acts as an OS-level service. Use these commands to control the server:
- `sudo systemctl start foundryvtt`
- `sudo systemctl stop foundryvtt`
- `sudo systemctl restart foundryvtt`
- Track live logs natively: `sudo journalctl -u foundryvtt -f`

---

## 🗄️ Disaster Recovery & S3 Setup

Your data isn't living exclusively on the EC2 instance. All Foundry map/world/character data located at `/home/ec2-user/data` is automatically synchronized off-server into your AWS S3 Bucket.

**AWS S3 Target**
Your S3 Bucket name resolves dynamically per AWS region, but generally looks like:
👉 `s3://really-farout-cool-foundry-data-{YOUR_REGION}` (e.g., `us-west-2`)

### 1. Automated Backups (Systemd Timer)
Your server is configured to perform an automated nightly sync of your data straight to S3.
- **Schedule**: Triggers at precisely **2:00 AM Server Time** (which is locked explicitly to `America/Los_Angeles`).
- **Location**: Everything syncs into the `Current/data/` prefix in the S3 bucket.
- **Under the hood**: A systemd timer (`foundry-sync.timer`) triggers a script (`/usr/local/bin/sync-foundry.sh`).
- **Logs**: If you need to verify it ran, check the logs natively: `sudo journalctl -u foundry-sync.service`

### 2. Point-In-Time Manual Snapshot
If you are about to do a risky update, install a massive world, or just want absolute peace of mind, you can force a hard snapshot to S3.
- **Command**: Log into the server and run `sudo /usr/local/bin/backup-foundry.sh`.
- **Location**: Unlike the nightly cron which overwrites `Current/`, this generates a static folder isolated by timestamp. 
- Example S3 path: `Backups/2026-04-11:13:30/data/`

If things ever fail horribly, you can pull exactly what you need out of S3 and restore it!
