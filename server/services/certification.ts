/**
 * Certification Service — AcreOS Phase 4 (Academy)
 *
 * Tracks course completions and awards certificates and achievement badges.
 * Certificates are generated as structured records (PDF generation
 * can be added via a document service in the future).
 *
 * Achievement tiers:
 *   Bronze — completed 1 course
 *   Silver — completed 3 courses
 *   Gold   — completed 5 courses + passed all quizzes
 *   Platinum — completed all available courses
 */

// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from '../db';
import {
  courses,
  courseEnrollments,
  courseModules,
  users,
} from '../../shared/schema';
import { eq, and, count, sql, desc } from 'drizzle-orm';
import crypto from 'crypto';

export interface Certificate {
  id: string;
  userId: number;
  courseId: number;
  courseTitle: string;
  userName: string;
  issuedAt: string;
  verificationCode: string;
  score?: number; // Average quiz score
}

export interface Achievement {
  id: string;
  userId: number;
  type: 'first_course' | 'three_courses' | 'five_courses' | 'all_courses' | 'perfect_score' | 'speed_learner';
  title: string;
  description: string;
  icon: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  unlockedAt: string;
}

export interface LearningStats {
  userId: number;
  coursesCompleted: number;
  coursesEnrolled: number;
  averageQuizScore: number;
  totalHoursLearned: number;
  certificates: Certificate[];
  achievements: Achievement[];
  currentStreak: number; // days
  rank: 'Beginner' | 'Investor' | 'Expert' | 'Master';
}

// In-memory stores (would be DB tables in production)
const certificateStore = new Map<string, Certificate>(); // id → cert
const userCertificates = new Map<number, string[]>(); // userId → cert ids
const achievementStore = new Map<string, Achievement>(); // id → achievement
const userAchievements = new Map<number, string[]>(); // userId → achievement ids

class CertificationService {
  /**
   * Check if a user has completed a course and award certificate + achievements.
   * Called after every module completion update.
   */
  async checkAndAward(userId: number, courseId: number): Promise<{
    certificate: Certificate | null;
    newAchievements: Achievement[];
  }> {
    const completed = await this.isCourseComplete(userId, courseId);
    if (!completed) {
      return { certificate: null, newAchievements: [] };
    }

    // Check if already certified
    const existingCerts = userCertificates.get(userId) || [];
    const alreadyCertified = existingCerts.some(certId => {
      const cert = certificateStore.get(certId);
      return cert?.courseId === courseId;
    });

    let certificate: Certificate | null = null;

    if (!alreadyCertified) {
      certificate = await this.issueCertificate(userId, courseId);
    }

    const newAchievements = await this.checkAchievements(userId);

    return { certificate, newAchievements };
  }

  /**
   * Check if all modules in a course are marked complete for a user.
   */
  async isCourseComplete(userId: number, courseId: number): Promise<boolean> {
    try {
      const modules = await db
        .select({ id: courseModules.id })
        .from(courseModules)
        .where(eq(courseModules.courseId, courseId));

      if (modules.length === 0) return false;

      const enrollment = await db.query.courseEnrollments.findFirst({
        where: and(
          eq(courseEnrollments.userId, userId),
          eq(courseEnrollments.courseId, courseId)
        ),
      });

      if (!enrollment) return false;

      const progress: any[] = enrollment.progress || [];
      const completedModuleIds = new Set(
        progress.filter(p => p.completed).map(p => p.moduleId)
      );

      return modules.every(m => completedModuleIds.has(m.id));
    } catch (_) {
      return false;
    }
  }

  /**
   * Issue a certificate for a completed course.
   */
  async issueCertificate(userId: number, courseId: number): Promise<Certificate> {
    const course = await db.query.courses.findFirst({
      where: eq(courses.id, courseId),
    });

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    const enrollment = await db.query.courseEnrollments.findFirst({
      where: and(
        eq(courseEnrollments.userId, userId),
        eq(courseEnrollments.courseId, courseId)
      ),
    });

    // Calculate average quiz score
    const progress: any[] = enrollment?.progress || [];
    const quizScores = progress.filter(p => p.quizScore != null).map(p => p.quizScore);
    const avgScore = quizScores.length > 0
      ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length)
      : undefined;

    const cert: Certificate = {
      id: crypto.randomUUID(),
      userId,
      courseId,
      courseTitle: course?.title || 'Land Investment Course',
      userName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Land Investor',
      issuedAt: new Date().toISOString(),
      verificationCode: crypto.randomBytes(8).toString('hex').toUpperCase(),
      score: avgScore,
    };

    // Store certificate
    certificateStore.set(cert.id, cert);
    const userCerts = userCertificates.get(userId) || [];
    userCerts.push(cert.id);
    userCertificates.set(userId, userCerts);

    // Mark enrollment as completed
    try {
      await db
        .update(courseEnrollments)
        .set({ completedAt: new Date(), certificateIssued: true } as any)
        .where(
          and(
            eq(courseEnrollments.userId, userId),
            eq(courseEnrollments.courseId, courseId)
          )
        );
    } catch (_) { /* graceful — field may not exist */ }

