import express from "express"
import dotenv from "dotenv"
import { App } from "@octokit/app"
import fs from "fs"
import { Webhooks } from "@octokit/webhooks"
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

const webhook = new Webhooks({
    secret: process.env.WEBHOOK_SECRET,
})

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(` Webhook endpoint: http://localhost:${PORT}/webhooks/github`);
});
