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
  IMPORTANT FOR RENDER:
  Render filesystem is ephemeral except /tmp
  Session must be stored in /tmp
*/
const SESSION_PATH = "/tmp/.wwebjs_auth";

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "whatsapp-viewonce-forwarder",
    dataPath: SESSION_PATH
  }),
  puppeteer: {
    headless: true,
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
  console.error("Auth failure:", msg);
});

client.on("disconnected", reason => {
  console.error("Client disconnected:", reason);
});

/*
  Improved View Once detection:
  whatsapp-web.js exposes msg.isViewOnce in newer versions
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
      console.error("Media download failed.");
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

    console.log("Forward successful.");

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
      console.log("Heartbeat:", res.status);
    } catch (err) {
      console.error("Heartbeat failed:", err.message);
    }
  }, 10 * 60 * 1000);
}

/* ===========================
   Graceful Shutdown
=========================== */

process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Shutting down...");
  await client.destroy();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received. Shutting down...");
  await client.destroy();
  process.exit(0);
});
