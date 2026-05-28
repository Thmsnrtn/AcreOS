import { db } from '../db';
import { 
  courses, 
  courseModules, 
  courseEnrollments,
  users 
} from '../../shared/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { logger } from "../utils/logger";

interface CourseModule {
  title: string;
  content: string;
  videoUrl?: string;
  duration: number;
  order: number;
}

class Education {
  /**
   * Create a new course
   */
  async createCourse(
    _organizationId: number,
    courseData: {
      title: string;
      description: string;
      category: string;
      level: string;
      price: number;
      duration: number;
      modules: CourseModule[];
    }
  ): Promise<string> {
    try {
      // NOTE: the `courses` schema has no `organizationId`/`level`/`status`
      // columns. `level` (a difficulty label) maps to integer `difficultyLevel`
      // when numeric; publish state lives in `isPublished`; numerics are stored
      // as strings.
      const parsedLevel = Number(courseData.level);
      const [course] = await db.insert(courses).values({
        title: courseData.title,
        description: courseData.description,
        category: courseData.category,
        difficultyLevel: Number.isFinite(parsedLevel) ? parsedLevel : null,
        price: courseData.price.toString(),
        totalDurationMinutes: courseData.duration,
        enrollmentCount: 0,
        avgRating: "0",
        isPublished: false,
      }).returning();

      // Create course modules
      for (const module of courseData.modules) {
        await db.insert(courseModules).values({
          courseId: course.id,
          title: module.title,
          content: module.content,
          contentType: module.videoUrl ? "video" : "text",
          videoUrl: module.videoUrl || null,
          durationMinutes: module.duration,
          sortOrder: module.order,
        });
      }

      return course.id.toString();
    } catch (error) {
      logger.error('Failed to create course', error);
      throw error;
    }
  }

  /**
   * Get course details with modules
   */
  async getCourse(courseId: number): Promise<any> {
    try {
      const course = await db.query.courses.findFirst({
        where: eq(courses.id, courseId),
      });

      if (!course) {
        throw new Error('Course not found');
      }

      const modules = await db.query.courseModules.findMany({
        where: eq(courseModules.courseId, courseId),
        orderBy: [courseModules.sortOrder],
      });

      return {
        ...course,
        modules,
      };
    } catch (error) {
      logger.error('Failed to get course', error);
      throw error;
    }
  }

