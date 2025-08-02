import { App } from "@octokit/app";
import { Octokit } from '@octokit/rest';
import fs from "fs"
import { GitHubPullRequest, GitHubRepository } from "../types/github";

export class GitHubService {
    private app: App;

    constructor() {
        this.app = new App({
            appId: process.env.GITHUB_APP_ID!,
            privateKey: fs.readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH!, 'utf8')
        });
    }

    private async getOctokit(installationId: number): Promise<Octokit> {
        return await this.app.getInstallationOctokit(installationId);
    }

    async getPRFiles(
        installationId: number,
        owner: string,
        repo: string,
        prNumber: number
    ) {
        try {
            const octokit = await this.getOctokit(installationId);
            const { data } = await octokit.rest.pulls.get({
                owner,
                repo,
                pull_number: prNumber
            })
            return data as GitHubPullRequest
        } catch (error) {
            console.error(`Error fetching PR files for #${prNumber}:`, error);
            throw new Error(`Failed to fetch PR files: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async hasRepoAccess(installationId: number, owner: string, repo: string) {
        try {
            const octokit = await this.getOctokit(installationId);
            await octokit.rest.repos.get({
                owner,
                repo
            })
            return true;
        } catch (error) {
            console.error(`No access to repository ${owner}/${repo}:`, error);
            return false;
        }
    }

    async getInstallationRepos(installationId: number): Promise<GitHubRepository[]> {
        try {
            const octokit = await this.getOctokit(installationId);

            const { data } = await octokit.rest.apps.listReposAccessibleToInstallation();
            return data.repositories as GitHubRepository[];

        } catch (error) {
            console.error(`Error fetching installation repositories:`, error);
            throw new Error(`Failed to fetch repositories: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

export const githubService = new GitHubService();