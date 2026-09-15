#!/bin/bash
# TeamTracker Quick Install Script
# Run this on a fresh Ubuntu server to install TeamTracker

set -e

echo "🏢 TeamTracker Installation"
echo "========================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

# Update system
echo "📦 Updating system packages..."
apt-get update
apt-get install -y curl git nginx nodejs npm sqlite3

# Install Node.js 18+ if not present
if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 18 ]; then
    echo "📦 Installing Node.js 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

# Install PM2
echo "📦 Installing PM2..."
npm install -g pm2

# Create app directory
APP_DIR="/opt/teamtracker"
echo "📁 Creating app directory: $APP_DIR"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Clone the repo
echo "📥 Downloading TeamTracker..."
if [ -d ".git" ]; then
    git pull origin main
else
    git clone https://github.com/hamdymohamedak/TeamTracker.git .
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install
cd admin && npm install && cd ..
cd desktop && npm install && cd ..

# Build the app
echo "🔨 Building TeamTracker..."
cd admin
npm run build
cd ..

# Create environment file
echo "⚙️  Creating environment file..."
cat > admin/.env << EOF
PORT=3001
NODE_ENV=production
DATABASE_PATH=./data/admin.db
EOF

# Initialize database
echo "🗄️  Initializing database..."
cd admin
node -e "
const { initDatabase } = require('./dist/server/database.js');
initDatabase().then(() => {
    console.log('Database initialized');
    process.exit(0);
}).catch(err => {
    console.error('Database init failed:', err);
    process.exit(1);
});
"
cd ..

# Start with PM2
echo "🚀 Starting TeamTracker..."
cd admin
pm2 start dist/server/index.js --name teamtracker --env production
pm2 save
pm2 startup systemd

cd ..

# Setup nginx
echo "🌐 Configuring nginx..."
cat > /etc/nginx/sites-available/teamtracker << 'EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/teamtracker /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# Get server IP
SERVER_IP=$(curl -s ifconfig.me)

echo ""
echo "✅ TeamTracker is installed and running!"
echo ""
echo "🌐 Dashboard URL: http://$SERVER_IP"
echo ""
echo "Next steps:"
echo "1. Open http://$SERVER_IP in your browser"
echo "2. Add your employees in the dashboard"
echo "3. Download the desktop tracker for each employee"
echo ""
echo "To check status: pm2 status"
echo "To view logs: pm2 logs teamtracker"
echo "To restart: pm2 restart teamtracker"
