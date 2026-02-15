import express from 'express';
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import dotenv from 'dotenv';
import { setInterval } from 'timers/promises';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const HEARTBEAT_URL = process.env.HEARTBEAT_URL;
const OWNER_NUMBER = process.env.OWNER_NUMBER;

if (!OWNER_NUMBER) {
  console.error('FATAL: OWNER_NUMBER is not set in .env. Please configure it and restart.');
  process.exit(1);
}

// ---------- WhatsApp Client ----------
// Store session in /tmp (persisted across Render restarts)
const SESSION_PATH = '/tmp/.wwebjs_auth';

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'whatsapp-viewonce-forwarder',
    dataPath: SESSION_PATH,
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', qr => {
  console.log('QR code received. Scan with WhatsApp to link:');
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('WhatsApp client is ready!');
  console.log(`Forwarding View Once media to: ${OWNER_NUMBER}`);
});

client.on('remote_session_saved', () => {
  console.log('Remote session saved to /tmp');
});

client.on('message', async msg => {
  // Detect View Once media (image or video)
  if (msg.type === 'image' || msg.type === 'video') {
    // Heuristic: message body or id indicates View Once
    const isViewOnce = msg.body.toLowerCase().includes('view once') || msg.id.id.includes('viewonce');
    if (isViewOnce) {
      try {
        console.log(`View Once ${msg.type} received from ${msg.from}. Forwarding...`);
        
        // Download the media data
        const media = await msg.downloadMedia();
        
        if (!media || !media.data) {
          console.error('Failed to download media content.');
          return;
        }

        // Recreate the MessageMedia object from the downloaded data
        const forwardedMedia = new MessageMedia(
          media.mimetype,
          media.data,
          media.filename
        );

        // Prepare a caption for the forwarded message
        const timestamp = new Date().toLocaleString();
        const caption = `🔒 *View Once Media*\n\nFrom: ${msg.from}\nReceived: ${timestamp}`;

        // Send the media to the owner's number
        await client.sendMessage(OWNER_NUMBER, forwardedMedia, { caption: caption });
        
        console.log(`Successfully forwarded View Once ${msg.type} to ${OWNER_NUMBER}`);

      } catch (err) {
        console.error('Failed to forward View Once media:', err);
      }
    }
  }
});

// ---------- Express & Heartbeat ----------
app.get('/', (req, res) => res.send('WhatsApp View Once Forwarder is running.'));
app.get('/ping', (req, res) => {
  console.log('Ping received at', new Date().toISOString());
  res.send('pong');
});

// Start server and WhatsApp
(async () => {
  try {
    client.initialize().catch(err => console.error('WhatsApp init error:', err));
    app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

    // Heartbeat: ping ourselves every 10 minutes to keep Render free tier alive
    if (HEARTBEAT_URL) {
      setInterval(async () => {
        try {
          const r = await fetch(HEARTBEAT_URL);
          console.log('Heartbeat status:', r.status);
        } catch (e) {
          console.error('Heartbeat failed:', e.message);
        }
      }, 10 * 60 * 1000); // 10 minutes
    }
  } catch (err) {
    console.error('Startup error:', err);
  }
})();