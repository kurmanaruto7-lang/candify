# Run Candify's backend on an always-on server (Oracle Cloud Always Free)

This makes the proxy fast and stable: no home upload speed, no quick tunnel, no PC that has to stay on.

## 1. Create the VM
1. Sign up at https://www.oracle.com/cloud/free/ (a card is needed for identity checks; Always Free resources stay free, the card is not charged).
2. Compute > Instances > Create instance.
   - Image: **Ubuntu** 22.04 or 24.04
   - Shape: the **AMD** "VM.Standard.E2.1.Micro" (Always Free, almost always available). The Ampere A1 (ARM) shape is beefier but often shows "out of capacity" — if so, use the AMD micro, or try a different Availability Domain / region.
   - **Download the private key** when it offers one (you'll need it to log in). Keep it safe.
3. On the instance's subnet, open **Security List > Add Ingress Rules**: source `0.0.0.0/0`, TCP, destination ports **80** and **443** (one rule each).
4. Copy the instance's **Public IP address** from its details page.

### Logging in from Windows (PowerShell)
Windows 11 has `ssh` built in. With the key you downloaded (e.g. `ssh-key.key` in Downloads):
```powershell
icacls "$env:USERPROFILE\Downloads\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"
ssh -i "$env:USERPROFILE\Downloads\ssh-key.key" ubuntu@YOUR_VM_IP
```
(The `icacls` line fixes a "permissions too open" error Windows otherwise throws.)

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
Make the firewall rules survive a reboot:
```bash
sudo apt install -y iptables-persistent   # choose "Yes" to save current rules
sudo netfilter-persistent save
```
Check it's live: open `https://candify.duckdns.org/api/status` in a browser — it should return JSON. Caddy proxies WebSockets automatically, so `/wisp/` works over `wss://` too.

## 4. Point the static site at it
On your PC, in the project folder:
```bash
node build.js wss://candify.duckdns.org/wisp/
firebase deploy --only hosting
```
Because the address is fixed, you only do this once.