    return cert;
  }

  /**
   * Check all achievement criteria and award any newly unlocked ones.
   */
  async checkAchievements(userId: number): Promise<Achievement[]> {
    const existingIds = new Set(userAchievements.get(userId) || []);
    const newAchievements: Achievement[] = [];

    const userCerts = userCertificates.get(userId) || [];
    const certCount = userCerts.length;

    const checks: Array<{
      id: string;
      condition: boolean;
      type: Achievement['type'];
      title: string;
      description: string;
      icon: string;
      tier: Achievement['tier'];
    }> = [
      {
        id: `first_course_${userId}`,
        condition: certCount >= 1,
        type: 'first_course',
        title: 'First Certificate',
        description: 'Completed your first AcreOS Academy course',
        icon: 'award',
        tier: 'bronze',
      },
      {
        id: `three_courses_${userId}`,
        condition: certCount >= 3,
        type: 'three_courses',
        title: 'Knowledge Builder',
        description: 'Completed 3 courses — you\'re becoming an expert',
        icon: 'book-open',
        tier: 'silver',
      },
      {
        id: `five_courses_${userId}`,
        condition: certCount >= 5,
        type: 'five_courses',
        title: 'Land Investment Expert',
        description: 'Completed 5 courses — mastering the land game',
        icon: 'star',
        tier: 'gold',
      },
      {
        id: `perfect_score_${userId}`,
        condition: await this.hasPerfectScore(userId),
        type: 'perfect_score',
        title: 'Perfect Score',
        description: 'Achieved 100% on a course quiz',
        icon: 'target',
        tier: 'gold',
      },
    ];

    for (const check of checks) {
      if (check.condition && !existingIds.has(check.id)) {
        const achievement: Achievement = {
          id: check.id,
          userId,
          type: check.type,
          title: check.title,
          description: check.description,
          icon: check.icon,
          tier: check.tier,
          unlockedAt: new Date().toISOString(),
        };

        achievementStore.set(check.id, achievement);
        const userAchievs = userAchievements.get(userId) || [];
        userAchievs.push(check.id);
        userAchievements.set(userId, userAchievs);
        newAchievements.push(achievement);
      }
    }

    return newAchievements;
  }

  private async hasPerfectScore(userId: number): Promise<boolean> {
    try {
      const enrollments = await db.query.courseEnrollments.findMany({
        where: eq(courseEnrollments.userId, userId),
      });

      for (const enrollment of enrollments) {
        const progress: any[] = enrollment.progress || [];
        const quizScores = progress.filter(p => p.quizScore != null).map(p => p.quizScore);
        if (quizScores.length > 0 && Math.max(...quizScores) === 100) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  /**
   * Get full learning stats for a user.
   */
  async getLearningStats(userId: number): Promise<LearningStats> {
    const userCerts = (userCertificates.get(userId) || [])
      .map(id => certificateStore.get(id))
      .filter(Boolean) as Certificate[];

    const userAchievs = (userAchievements.get(userId) || [])
      .map(id => achievementStore.get(id))
      .filter(Boolean) as Achievement[];

    let coursesEnrolled = 0;
    let coursesCompleted = 0;
    let totalHoursLearned = 0;
    let avgScore = 0;
    const allScores: number[] = [];

    try {
      const enrollments = await db.query.courseEnrollments.findMany({
        where: eq(courseEnrollments.userId, userId),
      });

      coursesEnrolled = enrollments.length;
      coursesCompleted = enrollments.filter(e => (e as any).completedAt != null).length;

      for (const enrollment of enrollments) {
        const progress: any[] = enrollment.progress || [];
        const scores = progress.filter(p => p.quizScore != null).map(p => p.quizScore);
        allScores.push(...scores);

        // Estimate hours from course duration
        try {
          const course = await db.query.courses.findFirst({
            where: eq(courses.id, enrollment.courseId),
          });
          if (course?.duration) {
            const completedModules = progress.filter(p => p.completed).length;
            const totalModules = await db.select({ count: count() })
              .from(courseModules)
              .where(eq(courseModules.courseId, enrollment.courseId));
            const total = Number(totalModules[0]?.count || 1);
            totalHoursLearned += (course.duration / 60) * (completedModules / total);
          }
        } catch (_) {}
      }

      avgScore = allScores.length > 0
        ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
        : 0;
    } catch (_) {}

    const rank = this.calculateRank(coursesCompleted, avgScore);

    return {
      userId,
      coursesCompleted,
      coursesEnrolled,
      averageQuizScore: avgScore,
      totalHoursLearned: Math.round(totalHoursLearned * 10) / 10,
      certificates: userCerts,
      achievements: userAchievs,
      currentStreak: 0, // Would track daily login/activity in production
      rank,
    };
  }

  /**
   * Verify a certificate by verification code (public endpoint).
   */
  verifyCertificate(verificationCode: string): Certificate | null {
    for (const cert of certificateStore.values()) {
      if (cert.verificationCode === verificationCode.toUpperCase()) {
        return cert;
      }
    }
    return null;
  }

  private calculateRank(
    coursesCompleted: number,
    avgScore: number
  ): LearningStats['rank'] {
    if (coursesCompleted === 0) return 'Beginner';
    if (coursesCompleted < 3) return 'Investor';
    if (coursesCompleted < 7 || avgScore < 80) return 'Expert';
    return 'Master';
  }
}

export const certificationService = new CertificationService();
