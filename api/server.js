const express = require("express");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);
const fs = require("fs");
const path = require("path");
const winston = require("winston");
require("winston-daily-rotate-file");

const app = express();
const PORT = 3000;
const urlFilePath = path.join(__dirname, "slideshow_url.txt");

// -----------------------------
// Logging
// -----------------------------
const logDir = "/var/log/photo-api";
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(
            ({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`
        )
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
            filename: "server-%DATE%.log",
            dirname: logDir,
            datePattern: "YYYY-MM-DD",
            maxSize: "10m",
            maxFiles: "7d",
            zippedArchive: true,
        }),
    ],
});

// -----------------------------
// Helpers
// -----------------------------
const generateSlideshowUrl = (query = "noimagesfound", interval = "30") => {
    const encodedQuery = encodeURIComponent(query);
    return `http://localhost:8080/picapport#slideshow?sort=random&autostart=true&viewtime=${interval}&query=${encodedQuery}`;
};

const { spawn } = require("child_process");

const loadBrowserUrl = async (url = "http://localhost:8080/picapport") => {
    try {
        logger.info("Closing any running Chromium instances...");
        await exec("pkill -9 chromium || true");

        // chromium flags
        const flags = [
            "--no-first-run",
            "--disable-restore-session-state",
            "--disable-session-crashed-bubble",
            "--disable-infobars",
            "--start-fullscreen",
            "--kiosk"
        ];

        const env = {
            ...process.env,
            DISPLAY: process.env.DISPLAY || ":0",
            XAUTHORITY: process.env.XAUTHORITY || "/home/pi/.Xauthority",
            HOME: "/home/pi",
            USER: "pi"
        };

        logger.info(`Spawning Chromium at: ${url}`);
        const child = spawn("/usr/bin/chromium-browser", [...flags, url], {
            detached: true,
            stdio: "ignore",
            env
        });

        child.unref();
        logger.info(`Chromium spawned successfully.`);
    } catch (err) {
        logger.error(`Failed to launch Chromium: ${err.stack || err.message}`);
        throw err;
    }
};

// -----------------------------
// Routes
// -----------------------------
app.get("/api/test", (req, res) => {
    logger.info("Accessed /api/test");
    res.status(200).send("Testing");
});

app.get("/api/home", async (req, res) => {
    logger.info("Accessed /api/home");
    try {
        await loadBrowserUrl();
        res.status(200).send("Picapport homepage opened");
    } catch {
        res.status(500).send("Failed to open homepage");
    }
});

app.get("/api/slideshow", async (req, res) => {
    try {
        let url;

        if (Object.keys(req.query).length > 0) {
            // Query params provided → generate a new slideshow URL
            url = generateSlideshowUrl(req.query.q, req.query.interval);
            logger.info(`Generated new slideshow URL: ${url}`);

            // Save to file
            fs.writeFileSync(urlFilePath, url, "utf8");
        } else {
            // No query params → try to use the previously saved URL
            if (fs.existsSync(urlFilePath)) {
                url = fs.readFileSync(urlFilePath, "utf8").trim();
                logger.info(`Loaded saved slideshow URL: ${url}`);
            } else {
                // Fallback if file doesn't exist
                url = generateSlideshowUrl();
                logger.warn(`No saved URL found, using fallback: ${url}`);
            }
        }

        // Launch Chromium with the URL
        await loadBrowserUrl(url);
        res.status(200).send(`Playing slideshow with URL: ${url}`);
    } catch (error) {
        logger.error(`Error starting slideshow: ${error.message}`);
        res.status(500).send("Failed to start slideshow");
    }
});

app.get("/api/screen", async (req, res) => {
    logger.info("Accessed /api/screen");
    try {
        const resp = await exec("vcgencmd display_power");
        const screenState = resp.stdout.trim();
        if (screenState === "display_power=1") {
            await exec("sudo vcgencmd display_power 0");
            res.status(200).send("Screen is OFF");
        } else {
            await exec("sudo vcgencmd display_power 1");
            res.status(200).send("Screen is ON");
        }
    } catch (error) {
        logger.error(`Error toggling screen: ${error.message}`);
        res.status(500).send("Failed to toggle screen");
    }
});

// -----------------------------
// Start server
// -----------------------------
app.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
});
