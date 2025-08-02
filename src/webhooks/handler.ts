import { GitHubWebhookPayload, GitHubPullRequest, GitHubRepository, GitHubInstallation } from '../types/github';
import { ReviewData } from '../types/review';
import { prisma } from '../prisma';
import { githubService } from '../services/github.service';
import { fileAnalysisService } from '../services/file-analysis.service';

export class WebhookHandlers {

    static async handlePullRequest(payload: GitHubWebhookPayload): Promise<void> {
        const { action, pull_request, repository, installation } = payload;

        if (!pull_request || !installation) {
            console.log('Missing pull_request or installation in payload');
            return;
        }

        console.log(`Processing PR ${action}: ${repository.full_name}#${pull_request.number}`);

        try {
            switch (action) {
                case 'opened':
                case 'synchronize':
                case 'reopened':
                    await this.queueReview(pull_request, repository, installation.id);
                    break;
                case 'closed':
                    await this.cleanupReview(pull_request, repository);
                    break;
                default:
                    console.log(`Ignoring PR action: ${action}`);
            }
        } catch (error) {
            console.error(`Error handling PR ${action}:`, error);
            await this.updateReviewStatus(pull_request.number, repository.full_name, 'failed', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    static async queueReview(
        pullRequest: GitHubPullRequest,
        repository: GitHubRepository,
        installationId: number
    ): Promise<void> {
        try {
            const reviewData: ReviewData = {
                pr_title: pullRequest.title,
                pr_author: pullRequest.user.login,
                pr_url: pullRequest.html_url,
                head_sha: pullRequest.head.sha,
                base_sha: pullRequest.base.sha,
                changed_files: pullRequest.changed_files || 0,
                additions: pullRequest.additions || 0,
                deletions: pullRequest.deletions || 0,
                step: 'queued',
                progress: 0
            };


            const review = await prisma.$transaction(async (tx) => {

                const review = await tx.review.upsert({
                    where: {
                        prNumber_repoFullName: {
                            prNumber: pullRequest.number,
                            repoFullName: repository.full_name
                        }
                    },
                    update: {
                        status: 'pending',
                        reviewData: reviewData as any,
                        createdAt: new Date(),
                        completedAt: null
                    },
                    create: {
                        prNumber: pullRequest.number,
                        repoFullName: repository.full_name,
                        installationId: installationId,
                        status: 'pending',
                        reviewData: reviewData as any
                    }
                });


                await tx.reviewComment.deleteMany({
                    where: { reviewId: review.id }
                });

                await tx.fileChange.deleteMany({
                    where: { reviewId: review.id }
                });

                return review;
            });

            console.log(`Queued review for PR #${pullRequest.number} (ID: ${review.id})`);


            await this.startReviewProcess(review.id, repository, installationId);

        } catch (error) {
            console.error('Error queuing review:', error);
            throw error;
        }
    }

    static async startReviewProcess(
        reviewId: number,
        repository: GitHubRepository,
        installationId: number
    ): Promise<void> {
        try {

            await this.updateReviewStatus(null, null, 'in_progress', {
                step: 'fetching_files',
                progress: 10
            }, reviewId);


            const review = await prisma.review.findUnique({
                where: { id: reviewId }
            });

            if (!review) {
                throw new Error(`Review ${reviewId} not found`);
            }

            const [owner, repo] = repository.full_name.split('/');


            const files = await githubService.getPRFiles(
                installationId,
                owner,
                repo,
                review.prNumber
            );

            await this.updateReviewStatus(null, null, 'in_progress', {
                step: 'analyzing_files',
                progress: 30,
                files_found: files.length
            }, reviewId);


            let analyzedCount = 0;
            for (const file of files) {
                const analysis = fileAnalysisService.analyzeFile(file);

                await prisma.fileChange.create({
                    data: {
                        reviewId: reviewId,
                        filename: analysis.filename,
                        status: file.status,
                        language: analysis.language,
                        additions: analysis.additions,
                        deletions: analysis.deletions,
                        patch: analysis.patch,
                        analyzed: true,
                        shouldReview: analysis.shouldReview
                    }
                });


                if (analysis.issues.length > 0) {
                    const comments = analysis.issues.map(issue => ({
                        reviewId: reviewId,
                        fileName: analysis.filename,
                        lineNumber: issue.line,
                        severity: issue.severity,
                        type: issue.type,
                        message: issue.message,
                        suggestion: issue.suggestion || null,
                        rule: issue.rule || null
                    }));

                    await prisma.reviewComment.createMany({
                        data: comments
                    });
                }

                analyzedCount++;

                const progress = 30 + Math.floor((analyzedCount / files.length) * 40);
                await this.updateReviewStatus(null, null, 'in_progress', {
                    step: 'analyzing_files',
                    progress,
                    files_analyzed: analyzedCount
                }, reviewId);
            }

            await this.updateReviewStatus(null, null, 'in_progress', {
                step: 'ready_for_ai_review',
                progress: 70,
                files_analyzed: analyzedCount,
                files_to_review: files.filter(f => fileAnalysisService.shouldReviewFile(f.filename, f.status)).length
            }, reviewId);

            console.log(`🔍 Analyzed ${analyzedCount} files for review ${reviewId}`);

            //Queue for AI review (Day 3)

        } catch (error) {
            console.error(`Error in review process for ${reviewId}:`, error);
            await this.updateReviewStatus(null, null, 'failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                step: 'failed'
            }, reviewId);
        }
    }

    static async cleanupReview(pullRequest: GitHubPullRequest, repository: GitHubRepository): Promise<void> {
        try {
            const updatedReview = await prisma.review.updateMany({
                where: {
                    prNumber: pullRequest.number,
                    repoFullName: repository.full_name
                },
                data: {
                    status: 'cancelled'
                }
            });

            console.log(`Cleaned up ${updatedReview.count} review(s) for closed PR #${pullRequest.number}`);

        } catch (error) {
            console.error('Error cleaning up review:', error);
        }
    }

    static async updateReviewStatus(
        prNumber: number | null,
        repoFullName: string | null,
        status: string,
        reviewData: Partial<ReviewData>,
        reviewId?: number
    ): Promise<void> {
        try {
            const updateData = {
                status,
                reviewData: reviewData as any,
                ...(status === 'completed' && { completedAt: new Date() })
            };

            if (reviewId) {
                await prisma.review.update({
                    where: { id: reviewId },
                    data: updateData
                });
            } else if (prNumber && repoFullName) {
                await prisma.review.updateMany({
                    where: {
                        prNumber,
                        repoFullName
                    },
                    data: updateData
                });
            }
        } catch (error) {
            console.error('Error updating review status:', error);
        }
    }

    static async handleInstallation(payload: any): Promise<void> {
        const { action, installation, repositories = [] } = payload;

        console.log(`Installation ${action} for ${installation.account.login}`);

        try {
            if (action === 'created') {
                await this.recordInstallation(installation, repositories);
            } else if (action === 'deleted') {
                await this.removeInstallation(installation.id);
            } else if (action.startsWith('repositories_')) {
                await this.handleRepositoryChanges(installation, repositories, action);
            }
        } catch (error) {
            console.error(`Error handling installation ${action}:`, error);
        }
    }

    static async recordInstallation(installation: GitHubInstallation, repositories: any[] = []): Promise<void> {
        try {
            await prisma.$transaction(async (tx) => {
                await tx.installation.upsert({
                    where: {
                        installationId: installation.id
                    },
                    update: {
                        accountLogin: installation.account.login,
                        accountType: installation.account.type,
                        updatedAt: new Date()
                    },
                    create: {
                        installationId: installation.id,
                        accountLogin: installation.account.login,
                        accountType: installation.account.type
                    }
                });


                for (const repo of repositories) {
                    await tx.repository.upsert({
                        where: {
                            installationId_repoId: {
                                installationId: installation.id,
                                repoId: repo.id
                            }
                        },
                        update: {
                            fullName: repo.full_name,
                            private: repo.private
                        },
                        create: {
                            installationId: installation.id,
                            repoId: repo.id,
                            fullName: repo.full_name,
                            private: repo.private
                        }
                    });
                }
            });

            console.log(`Recorded installation for ${installation.account.login} with ${repositories.length} repositories`);

        } catch (error) {
            console.error('Error recording installation:', error);
        }
    }

    static async removeInstallation(installationId: number): Promise<void> {
        try {
            await prisma.$transaction(async (tx) => {

                await tx.review.updateMany({
                    where: { installationId },
                    data: { status: 'cancelled' }
                });

                await tx.repository.deleteMany({
                    where: { installationId }
                });


                await tx.installation.delete({
                    where: { installationId }
                });
            });

            console.log(`Removed installation ${installationId}`);

        } catch (error) {
            console.error('Error removing installation:', error);
        }
    }

    static async handleRepositoryChanges(installation: GitHubInstallation, repositories: any[], action: string): Promise<void> {
        try {
            if (action === 'repositories_added') {
                for (const repo of repositories) {
                    await prisma.repository.upsert({
                        where: {
                            installationId_repoId: {
                                installationId: installation.id,
                                repoId: repo.id
                            }
                        },
                        update: {
                            fullName: repo.full_name,
                            private: repo.private
                        },
                        create: {
                            installationId: installation.id,
                            repoId: repo.id,
                            fullName: repo.full_name,
                            private: repo.private
                        }
                    });
                }
                console.log(`Added ${repositories.length} repositories`);

            } else if (action === 'repositories_removed') {
                for (const repo of repositories) {
                    await prisma.repository.delete({
                        where: {
                            installationId_repoId: {
                                installationId: installation.id,
                                repoId: repo.id
                            }
                        }
                    });
                }
                console.log(`Removed ${repositories.length} repositories`);
            }

        } catch (error) {
            console.error('Error handling repository changes:', error);
        }
    }
}