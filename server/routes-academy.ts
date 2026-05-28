import { Router, type Request, type Response } from 'express';
import { education } from './services/education';
import { CreditService } from './services/credits';
import { logger } from './utils/logger';
import type { AuthenticatedRequest } from './types/request';
import { Errors } from './utils/errors';

const creditService = new CreditService();

const router = Router();


function getUser(req: Request) {
  const user = req.user;
  if (!user) throw new Error('User not found');
  return user;
}

// GET /courses — list all courses with optional filters
router.get('/courses', async (req: Request, res: Response) => {
  try {
    const { category, level, status } = req.query;
    const courses = await education.listCourses({
      category: category as string | undefined,
      level: level as string | undefined,
      status: status as string | undefined,
    });
    res.json({ courses });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /courses/:id — course details + modules
router.get('/courses/:id', async (req: Request, res: Response) => {
  try {
    const course = await education.getCourse(parseInt(req.params.id));
    res.json({ course });
  } catch {
    Errors.notFound(res, 'Course');
  }
});

// GET /courses/:id/stats — enrollment count, avg rating, completion rate
router.get('/courses/:id/stats', async (req: Request, res: Response) => {
  try {
    const stats = await education.getCourseStats(parseInt(req.params.id));
    res.json({ stats });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /courses — create a new course (org-published content)
router.post('/courses', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const courseId = await education.createCourse(org.id, req.body);
    res.json({ courseId });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /courses/:id/publish
router.post('/courses/:id/publish', async (req: Request, res: Response) => {
  try {
    await education.publishCourse(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /enrollments — current user's enrollments with progress
router.get('/enrollments', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const enrollments = await education.getUserEnrollments(user.id);
    res.json({ enrollments });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /enrollments — enroll in a course
router.post('/enrollments', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const { courseId } = req.body;
    const enrollment = await education.enrollInCourse(user.id, parseInt(courseId));
    res.json({ enrollment });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// PATCH /enrollments/:courseId/progress — update module progress
router.patch('/enrollments/:courseId/progress', async (req: Request, res: Response) => {
  try {
    getUser(req);
    const { moduleId } = req.body;
    // updateProgress(enrollmentId, moduleId). TODO(tsc): the route exposes a
    // :courseId path param but the service identifies progress by enrollmentId;
    // the completed/quizScore body fields are not accepted by the service.
    await education.updateProgress(
      parseInt(req.params.courseId),
      parseInt(moduleId)
    );
    res.json({ success: true });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /courses/:id/rate
router.post('/courses/:id/rate', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const { rating } = req.body;
    // rateCourse(userId, courseId, rating) — review text is not accepted.
    await education.rateCourse(user.id, parseInt(req.params.id), rating);
    res.json({ success: true });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /recommended — AI-recommended courses for the current user
router.get('/recommended', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const courses = await education.getRecommendedCourses(user.id);
    res.json({ courses });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// POST /tutor/message — AI tutor chat
router.post('/tutor/message', async (req: Request, res: Response) => {
  try {
    const { message, courseId, history } = req.body;

    // Credit check for AI tutor
    const org = (req as AuthenticatedRequest).organization;
    if (org) {
      const hasCredits = await creditService.hasEnoughCredits(org.id, 2);
      if (!hasCredits) {
        return res.status(402).json({ error: 'Insufficient credits for AI tutor' });
      }
    }

    // Migrated from direct OpenAI to central aiRouter (P1-36 / P1-37):
    //   - removes the legacy preview-tier model pin
    //   - flows through cost tracking, semantic caching, prompt versioning
    const { routeAITask, TaskComplexity } = await import('./services/aiRouter');

    const systemPrompt = `You are an expert real estate educator for AcreOS Academy.
You help investors learn about land acquisition, seller financing, tax liens, due diligence,
and land flipping strategies. Be concise, practical, and use real examples.
${courseId ? `The student is currently studying course ID: ${courseId}.` : ''}`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...(history || []).slice(-6).map((h: any) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user' as const, content: message },
    ];

    const completion = await routeAITask({
      taskType: 'academy_tutor',
      complexity: TaskComplexity.MODERATE,
      taskTier: 'critical', // customer-visible tutor — quality matters
      messages,
      maxTokens: 600,
    }, { orgId: org?.id });

    const reply = completion.content || 'I could not generate a response.';

    // Deduct credits after successful AI call
    if (org) {
      creditService.deductCredits(org.id, 2, 'AI tutor chat').catch((err) =>
        logger.error('[academy] credit deduction failed', err instanceof Error ? err : undefined)
      );
    }

    res.json({ reply });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
