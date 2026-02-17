# Connecting a VPS OpenClaw Bot to the Dashboard

Step-by-step guide to add a new VPS-hosted OpenClaw agent to the Multi-Agent Dashboard.

## Prerequisites

- A VPS with OpenClaw installed and running
- SSH access to the VPS
- The dashboard repo cloned locally

## Step 1: Get Your VPS IP Address

SSH into your VPS and run:

```bash
curl ifconfig.me
```

Note down the public IP address.

## Step 2: Find the Gateway Token

The token is stored in the OpenClaw config file:

```bash
cat /root/.openclaw/openclaw.json
```

Look for the `gateway.auth.token` field:

```json
"gateway": {
  "auth": {
    "mode": "token",
    "token": "YOUR_TOKEN_HERE"
  }
}
```

## Step 3: Find the Gateway Port

In the same `openclaw.json` file, check:

```json
"gateway": {
  "port": 18789
}
```

Default port is `18789`.

## Step 4: Enable External Access (Bind to LAN)

By default, the gateway only listens on localhost. Change the bind mode to `lan`:

```bash
# Edit the config
python3 -c "import json; cfg=json.load(open('/root/.openclaw/openclaw.json')); cfg['gateway']['bind']='lan'; json.dump(cfg,open('/root/.openclaw/openclaw.json','w'),indent=2)"
```

Or manually edit `/root/.openclaw/openclaw.json` and change:

```json
"bind": "loopback"
```

to:

```json
"bind": "lan"
```

## Step 5: Enable the Chat Completions API

The OpenAI-compatible API endpoint is **disabled by default**. Enable it:

```bash
python3 -c "import json; cfg=json.load(open('/root/.openclaw/openclaw.json')); cfg['gateway'].setdefault('http',{}).setdefault('endpoints',{}).setdefault('chatCompletions',{})['enabled']=True; json.dump(cfg,open('/root/.openclaw/openclaw.json','w'),indent=2)"
```

Or manually add this to the `gateway` section in `openclaw.json`:

```json
"gateway": {
  "http": {
    "endpoints": {
      "chatCompletions": {
        "enabled": true
      }
    }
  }
}
```

## Step 6: Restart the Gateway

```bash
openclaw gateway restart
```

## Step 7: Verify External Access

From your local machine (not the VPS), test the API:

```bash
curl -s -X POST http://YOUR_VPS_IP:18789/v1/chat/completions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}],"stream":false}'
```

You should get a JSON response with the assistant's reply.

## Step 8: Add the Agent to the Dashboard

Edit `agents.json` and add a new entry to the `agents` array:

```json
{
  "id": "agent-2",
  "name": "Your Bot Name",
  "host": "YOUR_VPS_IP",
  "port": 18789,
  "token": "YOUR_TOKEN_HERE",
  "color": "#06B6D4"
}
```

### Available Colors

| Color   | Hex Code  |
|---------|-----------|
| Blue    | `#3B82F6` |
| Cyan    | `#06B6D4` |
| Green   | `#10B981` |
| Purple  | `#8B5CF6` |
| Orange  | `#F97316` |
| Red     | `#EF4444` |
| Pink    | `#EC4899` |

## Step 9: Restart the Dashboard

```bash
node server.js
```

The new agent will appear in the sidebar. Open http://localhost:3000 to start chatting.

## Troubleshooting

### "Failed to parse gateway response"
- The Chat Completions API is not enabled. See Step 5.

### Agent shows as offline
- The gateway bind is still set to `loopback`. See Step 4.
- Check if port 18789 is open in your VPS firewall: `ss -tlnp | grep 18789`
- Verify the gateway is running: `ps aux | grep openclaw`

### "Cannot reach host"
- Check your VPS firewall allows inbound traffic on port 18789.
- Verify the VPS IP is correct.
- Ensure the gateway is running: `openclaw gateway start`

### Gateway won't start after config change
- Validate the config: `openclaw doctor --fix`
- Check for JSON syntax errors in `openclaw.json`.
