#!/bin/bash
set -e

### ====== PRE-REQUISITES ======
echo "Installing base packages..."
sudo dnf update -y
sudo dnf install -y aws-cli jq docker git

### ====== FETCH AWS METADATA ======
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
REGION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/dynamic/instance-identity/document | grep -oP '"region"\s*:\s*"\K[^"]+')
if [ -z "$REGION" ]; then REGION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/dynamic/instance-identity/document | jq -r .region); fi
BUCKET="really-farout-cool-foundry-data-${REGION}"

### ====== SECRETS CONFIG ======
echo "Fetching configuration from SSM Parameter Store..."
DOMAIN_NAME=$(aws ssm get-parameter --name "/foundry/domain" --region "$REGION" --query "Parameter.Value" --output text || echo "")
EMAIL=$(aws ssm get-parameter --name "/foundry/email" --region "$REGION" --with-decryption --query "Parameter.Value" --output text)
FOUNDRY_USERNAME=$(aws ssm get-parameter --name "/foundry/username" --region "$REGION" --with-decryption --query "Parameter.Value" --output text)
FOUNDRY_PASSWORD=$(aws ssm get-parameter --name "/foundry/password" --region "$REGION" --with-decryption --query "Parameter.Value" --output text)
FOUNDRY_ADMIN_KEY=$(aws ssm get-parameter --name "/foundry/admin_key" --region "$REGION" --with-decryption --query "Parameter.Value" --output text)
FOUNDRY_LICENSE_KEY=$(aws ssm get-parameter --name "/foundry/license_key" --region "$REGION" --with-decryption --query "Parameter.Value" --output text)

FOUNDRY_VERSION="13.351"

### ====== ARGUMENT PARSING ======
MODE="default"
BACKUP_DATE=""

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --clean|clean) MODE="clean"; shift ;;
        --backup|backup) MODE="backup"; BACKUP_DATE="$2"; shift 2 ;;
        --list-backups|list) 
            echo "Available backups in s3://${BUCKET}/Backups/ :"
            aws s3 ls s3://${BUCKET}/Backups/
            exit 0
            ;;
        --help|-h|help)
            echo "Usage: ./setup-foundry.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  (no args)             Default install. Restores data from s3://.../Current/ if it exists."
            echo "  --clean               Force a clean install. Bypasses S3 validation/restoration."
            echo "  --backup <timestamp>  Restores from a specific point-in-time backup (e.g. YYYY-MM-DD:HH:MM)."
            echo "  --list-backups        Lists all available backups in S3 and exits without installing."
            echo "  --help, -h            Display this help message and exit."
            exit 0
            ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
done

### ====== RESTORE DATA FROM S3 ======
sudo mkdir -p /home/ec2-user/data
sudo chown ec2-user:ec2-user /home/ec2-user/data

if [ "$MODE" == "clean" ]; then
    echo "Clean install requested. Skipping S3 data restore."
elif [ "$MODE" == "backup" ]; then
    if [ -z "$BACKUP_DATE" ]; then
        echo "Error: backup argument requires a date string (e.g. YYYY-MM-DD:HH:MM)"
        exit 1
    fi
    echo "Restoring from specific backup: $BACKUP_DATE"
    aws s3 sync s3://${BUCKET}/Backups/${BACKUP_DATE}/data /home/ec2-user/data
    sudo chown -R ec2-user:ec2-user /home/ec2-user/data
else
    # Default behavior: try to sync from Current/
    echo "Checking for existing data in Current/..."
    if aws s3 ls s3://${BUCKET}/Current/data/ --recursive | grep -q '[A-Za-z0-9]'; then
        echo "Data found! Restoring from s3://${BUCKET}/Current/data..."
        aws s3 sync s3://${BUCKET}/Current/data /home/ec2-user/data
        sudo chown -R ec2-user:ec2-user /home/ec2-user/data
    else
        echo "No existing data found in Current/. Proceeding with a clean install."
    fi
fi

### ====== START DOCKER ======
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ec2-user

### ====== INSTALL DOCKER COMPOSE ======
echo "Installing Docker Compose..."
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

### ====== CREATE APP DIRECTORY ======
mkdir -p ~/foundry && cd ~/foundry


### ====== CREATE DOCKER COMPOSE FILE ======
cat <<EOF > docker-compose.yml
services:
  foundry:
    image: felddy/foundryvtt:${FOUNDRY_VERSION}
    container_name: foundry
    restart: unless-stopped
    environment:
      TZ: America/Los_Angeles
      CONTAINER_PRESERVE_CONFIG: "true"
      FOUNDRY_HOSTNAME: really.farout.cool 
      FOUNDRY_USERNAME: ${FOUNDRY_USERNAME}
      FOUNDRY_PASSWORD: ${FOUNDRY_PASSWORD}
      FOUNDRY_ADMIN_KEY: ${FOUNDRY_ADMIN_KEY}

    volumes:
      - /home/ec2-user/data:/data
    expose:
      - "30000"

  nginx:
    image: nginx:latest
    container_name: nginx
    depends_on:
      - foundry
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
EOF