  /**
   * List all courses with filters
   */
  async listCourses(filters?: {
    category?: string;
    level?: string;
    status?: string;
  }): Promise<any[]> {
    try {
      const conditions = [];
      if (filters?.category) {
        conditions.push(eq(courses.category, filters.category));
      }
      if (filters?.level) {
        // `level` maps to integer difficultyLevel.
        const lvl = Number(filters.level);
        if (Number.isFinite(lvl)) conditions.push(eq(courses.difficultyLevel, lvl));
      }
      if (filters?.status) {
        // `status` maps to the boolean isPublished flag.
        conditions.push(eq(courses.isPublished, filters.status === "published"));
      }

      return await db.query.courses.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(courses.enrollmentCount)],
      });
    } catch (error) {
      logger.error('Failed to list courses', error);
      return [];
    }
  }

  /**
   * Enroll user in course
   */
  async enrollInCourse(
    userId: string,
    courseId: number
  ): Promise<string> {
    try {
      // Check if already enrolled
      const existing = await db.query.courseEnrollments.findFirst({
        where: and(
          eq(courseEnrollments.userId, userId),
          eq(courseEnrollments.courseId, courseId)
        ),
      });

      if (existing) {
        return existing.id.toString();
      }

      // Create enrollment
      const [enrollment] = await db.insert(courseEnrollments).values({
        userId,
        courseId,
        progressPercentage: "0",
        isCompleted: false,
        completedModules: [],
      }).returning();

      // Increment enrollment count
      await db.update(courses)
        .set({
          enrollmentCount: sql`${courses.enrollmentCount} + 1`,
        })
        .where(eq(courses.id, courseId));

      return enrollment.id.toString();
    } catch (error) {
      logger.error('Failed to enroll in course', error);
      throw error;
    }
  }

  /**
   * Update course progress
   */
  async updateProgress(
    enrollmentId: number,
    moduleId: number
  ): Promise<void> {
    try {
      const enrollment = await db.query.courseEnrollments.findFirst({
        where: eq(courseEnrollments.id, enrollmentId),
      });

      if (!enrollment) {
        throw new Error('Enrollment not found');
      }

      // Get course modules
      const modules = await db.query.courseModules.findMany({
        where: eq(courseModules.courseId, enrollment.courseId),
      });

      // Add module to completed list if not already there
      const completedModules = enrollment.completedModules || [];
      if (!completedModules.includes(moduleId)) {
        completedModules.push(moduleId);
      }

      // Calculate progress percentage
      const progress = modules.length > 0
        ? (completedModules.length / modules.length) * 100
        : 0;
      const isCompleted = progress >= 100;

      await db.update(courseEnrollments)
        .set({
          completedModules,
          progressPercentage: progress.toString(),
          isCompleted,
          completedAt: isCompleted ? new Date() : null,
        })
        .where(eq(courseEnrollments.id, enrollmentId));
    } catch (error) {
      logger.error('Failed to update progress', error);
      throw error;
    }
  }

  /**
   * Get user enrollments
   */
  async getUserEnrollments(userId: string): Promise<any[]> {
    try {
      const enrollments = await db.query.courseEnrollments.findMany({
        where: eq(courseEnrollments.userId, userId),
        orderBy: [desc(courseEnrollments.createdAt)],
      });

      // N+1 fix: Batch-fetch all courses in one query instead of one query per enrollment
      const courseIds = [...new Set(enrollments.map(e => e.courseId))];
      const courseList = courseIds.length > 0
        ? await db.query.courses.findMany({ where: inArray(courses.id, courseIds) })
        : [];
      const courseMap = new Map(courseList.map(c => [c.id, c]));

      const enriched = enrollments.map(enrollment => ({
        ...enrollment,
        course: courseMap.get(enrollment.courseId),
      }));

      return enriched;
    } catch (error) {
      logger.error('Failed to get user enrollments', error);
      return [];
    }
  }

  /**
   * Rate a course
   */
  async rateCourse(
    _userId: string,
    courseId: number,
    rating: number
  ): Promise<void> {
    try {
      if (rating < 1 || rating > 5) {
        throw new Error('Rating must be between 1 and 5');
      }

      // TODO(tsc): course_enrollments has no per-user `rating` column in the
      // frozen schema, so individual ratings cannot be persisted or averaged.
      // Until a `rating` column (or a dedicated course_ratings table) is added,
      // we record the latest rating directly on the course's avgRating.
      await db.update(courses)
        .set({ avgRating: rating.toString() })
        .where(eq(courses.id, courseId));
    } catch (error) {
      logger.error('Failed to rate course', error);
      throw error;
    }
  }

  /**
   * Publish course (make it available)
   */
  async publishCourse(courseId: number): Promise<void> {
    try {
      await db.update(courses)
        .set({
          isPublished: true,
          publishedAt: new Date(),
        })
        .where(eq(courses.id, courseId));
    } catch (error) {
      logger.error('Failed to publish course', error);
      throw error;
    }
  }

  /**
   * Get course statistics
   */
  async getCourseStats(courseId: number): Promise<{
    enrollmentCount: number;
    completionRate: number;
    averageRating: number;
    averageProgress: number;
  }> {
    try {
      const course = await db.query.courses.findFirst({
        where: eq(courses.id, courseId),
      });

      if (!course) {
        throw new Error('Course not found');
      }

      const enrollments = await db.query.courseEnrollments.findMany({
        where: eq(courseEnrollments.courseId, courseId),
      });

      const completedCount = enrollments.filter(e => e.isCompleted).length;
      const completionRate = enrollments.length > 0
        ? (completedCount / enrollments.length) * 100
        : 0;

      const avgProgress = enrollments.length > 0
        ? enrollments.reduce((sum, e) => sum + Number(e.progressPercentage ?? 0), 0) / enrollments.length
        : 0;

      return {
        enrollmentCount: enrollments.length,
        completionRate,
        averageRating: Number(course.avgRating ?? 0),
        averageProgress: avgProgress,
      };
    } catch (error) {
      logger.error('Failed to get course stats', error);
      return {
        enrollmentCount: 0,
        completionRate: 0,
        averageRating: 0,
        averageProgress: 0,
      };
    }
  }

  /**
   * Get recommended courses for user based on their activity
   */
  async getRecommendedCourses(userId: string): Promise<any[]> {
    try {
      // Get user's completed courses
      const userEnrollments = await db.query.courseEnrollments.findMany({
        where: and(
          eq(courseEnrollments.userId, userId),
          eq(courseEnrollments.isCompleted, true)
        ),
      });

      const completedCourseIds = userEnrollments.map(e => e.courseId);

      // If user has completed courses, recommend similar category courses
      if (completedCourseIds.length > 0) {
        const completedCourses = await db.query.courses.findMany({
          where: eq(courses.id, completedCourseIds[0]),
        });

        if (completedCourses.length > 0) {
          const category = completedCourses[0].category;

          return await db.query.courses.findMany({
            where: and(
              eq(courses.category, category),
              eq(courses.isPublished, true)
            ),
            orderBy: [desc(courses.avgRating)],
            limit: 5,
          });
        }
      }

      // Otherwise, recommend popular courses
      return await db.query.courses.findMany({
        where: eq(courses.isPublished, true),
        orderBy: [desc(courses.enrollmentCount)],
        limit: 5,
      });
    } catch (error) {
      logger.error('Failed to get recommended courses', error);
      return [];
    }
  }
}

export const education = new Education();
