import { db } from '../db';
import { tutorSessions, courseModules } from '../../shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { requireOpenAIClient } from "../utils/openaiClient";
import { logger } from "../utils/logger";

interface TutorMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

class AITutor {
  /**
   * Start a new tutoring session
   */
  async startSession(
    userId: string,
    courseId: number,
    _moduleId?: number
  ): Promise<string> {
    try {
      // TODO(tsc): tutor_sessions has no moduleId/status columns in the frozen
      // schema. moduleId can't be persisted (module-specific context below is
      // therefore unavailable on resume); session lifecycle is tracked via
      // endedAt rather than a status string.
      const [session] = await db.insert(tutorSessions).values({
        userId,
        courseId,
        messages: [],
        durationMinutes: 0,
      }).returning();

      return session.id.toString();
    } catch (error) {
      logger.error('Failed to start tutor session', error);
      throw error;
    }
  }

  /**
   * Send message to AI tutor
   */
  async sendMessage(
    sessionId: number,
    userMessage: string
  ): Promise<string> {
    try {
      const session = await db.query.tutorSessions.findFirst({
        where: eq(tutorSessions.id, sessionId),
      });

      if (!session) {
        throw new Error('Session not found');
      }

      // Module context is unavailable: tutor_sessions doesn't persist moduleId
      // (see startSession TODO). Tutoring proceeds with general course context.
      const moduleContext = '';

      // Build conversation history
      const storedMessages = session.messages ?? [];
      const conversationHistory = storedMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // System prompt for land investment tutoring
      const systemPrompt = `You are an expert land investment tutor for AcreOS Academy. Your role is to:

1. Explain land investment concepts clearly and thoroughly
2. Answer questions about property acquisition, due diligence, financing, and exit strategies
3. Provide practical examples and case studies
4. Guide students through complex topics step-by-step
5. Encourage critical thinking by asking clarifying questions
6. Adapt your teaching style to the student's level

${moduleContext}

Be conversational, supportive, and focus on practical knowledge that students can apply immediately.`;

      // Call OpenAI for response
      const completion = await requireOpenAIClient().chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationHistory,
          { role: 'user', content: userMessage },
        ],
        max_tokens: 800,
        temperature: 0.7,
      });

      const assistantMessage = completion.choices[0].message.content || 'I apologize, I had trouble generating a response.';

      // Update session with new messages (stored shape uses ISO-string timestamps).
      const updatedMessages = [
        ...storedMessages,
        {
          role: 'user',
          content: userMessage,
          timestamp: new Date().toISOString(),
        },
        {
          role: 'assistant',
          content: assistantMessage,
          timestamp: new Date().toISOString(),
        },
      ];

      await db.update(tutorSessions)
        .set({
          messages: updatedMessages,
          messageCount: updatedMessages.length,
        })
        .where(eq(tutorSessions.id, sessionId));

      return assistantMessage;
    } catch (error) {
      logger.error('Failed to send tutor message', error);
      return 'I apologize, but I encountered an error. Please try again.';
    }
  }

  /**
   * End tutoring session
   */
  async endSession(sessionId: number): Promise<void> {
    try {
      const session = await db.query.tutorSessions.findFirst({
        where: eq(tutorSessions.id, sessionId),
      });

      if (!session) {
        throw new Error('Session not found');
      }

      // Calculate duration
      const startedAt = session.createdAt ?? new Date();
      const duration = Math.floor(
        (new Date().getTime() - startedAt.getTime()) / 1000 / 60
      );

      await db.update(tutorSessions)
        .set({
          durationMinutes: duration,
          endedAt: new Date(),
        })
        .where(eq(tutorSessions.id, sessionId));
    } catch (error) {
      logger.error('Failed to end tutor session', error);
      throw error;
    }
  }

  /**
   * Get user's tutoring history
   */
  async getUserSessions(userId: string): Promise<any[]> {
    try {
      return await db.query.tutorSessions.findMany({
        where: eq(tutorSessions.userId, userId),
        orderBy: [desc(tutorSessions.createdAt)],
        limit: 20,
      });
    } catch (error) {
      logger.error('Failed to get user sessions', error);
      return [];
    }
  }

  /**
   * Get session details
   */
  async getSession(sessionId: number): Promise<any> {
    try {
      return await db.query.tutorSessions.findFirst({
        where: eq(tutorSessions.id, sessionId),
      });
    } catch (error) {
      logger.error('Failed to get session', error);
      return null;
    }
  }

  /**
   * Generate quiz questions for a module
   */
  async generateQuiz(moduleId: number): Promise<any[]> {
    try {
      const module = await db.query.courseModules.findFirst({
        where: eq(courseModules.id, moduleId),
      });

      if (!module) {
        throw new Error('Module not found');
      }

      const prompt = `Based on the following educational content about land investment, generate 5 multiple choice questions to test understanding. Each question should have 4 options with one correct answer.

Content:
${module.content}

Format the response as JSON array with this structure:
[
  {
    "question": "Question text",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": 0 (index of correct option),
    "explanation": "Brief explanation of the correct answer"
  }
]`;

      const completion = await requireOpenAIClient().chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
      });

      const response = completion.choices[0].message.content || '[]';

      try {
        return JSON.parse(response);
      } catch {
        // If parsing fails, return empty array
        return [];
      }
    } catch (error) {
      logger.error('Failed to generate quiz', error);
      return [];
    }
  }

  /**
   * Provide personalized study plan
   */
  async generateStudyPlan(
    _userId: string,
    courseId: number
  ): Promise<string> {
    try {
      // Get course modules
      const modules = await db.query.courseModules.findMany({
        where: eq(courseModules.courseId, courseId),
        orderBy: [courseModules.sortOrder],
      });

      if (modules.length === 0) {
        return 'No modules found for this course.';
      }

      const moduleList = modules
        .map((m, i) => `${i + 1}. ${m.title} (${m.durationMinutes ?? 0} min)`)
        .join('\n');

      const prompt = `Create a personalized study plan for a land investment course with the following modules:

${moduleList}

The study plan should:
1. Recommend a weekly schedule
2. Suggest optimal study times
3. Include practice exercises between modules
4. Provide tips for retention
5. Estimate total time commitment

Keep it concise and actionable.`;

      const completion = await requireOpenAIClient().chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
      });

      return completion.choices[0].message.content || 'Failed to generate study plan.';
    } catch (error) {
      logger.error('Failed to generate study plan', error);
      return 'Error generating study plan. Please try again later.';
    }
  }

  /**
   * Analyze user's learning patterns
   */
  async analyzeLearningPattern(userId: string): Promise<{
    totalSessions: number;
    averageSessionDuration: number;
    mostActiveTime: string;
    topTopics: string[];
    learningVelocity: string;
  }> {
    try {
      const sessions = await db.query.tutorSessions.findMany({
        where: eq(tutorSessions.userId, userId),
      });

      const totalSessions = sessions.length;

      const avgDuration = sessions.length > 0
        ? sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / sessions.length
        : 0;

      // Determine most active time (placeholder)
      const mostActiveTime = 'Evening (6-9 PM)';

      // Extract topics from messages (simplified)
      const topTopics = ['Property Valuation', 'Due Diligence', 'Financing Options'];

      // Determine learning velocity
      let learningVelocity = 'Steady';
      if (totalSessions > 20) learningVelocity = 'Fast';
      else if (totalSessions < 5) learningVelocity = 'Starting';

      return {
        totalSessions,
        averageSessionDuration: Math.round(avgDuration),
        mostActiveTime,
        topTopics,
        learningVelocity,
      };
    } catch (error) {
      logger.error('Failed to analyze learning pattern', error);
      return {
        totalSessions: 0,
        averageSessionDuration: 0,
        mostActiveTime: 'Unknown',
        topTopics: [],
        learningVelocity: 'Unknown',
      };
    }
  }
}

export const aiTutor = new AITutor();