### ====== CREATE NGINX CONFIG ======
cat <<EOF > nginx.conf
events {}

http {
  server {
    listen 80;

    location /.well-known/acme-challenge/ {
      root /var/www/certbot;
    }

    location / {
      proxy_pass http://foundry:30000;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
  }
}
EOF

### ====== CREATE SYSTEMD SERVICE ======
echo "Creating systemd service for Foundry..."
sudo tee /etc/systemd/system/foundryvtt.service > /dev/null <<EOF
[Unit]
Description=Foundry VTT Docker Compose Service
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ec2-user/foundry
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
ExecReload=/usr/bin/docker compose down && /usr/bin/docker compose up -d

[Install]
WantedBy=multi-user.target
EOF

### ====== START SERVICES ======
echo "Starting Foundry + NGINX via systemd..."
sudo systemctl daemon-reload
sudo systemctl enable --now foundryvtt

### ====== OPTIONAL: SETUP HTTPS ======
if [ ! -z "$DOMAIN_NAME" ]; then
  echo "Setting up HTTPS with Let's Encrypt..."

  mkdir -p certbot/conf certbot/www

  docker run --rm \
  -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
  -v "$(pwd)/certbot/www:/var/www/certbot" \
  certbot/certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  --non-interactive \
  -d "$DOMAIN_NAME"

  echo "Updating NGINX for HTTPS..."

  cat <<EOF > nginx.conf
events {}

http {

  gzip on;
  gzip_vary on;
  gzip_proxied any;
  gzip_comp_level 6;
  gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss image/svg+xml;

  server {
    listen 80;
    server_name $DOMAIN_NAME;

    location /.well-known/acme-challenge/ {
      root /var/www/certbot;
    }

    location / {
      return 301 https://\$host\$request_uri;
    }
  }

  server {
    listen 443 ssl;
    server_name $DOMAIN_NAME;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN_NAME/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN_NAME/privkey.pem;

    location / {
      proxy_pass http://foundry:30000/;
      proxy_http_version 1.1;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
      proxy_set_header Upgrade \$http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_buffers 8 16k;
      proxy_buffer_size 32k;
      client_max_body_size 300M; # Essential for uploading large maps/assets
    }
  }
}
EOF

  docker compose restart nginx

  echo "HTTPS enabled!"
fi

### ====== SETUP BACKUPS ======
echo "Setting up S3 Backups..."

# Set System Timezone to America/Los_Angeles to easily handle 2 AM local time
sudo timedatectl set-timezone America/Los_Angeles

# Create Cron Sync Script (Syncs only changed files)
sudo tee /usr/local/bin/sync-foundry.sh > /dev/null <<'EOF'
#!/bin/bash
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
REGION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/dynamic/instance-identity/document | jq -r .region)
BUCKET="really-farout-cool-foundry-data-${REGION}"

echo "Syncing /home/ec2-user/data to s3://${BUCKET}/Current/data ..."
aws s3 sync /home/ec2-user/data s3://${BUCKET}/Current/data
EOF
sudo chmod +x /usr/local/bin/sync-foundry.sh

# Create Manual Backup Script
sudo tee /usr/local/bin/backup-foundry.sh > /dev/null <<'EOF'
#!/bin/bash
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
REGION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/dynamic/instance-identity/document | jq -r .region)
BUCKET="really-farout-cool-foundry-data-${REGION}"
TIMESTAMP=$(date +%Y-%m-%d:%H:%M)

echo "Starting manual backup to s3://${BUCKET}/Backups/${TIMESTAMP}/data ..."
aws s3 sync /home/ec2-user/data s3://${BUCKET}/Backups/${TIMESTAMP}/data
echo "Backup complete!"
EOF
sudo chmod +x /usr/local/bin/backup-foundry.sh

# Register a systemd timer for 2 AM local time (replaces deprecated cron in AL2023)
sudo tee /etc/systemd/system/foundry-sync.service > /dev/null <<EOF
[Unit]
Description=Foundry VTT Nightly S3 Sync

[Service]
Type=oneshot
ExecStart=/usr/local/bin/sync-foundry.sh
EOF

sudo tee /etc/systemd/system/foundry-sync.timer > /dev/null <<EOF
[Unit]
Description=Run Foundry VTT S3 Sync Every Night at 2 AM

[Timer]
OnCalendar=*-*-* 02:00:00  
# Ensure the timer catches up if the instance was turned off at 2AM
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now foundry-sync.timer

### ====== DONE ======
echo "--------------------------------------"
echo "Setup complete!"
echo "Access your server at:"
if [ -z "$DOMAIN_NAME" ]; then
  PUBLIC_IP=$(curl -s http://checkip.amazonaws.com)
  echo "http://$PUBLIC_IP"
else
  echo "https://$DOMAIN_NAME"
fi
echo "--------------------------------------"

echo "NOTE: You may need to log out/in for Docker group permissions."
