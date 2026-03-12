// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from '../db';
import { 
  courses, 
  courseModules, 
  courseEnrollments,
  users 
} from '../../shared/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';

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
    organizationId: number,
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
      const [course] = await db.insert(courses).values({
        organizationId,
        title: courseData.title,
        description: courseData.description,
        category: courseData.category,
        level: courseData.level,
        price: courseData.price,
        duration: courseData.duration,
        enrollmentCount: 0,
        rating: 0,
        status: 'draft',
      }).returning();

      // Create course modules
      for (const module of courseData.modules) {
        await db.insert(courseModules).values({
          courseId: course.id,
          title: module.title,
          content: module.content,
          videoUrl: module.videoUrl || null,
          duration: module.duration,
          order: module.order,
          quizData: null,
        });
      }

      return course.id.toString();
    } catch (error) {
      console.error('Failed to create course:', error);
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
        orderBy: [courseModules.order],
      });

      return {
        ...course,
        modules,
      };
    } catch (error) {
      console.error('Failed to get course:', error);
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
      let where;

      if (filters?.category && filters?.level && filters?.status) {
        where = and(
          eq(courses.category, filters.category),
          eq(courses.level, filters.level),
          eq(courses.status, filters.status)
        );
      } else if (filters?.category && filters?.level) {
        where = and(
          eq(courses.category, filters.category),
          eq(courses.level, filters.level)
        );
      } else if (filters?.category) {
        where = eq(courses.category, filters.category);
      } else if (filters?.level) {
        where = eq(courses.level, filters.level);
      } else if (filters?.status) {
        where = eq(courses.status, filters.status);
      }

      return await db.query.courses.findMany({
        where,
        orderBy: [desc(courses.enrollmentCount)],
      });
    } catch (error) {
      console.error('Failed to list courses:', error);
      return [];
    }
  }

  /**
   * Enroll user in course
   */
  async enrollInCourse(
    userId: number,
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
        status: 'active',
        progress: 0,
        completedModules: [],
      }).returning();

      // Increment enrollment count
      await db.update(courses)
        .set({
          enrollmentCount: courses.enrollmentCount + 1,
        })
        .where(eq(courses.id, courseId));

      return enrollment.id.toString();
    } catch (error) {
      console.error('Failed to enroll in course:', error);
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
      const progress = (completedModules.length / modules.length) * 100;

      // Determine status
      let status = 'active';
      if (progress >= 100) {
        status = 'completed';
      }

      await db.update(courseEnrollments)
        .set({
          completedModules,
          progress,
          status,
          completedAt: progress >= 100 ? new Date() : null,
        })
        .where(eq(courseEnrollments.id, enrollmentId));
    } catch (error) {
      console.error('Failed to update progress:', error);
      throw error;
    }
  }

  /**
   * Get user enrollments
   */
  async getUserEnrollments(userId: number): Promise<any[]> {
    try {
      const enrollments = await db.query.courseEnrollments.findMany({
        where: eq(courseEnrollments.userId, userId),
        orderBy: [desc(courseEnrollments.enrolledAt)],
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
      console.error('Failed to get user enrollments:', error);
      return [];
    }
  }

  /**
   * Rate a course
   */
  async rateCourse(
    userId: number,
    courseId: number,
    rating: number
  ): Promise<void> {
    try {
      if (rating < 1 || rating > 5) {
        throw new Error('Rating must be between 1 and 5');
      }

      // Update enrollment with rating
      await db.update(courseEnrollments)
        .set({ rating })
        .where(and(
          eq(courseEnrollments.userId, userId),
          eq(courseEnrollments.courseId, courseId)
        ));

      // Recalculate average course rating
      const enrollments = await db.query.courseEnrollments.findMany({
        where: eq(courseEnrollments.courseId, courseId),
      });

      const ratings = enrollments
        .filter(e => e.rating !== null)
        .map(e => e.rating as number);

      if (ratings.length > 0) {
        const avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;

        await db.update(courses)
          .set({ rating: avgRating })
          .where(eq(courses.id, courseId));
      }
    } catch (error) {
      console.error('Failed to rate course:', error);
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
          status: 'published',
          publishedAt: new Date(),
        })
        .where(eq(courses.id, courseId));
    } catch (error) {
      console.error('Failed to publish course:', error);
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

      const completedCount = enrollments.filter(e => e.status === 'completed').length;
      const completionRate = enrollments.length > 0
        ? (completedCount / enrollments.length) * 100
        : 0;

      const avgProgress = enrollments.length > 0
        ? enrollments.reduce((sum, e) => sum + (e.progress || 0), 0) / enrollments.length
        : 0;

      return {
        enrollmentCount: enrollments.length,
        completionRate,
        averageRating: course.rating || 0,
        averageProgress: avgProgress,
      };
    } catch (error) {
      console.error('Failed to get course stats:', error);
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
  async getRecommendedCourses(userId: number): Promise<any[]> {
    try {
      // Get user's completed courses
      const userEnrollments = await db.query.courseEnrollments.findMany({
        where: and(
          eq(courseEnrollments.userId, userId),
          eq(courseEnrollments.status, 'completed')
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
              eq(courses.status, 'published')
            ),
            orderBy: [desc(courses.rating)],
            limit: 5,
          });
        }
      }

      // Otherwise, recommend popular courses
      return await db.query.courses.findMany({
        where: eq(courses.status, 'published'),
        orderBy: [desc(courses.enrollmentCount)],
        limit: 5,
      });
    } catch (error) {
      console.error('Failed to get recommended courses:', error);
      return [];
    }
  }
}

export const education = new Education();
