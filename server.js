import express from "express";
import pkg from "whatsapp-web.js";
import qrcodeTerminal from "qrcode-terminal";
import dotenv from "dotenv";

dotenv.config();

const { Client, LocalAuth, MessageMedia } = pkg;

const app = express();
const PORT = process.env.PORT || 10000;
const HEARTBEAT_URL = process.env.HEARTBEAT_URL;
const OWNER_NUMBER = process.env.OWNER_NUMBER;

if (!OWNER_NUMBER) {
  console.error("FATAL: OWNER_NUMBER is not set in environment variables.");
  process.exit(1);
}

/*
  Render filesystem notes:
  Only /tmp is writable at runtime.
  WhatsApp session must be stored there.
*/
const SESSION_PATH = "/tmp/.wwebjs_auth";

/*
  IMPORTANT:
  Chrome was installed during build at:
  /opt/render/.cache/puppeteer/chrome/linux-145.0.7632.67/chrome-linux64/chrome

  If version changes in future builds, update this path accordingly.
*/
const CHROME_PATH =
  "/opt/render/.cache/puppeteer/chrome/linux-145.0.7632.67/chrome-linux64/chrome";

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "whatsapp-viewonce-forwarder",
    dataPath: SESSION_PATH
  }),
  puppeteer: {
    headless: true,
    executablePath: CHROME_PATH,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process"
    ]
  }
});

/* ===========================
   WhatsApp Events
=========================== */

client.on("qr", qr => {
  console.log("Scan QR to authenticate:");
  qrcodeTerminal.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("WhatsApp client ready.");
  console.log("Forward target:", OWNER_NUMBER);
});

client.on("auth_failure", msg => {
  console.error("Authentication failed:", msg);
});

client.on("disconnected", reason => {
  console.error("Client disconnected:", reason);
});

/*
  Improved View Once detection
*/
client.on("message", async msg => {
  try {
    if (!msg.hasMedia) return;

    const isViewOnce =
      msg.isViewOnce ||
      msg._data?.isViewOnce ||
      msg._data?.viewOnce;

    if (!isViewOnce) return;

    console.log("View Once media detected from:", msg.from);

    const media = await msg.downloadMedia();

    if (!media?.data) {
      console.error("Failed to download media.");
      return;
    }

    const forwardedMedia = new MessageMedia(
      media.mimetype,
      media.data,
      media.filename || "viewonce"
    );

    const timestamp = new Date().toLocaleString();

    const caption =
`View Once Media

From: ${msg.from}
Time: ${timestamp}`;

    await client.sendMessage(OWNER_NUMBER, forwardedMedia, {
      caption
    });

    console.log("Forwarded successfully.");

  } catch (err) {
    console.error("Forwarding error:", err);
  }
});

/* ===========================
   Express Server
=========================== */

app.get("/", (req, res) => {
  res.send("WhatsApp View Once Forwarder running.");
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});

/* ===========================
   Initialize WhatsApp
=========================== */

(async () => {
  try {
    await client.initialize();
  } catch (err) {
    console.error("Initialization failed:", err);
  }
})();

/* ===========================
   Heartbeat (Render Keep Alive)
=========================== */

if (HEARTBEAT_URL) {
  setInterval(async () => {
    try {
      const res = await fetch(HEARTBEAT_URL);
      console.log("Heartbeat status:", res.status);
    } catch (err) {
      console.error("Heartbeat failed:", err.message);
    }
  }, 10 * 60 * 1000);
}

/* ===========================
   Graceful Shutdown
=========================== */

process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Cleaning up...");
  await client.destroy();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received. Cleaning up...");
  await client.destroy();
  process.exit(0);
});
