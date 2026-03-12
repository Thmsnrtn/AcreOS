// @ts-nocheck
import { Router, type Request, type Response } from 'express';
import { education } from './services/education';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

function getUser(req: Request) {
  const user = (req as any).user;
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /courses/:id — course details + modules
router.get('/courses/:id', async (req: Request, res: Response) => {
  try {
    const course = await education.getCourse(parseInt(req.params.id));
    res.json({ course });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// GET /courses/:id/stats — enrollment count, avg rating, completion rate
router.get('/courses/:id/stats', async (req: Request, res: Response) => {
  try {
    const stats = await education.getCourseStats(parseInt(req.params.id));
    res.json({ stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /courses — create a new course (org-published content)
router.post('/courses', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const courseId = await education.createCourse(org.id, req.body);
    res.json({ courseId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /courses/:id/publish
router.post('/courses/:id/publish', async (req: Request, res: Response) => {
  try {
    await education.publishCourse(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /enrollments — current user's enrollments with progress
router.get('/enrollments', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const enrollments = await education.getUserEnrollments(user.id);
    res.json({ enrollments });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /enrollments — enroll in a course
router.post('/enrollments', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const { courseId } = req.body;
    const enrollment = await education.enrollInCourse(user.id, parseInt(courseId));
    res.json({ enrollment });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /enrollments/:courseId/progress — update module progress
router.patch('/enrollments/:courseId/progress', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const { moduleId, completed, quizScore } = req.body;
    await education.updateProgress(
      user.id,
      parseInt(req.params.courseId),
      parseInt(moduleId),
      { completed, quizScore }
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /courses/:id/rate
router.post('/courses/:id/rate', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const { rating, review } = req.body;
    await education.rateCourse(user.id, parseInt(req.params.id), rating, review);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /recommended — AI-recommended courses for the current user
router.get('/recommended', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const courses = await education.getRecommendedCourses(user.id);
    res.json({ courses });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /tutor/message — AI tutor chat
router.post('/tutor/message', async (req: Request, res: Response) => {
  try {
    const { message, courseId, history } = req.body;
    // Simple AI tutor response via OpenAI (reuse existing AI infrastructure)
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are an expert land investment educator for AcreOS Academy.
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

    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages,
      max_tokens: 600,
    });

    const reply = completion.choices[0]?.message?.content || 'I could not generate a response.';
    res.json({ reply });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
