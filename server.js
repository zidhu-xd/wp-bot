import express from "express";
import pkg from "whatsapp-web.js";
import qrcodeTerminal from "qrcode-terminal";
import dotenv from "dotenv";
import puppeteer from "puppeteer";

dotenv.config();

const { Client, LocalAuth, MessageMedia } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;
const OWNER_NUMBER = process.env.OWNER_NUMBER;
const HEARTBEAT_URL = process.env.HEARTBEAT_URL;

if (!OWNER_NUMBER) {
  console.error("FATAL: OWNER_NUMBER is not set.");
  process.exit(1);
}

const SESSION_PATH = "./.wwebjs_auth";

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "viewonce-forwarder",
    dataPath: SESSION_PATH
  }),
  puppeteer: {
    headless: true,
    executablePath: puppeteer.executablePath(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  }
});

/* ===========================
   WhatsApp Events
=========================== */

client.on("qr", (qr) => {
  console.log("\nScan this QR with WhatsApp → Linked Devices\n");
  qrcodeTerminal.generate(qr, { small: false });

  console.log("\nIf QR looks broken, open this in browser:\n");
  console.log(
    `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}\n`
  );
});

client.on("ready", () => {
  console.log("WhatsApp client is ready.");
  console.log("Forwarding to:", OWNER_NUMBER);
});

client.on("auth_failure", (msg) => {
  console.error("Authentication failed:", msg);
});

client.on("disconnected", (reason) => {
  console.error("Client disconnected:", reason);
});

/*
  View Once Media Forwarder
*/
client.on("message", async (msg) => {
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

    const caption = `View Once Media

From: ${msg.from}
Time: ${timestamp}`;

    await client.sendMessage(OWNER_NUMBER, forwardedMedia, { caption });

    console.log("Forwarded successfully.");
  } catch (err) {
    console.error("Forwarding error:", err);
  }
});

/* ===========================
   Express Server
=========================== */

app.get("/", (req, res) => {
  res.send("WhatsApp View Once Forwarder running on Railway.");
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

/* ===========================
   Initialize WhatsApp
=========================== */

(async () => {
  try {
    await client.initialize();
  } catch (err) {
    console.error("Initialization error:", err);
  }
})();

/* ===========================
   Optional Heartbeat
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
  console.log("Shutting down...");
  await client.destroy();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await client.destroy();
  process.exit(0);
});
