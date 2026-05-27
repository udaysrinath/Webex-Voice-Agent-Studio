# Local Setup

## Twilio phone-call webhook with Cloudflare Tunnel

Twilio cannot call `localhost`, so local phone-call testing needs a public HTTPS
URL that forwards to the local Docker app.

The app container exposes the server at:

```bash
http://localhost:3001
```

Start a Cloudflare quick tunnel with HTTP/2. HTTP/2 is important on networks
where QUIC/UDP is blocked.

```bash
cloudflared tunnel --url http://localhost:3001 --protocol http2 --no-autoupdate
```

Cloudflare prints a URL like:

```text
https://example-words-here.trycloudflare.com
```

Set that URL in `.env`:

```env
APP_BASE_URL=https://example-words-here.trycloudflare.com
```

Optional demo identity overrides:

```env
DEMO_CUSTOMER_NAME=Mayada Abdelrahman
DEMO_CUSTOMER_PHONE=+16505550142
```

`DEMO_CUSTOMER_NAME` changes the returning-customer name used by both browser
and phone-call retail flows. `DEMO_CUSTOMER_PHONE` changes the browser-flow and
SMS fallback customer phone. Phone calls still prefer Twilio's inbound caller ID
unless `DEMO_SMS_RECIPIENT_PHONE` is set.

Recreate the app container so Docker Compose reloads `.env`:

```bash
docker compose up -d --force-recreate app
```

Verify what the app is advertising to Twilio:

```bash
curl http://localhost:3001/api/twilio/status
```

The Twilio Voice webhook should be:

```text
https://example-words-here.trycloudflare.com/api/v1/twilio/voice-stream
```

Use `POST` as the webhook method in the Twilio Console.

The app returns TwiML that tells Twilio to connect media streams to:

```text
wss://example-words-here.trycloudflare.com/ws/twilio-stream
```

Do not configure that websocket URL manually in Twilio. Twilio gets it from the
voice webhook response.

You can test the public webhook directly:

```bash
curl -i -X POST "https://example-words-here.trycloudflare.com/api/v1/twilio/voice-stream" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "From=%2B15551234567&To=%2B16509551868&CallSid=TEST_CALL"
```

A healthy response is `HTTP 200` with XML containing:

```xml
<Connect><Stream url="wss://example-words-here.trycloudflare.com/ws/twilio-stream">
```

## Detached tunnel option

To keep the tunnel running in a detached terminal session:

```bash
cd /private/tmp
screen -dmS webex-cloudflared -L cloudflared tunnel --url http://localhost:3001 --protocol http2 --no-autoupdate
```

Read the generated URL:

```bash
tail -n 80 /private/tmp/screenlog.0
```

Stop the detached tunnel:

```bash
screen -S webex-cloudflared -X quit
```

## Cloudflare quick-tunnel rate limit

If Cloudflare returns:

```text
status_code="429 Too Many Requests"
```

wait a few minutes and run the tunnel command again. Quick tunnels are temporary
and rate-limited. Every new quick tunnel gets a new URL, so update `.env`,
recreate the app container, and update the Twilio Console webhook each time.
