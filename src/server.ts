import express from "express"
import dotenv from "dotenv"
import { App } from "@octokit/app"
import fs from "fs"
import { createNodeMiddleware, Webhooks } from "@octokit/webhooks"
import { prisma } from "./prisma"
const app = express()
dotenv.config()
app.use(express.json())
app.use(express.urlencoded({ extended: true }));


const PORT = process.env.PORT || 3000;

if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_PRIVATE_KEY_PATH || !process.env.WEBHOOK_SECRET) {
    throw new Error("env variable doesnt exist")
}

const github = new App({
    appId: process.env.GITHUB_APP_ID,
    privateKey: fs.readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH, 'utf8'),
})

const webhooks = new Webhooks({
    secret: process.env.WEBHOOK_SECRET,
})

webhooks.onAny(async ({ id, name, payload }) => {
    console.log(payload);
})

const middleware = createNodeMiddleware(webhooks, { path: "/webhooks/github" });

app.use('*', (req, res, next) => {
    console.log("=== ALL REQUESTS DEBUG ===");
    console.log(`Method: ${req.method}`);
    console.log(`Original URL: ${req.originalUrl}`);
    console.log(`URL: ${req.url}`);
    console.log(`Path: ${req.path}`);
    console.log(`Base URL: ${req.baseUrl}`);
    if (req.method === 'POST') {
        console.log(`Content-Type: ${req.headers['content-type']}`);
        console.log(`GitHub Event: ${req.headers['x-github-event']}`);
        console.log(`GitHub Delivery: ${req.headers['x-github-delivery']}`);
        console.log(`User Agent: ${req.headers['user-agent']}`);
    }
    console.log("==========================\n");
    next();
});

app.use(middleware)

app.get('/', async (req, res) => {
    try {
        const reviewCount = await prisma.review.count();
        res.json({
            status: 'AI Code Reviewer is running!',
            timestamp: new Date().toISOString(),
            appId: process.env.GITHUB_APP_ID,
            database: 'connected',
            totalReviews: reviewCount
        })
    } catch (error) {
        res.status(500).json({
            status: 'Error',
            error: error
        });
    }
})


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(` Webhook endpoint: http://localhost:${PORT}/webhooks/github`);
});
