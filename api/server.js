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

const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
            filename: "server-%DATE%.log",
            dirname: path.join(__dirname, "logs"),
            datePattern: "YYYY-MM-DD",
            maxSize: "10m",
            maxFiles: "7d",
            zippedArchive: true,
        }),
    ],
});

const generateSlideshowUrl = (query = "noimagesfound", interval = "30") => {
    const encodedQuery = encodeURIComponent(query);
    return `http://localhost:8080/picapport#slideshow?sort=random&autostart=true&viewtime=${interval}&query=${encodedQuery}`;
};

const loadBrowserUrl = async (url = "http://localhost:8080/picapport") => {
    await exec("pkill -o chromium || true");
    await exec(`chromium-browser --start-fullscreen "${url}" &>/dev/null &`);
}

app.get("/api/test", (req, res) => {
    logger.info("Accessed /api/test");
    res.status(200).send("Testing");
});

app.get("/api/home", async (req, res) => {
    logger.info("Accessed /api/home");
    loadBrowserUrl();
    logger.info("Opened Picapport homepage successfully");
    res.status(200).send(`Picapport homepage opened`);
});

app.get("/api/slideshow", async (req, res) => {
    const url = generateSlideshowUrl(req.query.q, req.query.interval);
    logger.info(`Generated slideshow URL: ${url}`);
    try {
        fs.writeFileSync(urlFilePath, url, "utf8");
        loadBrowserUrl(url);
        logger.info("Slideshow started successfully");
        res.status(200).send(`Playing slideshow with URL: ${url}`);
    } catch (error) {
        logger.error(`Error starting slideshow: ${error.message}`);
        res.status(500).send("Failed to start slideshow");
    }
});

app.get("/api/screen", async (req, res) => {
    logger.info("Accessed /api/screen");
    const cmdScreenStatus = "vcgencmd display_power";
    const cmdScreenOff = "sudo vcgencmd display_power 0";
    const cmdScreenOn = "sudo vcgencmd display_power 1";
    try {
        const resp = await exec(cmdScreenStatus);
        const screenState = resp.stdout.trim();
        if (screenState === "display_power=1") {
            await exec(cmdScreenOff);
            logger.info("Screen turned OFF");
            res.status(200).send("Screen is OFF");
        } else if (screenState === "display_power=0") {
            await exec(cmdScreenOn);
            logger.info("Screen turned ON");
            res.status(200).send("Screen is ON");
        } else {
            throw new Error(`Unexpected response: ${screenState}`);
        }
    } catch (error) {
        logger.error(`Error toggling screen: ${error.message}`);
        res.status(500).send("Failed to toggle screen");
    }
});

app.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
});
