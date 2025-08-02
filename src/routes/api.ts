import express from "express"
import { prisma } from "../prisma";

export const router = express.Router();

router.get('/reviews', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const status = req.query.status;

        const where = status ? { status } : {};

        const reviews = await prisma.review.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            include: {
                installation: {
                    select: {
                        accountLogin: true,
                        accountType: true
                    }
                }
            },
        })

        const total = await prisma.review.count({ where })
        res.json({
            reviews,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
})

router.get('/reviews/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const review = await prisma.review.findUnique({
            where: { id: parseInt(id) },
            include: {
                installation: {
                    select: {
                        accountLogin: true,
                        accountType: true
                    }
                }
            }
        })

        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }
        const comments = await prisma.reviewComment.findMany({
            where: { reviewId: parseInt(id) },
            orderBy: { lineNumber: 'asc' }
        })
        res.json({
            ...review,
            comments
        });

    } catch (error) {
        console.error('Error fetching review:', error);
        res.status(500).json({ error: 'Failed to fetch review' });
    }
})

router.get('/repos/:owner/:repo/reviews', async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const repoFullName = `${owner}/${repo}`;

        const reviews = await prisma.review.findMany({
            where: { repoFullName },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        res.json(reviews);

    } catch (error) {
        console.error('Error fetching repository reviews:', error);
        res.status(500).json({ error: 'Failed to fetch repository reviews' });
    }
});


router.get('/stats', async (req, res) => {
    try {
        const [
            installationCount,
            repositoryCount,
            reviewStats,
            recentActivity
        ] = await Promise.all([
            prisma.installation.count(),
            prisma.repository.count(),
            prisma.review.groupBy({
                by: ['status'],
                _count: true
            }),
            prisma.review.findMany({
                where: {
                    createdAt: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
                select: {
                    id: true,
                    prNumber: true,
                    repoFullName: true,
                    status: true,
                    createdAt: true
                }
            })
        ]);

        const statusCounts = reviewStats.reduce((acc, item) => {
            acc[item.status] = item._count;
            return acc;
        }, {});

        res.json({
            installations: installationCount,
            repositories: repositoryCount,
            reviews: {
                total: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
                ...statusCounts
            },
            recentActivity
        });

    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});



router.get('/health', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({
            status: 'healthy',
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            database: 'disconnected',
            error: error
        });
    }
});