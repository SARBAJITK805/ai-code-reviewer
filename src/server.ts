import express from "express"
import dotenv from "dotenv"
import { WebhookHandler } from "./webhooks/handler"
import { App } from "@octokit/app"
import fs from "fs"
import { createNodeMiddleware, Webhooks } from "@octokit/webhooks"
import { prisma } from "./prisma"

const app = express()
dotenv.config()

const PORT = process.env.PORT || 3000;

if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_PRIVATE_KEY_PATH || !process.env.WEBHOOK_SECRET) {
    throw new Error("env variable doesnt exist")
}

const github = new App({
    appId: process.env.GITHUB_APP_ID,
    privateKey: fs.readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH, 'utf8'),
})

const webhooks = new Webhooks({
    secret: process.env.WEBHOOK_SECRET
})

webhooks.onError((error) => {
    console.log("WEBHOOK ERROR:");
    console.log(`Error message: ${error}`);
});

webhooks.onAny(async ({ id, name, payload }) => {
    console.log("WEBHOOK EVENT RECEIVED!");
    console.log(`Event: ${name}, ID: ${id}`);
})

webhooks.on('pull_request', async ({ id, name, payload }) => {
    try {
        await WebhookHandler.handelPullRequest({ payload })
    } catch (error) {
        console.log("error handling pull request : ", error);
    }
});

webhooks.on('installation', async ({ payload }) => {
    try {
        await WebhookHandler.handleInstallation({
            action: payload.action,
            installation: payload.installation,
            repositories: payload.repositories || []
        });
    } catch (error) {
        console.error('Error handling installation:', error);
    }
});

webhooks.on('installation_repositories', async ({ payload }) => {
    try {
        await WebhookHandler.handleInstallation({
            action: 'repositories_' + payload.action,
            installation: payload.installation,
            repositories: payload.repositories_added || payload.repositories_removed || []
        });
    } catch (error) {
        console.error('Error handling installation repositories:', error);
    }
});

const middleware = createNodeMiddleware(webhooks, { path: "/webhooks/github" });
app.use(middleware);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    console.log(`Webhook endpoint: http://localhost:${PORT}/webhooks/github`);
});