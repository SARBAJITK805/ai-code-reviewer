import { prisma } from "../prisma";

export class WebhookHandler {
    static async handelPullRequest({ payload }) {
        const { action, pull_request, repository, installation } = payload;
        console.log(`Processing PR ${action}: ${repository.full_name}#${pull_request.number}`);

        try {
            switch (action) {
                case 'synchronize':
                    await this.queueReview(pull_request, repository, installation.id)
                    break;
                case 'closed':
                    await this.cleanup(pull_request, repository)
                default:
                    console.log(`Ignoring PR action: ${action}`);
                    break;
            }
        } catch (error) {
            console.error(` Error handling PR ${action}:`, error);
        }
    }
    static async queueReview(pullRequest, repository, installationId) {
        try {
            const reviewData = {
                pr_title: pullRequest.title,
                pr_author: pullRequest.user.login,
                pr_url: pullRequest.html_url,
                head_sha: pullRequest.head.sha,
                base_sha: pullRequest.base.sha,
                changed_files: pullRequest.changed_files || 0,
                additions: pullRequest.additions || 0,
                deletions: pullRequest.deletions || 0
            }
            const review = await prisma.review.upsert({
                where: {
                    prNumber_repoFullName: {
                        prNumber: pullRequest.number,
                        repoFullName: repository.full_name
                    }
                },
                create: {
                    prNumber: pullRequest.number,
                    repoFullName: repository.full_name,
                    installationId: installationId,
                    status: 'pending',
                    reviewData: reviewData
                },
                update: {
                    status: 'pending',
                    reviewData: reviewData,
                    createdAt: new Date()
                }
            })

            await this.simulateReviewProgress(review.id);

        } catch (error) {
            console.log('Error queuing review : ', error);
        }
    }

    static async cleanup(pullRequest, repository) {
        try {
            await prisma.review.updateMany({
                where: {
                    prNumber: pullRequest.number,
                    repoFullName: repository.full_name
                },
                data: {
                    status: "cancelled"
                }
            })
        } catch (error) {
            console.log("Error cleaning up review : ", error);
        }
    }

    static async handleInstallation({ action, installation, repositories = [] }) {
        try {
            if (action == 'created') {
                await this.recordInstallation(installation, repositories)
            } else if (action == 'deleted') {
                await this.removeInstalation(installation.id)
            } else if (action.startsWith('repositories_')) {
                await this.handleRepositoryChanges(installation, action, repositories)
            }
        } catch (error) {
            console.log("error while installation : ", error);
        }
    }

    static async recordInstallation(installation, repositories = []) {
        try {
            await prisma.$transaction(async (tx) => {
                const installationRecord = await tx.installation.upsert({
                    where: { installationId: installation.id },
                    create: {
                        installationId: installation.id,
                        accountLogin: installation.account.login,
                        accountType: installation.account.type
                    },
                    update: {
                        accountLogin: installation.account.login,
                        accountType: installation.account.type,
                        updatedAt: new Date()
                    }
                })
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
                console.log("Recorded installation");
            })
        } catch (error) {
            console.log("Error while recording installation : ", error);
        }
    }

    static async removeInstallation(installationId) {
        try {
            await prisma.$transaction(async (tx) => {
                await tx.repository.deleteMany({
                    where: { installationId: installationId }
                })

                await tx.review.updateMany({
                    where: { installationId },
                    data: { status: "cancelled" }
                })

                await tx.installation.delete({
                    where: { installationId }
                })
            })
        } catch (error) {
            console.log("error removing installation : ", error);
        }
    }

    static async handleRepositoryChanges(installation, repositories, action) {
        try {
            if (action == 'repositories_added') {
                for (const repo of repositories) {
                    await prisma.repository.upsert({
                        where: {
                            installationId_repoId: {
                                installationId: installation.id,
                                repoId: repo.id
                            }
                        },
                        create: {
                            installationId: installation.id,
                            repoId: repo.id,
                            fullName: repo.full_name,
                            private: repo.private
                        },
                        update: {
                            fullName: repo.full_name,
                            private: repo.private
                        }
                    })
                }
            } else if (action == "repositories_removed") {
                for (const repo of repositories) {
                    await prisma.repository.delete({
                        where: {
                            installationId_repoId: {
                                installationId: installation.id,
                                repoId: repo.id
                            }
                        }
                    })
                }
            }
        } catch (error) {
            console.log("Error haneling repo changes : ", error);
        }
    }

    static async simulateReviewProgress(reviewId) {
        try {
            setTimeout(async () => {
                await prisma.review.update({
                    where: { id: reviewId },
                    data: {
                        status: 'in_progress',
                        reviewData: {
                            step: 'analyzing_files',
                            progress: 50
                        }
                    }
                });
                console.log(`Review ${reviewId} in progress...`);
            }, 2000);

            setTimeout(async () => {
                await prisma.review.update({
                    where: { id: reviewId },
                    data: {
                        status: 'completed',
                        completedAt: new Date(),
                        reviewData: {
                            step: 'completed',
                            progress: 100,
                            issues_found: Math.floor(Math.random() * 5)
                        }
                    }
                });
                console.log(`Review ${reviewId} completed!`);
            }, 5000);

        } catch (error) {
            console.error('Error simulating review progress:', error);
        }
    }
}
