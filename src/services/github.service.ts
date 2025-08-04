import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import fs from "fs";
import { GitHubPullRequest, GitHubRepository } from "../types/github";

export class GitHubService {
    private app: App;

    constructor() {
        this.app = new App({
            appId: process.env.GITHUB_APP_ID!,
            privateKey: fs.readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH!, 'utf8')
        });
    }

    /**
     * Get authenticated Octokit instance for installation
     * Uses the most reliable approach
     */
    private async getOctokit(installationId: number): Promise<Octokit> {
        try {
            console.log(` Getting Octokit for installation: ${installationId}`);
            
            // Use the app's built-in method to get authenticated octokit
            const octokit = await this.app.getInstallationOctokit(installationId);
            
            console.log(` Created Octokit instance for installation ${installationId}`);
            return octokit;

        } catch (error) {
            console.error(` Error creating Octokit instance for installation ${installationId}:`, error);
            throw new Error(`Failed to authenticate with GitHub: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get pull request files with diff data
     */
    async getPRFiles(
        installationId: number,
        owner: string,
        repo: string,
        prNumber: number
    ) {
        try {
            console.log(` Fetching files for PR #${prNumber} in ${owner}/${repo}`);
            
            const octokit = await this.getOctokit(installationId);
            
            const { data: files } = await octokit.rest.pulls.listFiles({
                owner,
                repo,
                pull_number: prNumber,
                per_page: 100 // GitHub's max per page
            });

            console.log(` Retrieved ${files.length} files for PR #${prNumber}`);
            return files;

        } catch (error) {
            console.error(` Error fetching PR files for #${prNumber}:`, error);
            throw new Error(`Failed to fetch PR files: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get pull request details
     */
    async getPRDetails(
        installationId: number,
        owner: string,
        repo: string,
        prNumber: number
    ): Promise<GitHubPullRequest> {
        try {
            console.log(` Fetching PR details for #${prNumber} in ${owner}/${repo}`);
            
            const octokit = await this.getOctokit(installationId);
            
            const { data } = await octokit.rest.pulls.get({
                owner,
                repo,
                pull_number: prNumber
            });

            console.log(` Retrieved PR details for #${prNumber}: ${data.title}`);
            return data as GitHubPullRequest;

        } catch (error) {
            console.error(` Error fetching PR details for #${prNumber}:`, error);
            throw new Error(`Failed to fetch PR details: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get file content at specific commit
     */
    async getFileContent(
        installationId: number,
        owner: string,
        repo: string,
        path: string,
        ref: string
    ): Promise<string | null> {
        try {
            console.log(` Fetching file content: ${path} at ${ref}`);
            
            const octokit = await this.getOctokit(installationId);
            
            const { data } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path,
                ref
            });

            // Handle file content (not directory)
            if ('content' in data && !Array.isArray(data)) {
                const content = Buffer.from(data.content, 'base64').toString('utf8');
                console.log(` Retrieved content for ${path} (${content.length} chars)`);
                return content;
            }

            console.log(`  ${path} is not a file or is empty`);
            return null;

        } catch (error) {
            console.error(` Error fetching file content for ${path}:`, error);
            return null;
        }
    }

    /**
     * Post review comments on PR
     */
    async postReviewComments(
        installationId: number,
        owner: string,
        repo: string,
        prNumber: number,
        comments: Array<{
            path: string;
            line: number;
            body: string;
            side?: 'LEFT' | 'RIGHT';
        }>,
        reviewBody: string,
        event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' = 'COMMENT'
    ): Promise<void> {
        try {
            console.log(` Posting review with ${comments.length} comments for PR #${prNumber}`);
            
            const octokit = await this.getOctokit(installationId);

            const reviewPayload = {
                owner,
                repo,
                pull_number: prNumber,
                body: reviewBody,
                event: event,
                comments: comments.map(comment => ({
                    path: comment.path,
                    line: comment.line,
                    body: comment.body,
                    side: comment.side || 'RIGHT' as const
                }))
            };

            const { data: review } = await octokit.rest.pulls.createReview(reviewPayload);
            
            console.log(` Posted review with ${comments.length} comments for PR #${prNumber}`);
            console.log(` Review URL: ${review.html_url}`);

        } catch (error) {
            console.error(` Error posting review comments for PR #${prNumber}:`, error);
            throw new Error(`Failed to post review: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Add single comment to PR (general comment, not code review)
     */
    async postPRComment(
        installationId: number,
        owner: string,
        repo: string,
        prNumber: number,
        body: string
    ): Promise<void> {
        try {
            console.log(` Posting comment on PR #${prNumber}`);
            
            const octokit = await this.getOctokit(installationId);

            await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: prNumber,
                body
            });

            console.log(`Posted comment on PR #${prNumber}`);

        } catch (error) {
            console.error(` Error posting comment on PR #${prNumber}:`, error);
            throw new Error(`Failed to post comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Update PR comment (for progress updates)
     */
    async updatePRComment(
        installationId: number,
        owner: string,
        repo: string,
        commentId: number,
        body: string
    ): Promise<void> {
        try {
            console.log(` Updating comment ${commentId}`);
            
            const octokit = await this.getOctokit(installationId);

            await octokit.rest.issues.updateComment({
                owner,
                repo,
                comment_id: commentId,
                body
            });

            console.log(` Updated comment ${commentId}`);

        } catch (error) {
            console.error(`Error updating comment ${commentId}:`, error);
            throw new Error(`Failed to update comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Check if installation has access to repository
     */
    async hasRepoAccess(installationId: number, owner: string, repo: string): Promise<boolean> {
        try {
            console.log(`Checking access to ${owner}/${repo}`);
            
            const octokit = await this.getOctokit(installationId);
            
            await octokit.rest.repos.get({
                owner,
                repo
            });
            
            console.log(`Confirmed access to ${owner}/${repo}`);
            return true;

        } catch (error) {
            console.error(`No access to repository ${owner}/${repo}:`, error);
            return false;
        }
    }

    /**
     * Get installation repositories
     */
    async getInstallationRepos(installationId: number): Promise<GitHubRepository[]> {
        try {
            console.log(` Fetching repositories for installation ${installationId}`);
            
            const octokit = await this.getOctokit(installationId);
            
            const { data } = await octokit.rest.apps.listReposAccessibleToInstallation();
            
            console.log(`Retrieved ${data.repositories.length} repositories for installation ${installationId}`);
            return data.repositories as GitHubRepository[];

        } catch (error) {
            console.error(`Error fetching installation repositories:`, error);
            throw new Error(`Failed to fetch repositories: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Validate installation and get basic info
     */
    async validateInstallation(installationId: number): Promise<{
        valid: boolean;
        account?: {
            login: string;
            type: string;
        };
    }> {
        try {
            console.log(`Validating installation ${installationId}`);
            
            const octokit = await this.getOctokit(installationId);
            
            const { data: installation } = await octokit.rest.apps.getInstallation({
                installation_id: installationId
            });
            
            console.log(`Installation ${installationId} is valid for ${installation.account.login}`);
            
            return {
                valid: true,
                account: {
                    login: installation.account.login,
                    type: installation.account.type
                }
            };

        } catch (error) {
            console.error(`Invalid installation ${installationId}:`, error);
            return { valid: false };
        }
    }

    /**
     * Get rate limit status
     */
    async getRateLimit(installationId: number): Promise<{
        limit: number;
        remaining: number;
        reset: Date;
    }> {
        try {
            const octokit = await this.getOctokit(installationId);
            
            const { data } = await octokit.rest.rateLimit.get();
            
            return {
                limit: data.rate.limit,
                remaining: data.rate.remaining,
                reset: new Date(data.rate.reset * 1000)
            };

        } catch (error) {
            console.error(`Error fetching rate limit:`, error);
            throw new Error(`Failed to fetch rate limit: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getCommit(
        installationId: number,
        owner: string,
        repo: string,
        sha: string
    ) {
        try {
            console.log(`Fetching commit ${sha.substring(0, 7)} in ${owner}/${repo}`);
            
            const octokit = await this.getOctokit(installationId);
            
            const { data } = await octokit.rest.repos.getCommit({
                owner,
                repo,
                ref: sha
            });

            console.log(`Retrieved commit ${sha.substring(0, 7)}: ${data.commit.message.split('\n')[0]}`);
            return data;

        } catch (error) {
            console.error(`Error fetching commit ${sha}:`, error);
            throw new Error(`Failed to fetch commit: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async compareCommits(
        installationId: number,
        owner: string,
        repo: string,
        base: string,
        head: string
    ) {
        try {
            console.log(`Comparing ${base.substring(0, 7)}...${head.substring(0, 7)} in ${owner}/${repo}`);
            
            const octokit = await this.getOctokit(installationId);
            
            const { data } = await octokit.rest.repos.compareCommits({
                owner,
                repo,
                base,
                head
            });

            console.log(` Comparison complete: ${data.files?.length || 0} files changed`);
            return data;

        } catch (error) {
            console.error(`Error comparing commits:`, error);
            throw new Error(`Failed to compare commits: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

export const githubService = new GitHubService();