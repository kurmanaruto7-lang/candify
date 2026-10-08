# Run Candify's backend on an always-on server (Oracle Cloud Always Free)

This makes the proxy fast and stable: no home upload speed, no quick tunnel, no PC that has to stay on.

## 1. Create the VM
1. Sign up at https://www.oracle.com/cloud/free/ (a card is needed for identity checks; Always Free resources stay free).
2. Compute > Instances > Create instance.
   - Image: Ubuntu 22.04 or 24.04
   - Shape: Ampere A1 (ARM, 1-2 OCPU, 6-12 GB) or the AMD micro shape; both are in the Always Free list.
   - Add your SSH public key (or let Oracle generate one and download it).
3. In the VM's subnet Security List, add ingress rules for TCP **80** and **443** from `0.0.0.0/0`.

## 2. Install Node and the app
```bash
ssh ubuntu@YOUR_VM_IP
sudo apt update && sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
git clone https://github.com/kurmanaruto7-lang/candify.git
cd candify && npm install
sudo npm install -g pm2
# OWNER_PASSWORD enables the /admin owner dashboard. Pick your own; it is read from the
# environment and never stored in the code. Leave it out to disable owner login entirely.
OWNER_PASSWORD='choose-a-strong-password' PORT=3001 pm2 start server.js --name candify --update-env
pm2 save && pm2 startup   # run the command it prints
```
The owner dashboard is then at `https://YOUR-DOMAIN/admin`.

## 3. Give it https with a free domain
Browsers only allow `wss://` from an https page, so the backend needs a certificate.
1. Make a free subdomain at https://www.duckdns.org (for example `candify.duckdns.org`) and point it at the VM's public IP.
2. Open the OS firewall and install Caddy (it gets the certificate by itself):
```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy.list
sudo apt update && sudo apt install -y caddy
echo 'candify.duckdns.org { reverse_proxy localhost:3001 }' | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

## 4. Point the static site at it
On your PC, in the project folder:
```bash
node build.js wss://candify.duckdns.org/wisp/
firebase deploy --only hosting
```
Because the address is fixed, you only do this once.
