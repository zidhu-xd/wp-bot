import express from 'express';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import { setInterval } from 'timers/promises';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const HEARTBEAT_URL = process.env.HEARTBEAT_URL;

// ---------- Google Drive Setup ----------
const jwt = new google.auth.JWT(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/drive.file']
);
const drive = google.drive({ version: 'v3', auth: jwt });

/**
 * Upload a Buffer (from Base64) to Google Drive.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} filename
 * @returns {Promise<string>} public view link
 */
async function uploadToDrive(buffer, mimeType, filename) {
  const media = {
    requestBody: {
      name: filename,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
    },
    media: {
      mimeType,
      body: require('stream').Readable.from(buffer),
    },
  };
  const res = await drive.files.create(media);
  // Make file publicly readable
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });
  return `https://drive.google.com/file/d/${res.data.id}/view`;
}

// ---------- WhatsApp Client ----------
// Store session in /tmp (persisted across Render restarts)
const SESSION_PATH = '/tmp/.wwebjs_auth';

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'whatsapp-viewonce',
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
        console.log(`View Once ${msg.type} received from ${msg.from}`);
        const media = await msg.downloadMedia();
        if (!media || !media.data) {
          console.error('No media data found.');
          return;
        }
        // Convert Base64 to Buffer
        const buffer = Buffer.from(media.data, 'base64');
        const mimeType = msg.type === 'image' ? 'image/jpeg' : 'video/mp4';
        const ext = msg.type === 'image' ? 'jpg' : 'mp4';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `viewonce-${timestamp}.${ext}`;
        const link = await uploadToDrive(buffer, mimeType, filename);
        console.log('Uploaded to Google Drive:', link);
        // Optional: reply with link (privacy warning)
        // await msg.reply(`🔗 View Once saved: ${link}`);
      } catch (err) {
        console.error('Failed to upload View Once media:', err);
      }
    }
  }
});

// ---------- Express & Heartbeat ----------
app.get('/', (req, res) => res.send('WhatsApp View Once Uploader is running.'));
app.get('/ping', (req, res) => {
  console.log('Ping received at', new Date().toISOString());
  res.send('pong');
});

// Start server and WhatsApp
(async () => {
  try {
    client.initialize().catch(err => console.error('WhatsApp init error:', err));
    app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

    // Heartbeat: ping ourselves every 10 minutes
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