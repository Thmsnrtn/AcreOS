/**
 * Integration Test: Academy Flow
 * enroll → complete modules → pass quiz → receive certificate
 */
import { describe, it, expect, vi } from "vitest";

// Pure logic mirrors
interface Enrollment {
  id: number;
  userId: string;
  courseId: number;
  status: "active" | "completed" | "dropped";
  completedModules: number[];
  quizResults: QuizResult[];
  certificateId?: number;
  enrolledAt: Date;
  completedAt?: Date;
}

interface QuizResult {
  moduleId: number;
  score: number;
  passed: boolean;
  attempts: number;
  answeredAt: Date;
}

interface Certificate {
  id: number;
  enrollmentId: number;
  userId: string;
  courseId: number;
  verificationHash: string;
  issuedAt: Date;
  expiresAt: Date;
}

function createEnrollment(userId: string, courseId: number): Enrollment {
  return {
    id: Math.floor(Math.random() * 10000),
    userId, courseId,
    status: "active",
    completedModules: [],
    quizResults: [],
    enrolledAt: new Date(),
  };
}

function completeModule(enrollment: Enrollment, moduleId: number): void {
  if (enrollment.status !== "active") throw new Error("Cannot complete module in inactive enrollment");
  if (!enrollment.completedModules.includes(moduleId)) {
    enrollment.completedModules.push(moduleId);
  }
}

function gradeMultipleChoice(question: string, answer: string, correctAnswer: string): { correct: boolean; points: number } {
  return { correct: answer === correctAnswer, points: answer === correctAnswer ? 10 : 0 };
}

function gradeQuiz(answers: { question: string; answer: string; correct: string }[]): { score: number; total: number; passed: boolean; percentage: number } {
  const results = answers.map(a => gradeMultipleChoice(a.question, a.answer, a.correct));
  const score = results.reduce((s, r) => s + r.points, 0);
  const total = answers.length * 10;
  const percentage = (score / total) * 100;
  return { score, total, passed: percentage >= 70, percentage };
}

function recordQuizResult(enrollment: Enrollment, moduleId: number, score: number, passed: boolean): QuizResult {
  const existing = enrollment.quizResults.findIndex(r => r.moduleId === moduleId);
  const result: QuizResult = {
    moduleId, score, passed,
    attempts: existing >= 0 ? enrollment.quizResults[existing].attempts + 1 : 1,
    answeredAt: new Date(),
  };
  if (existing >= 0) enrollment.quizResults[existing] = result;
  else enrollment.quizResults.push(result);
  return result;
}

function checkCompletion(enrollment: Enrollment, requiredModules: number[], passingScore = 70): boolean {
  const allModulesComplete = requiredModules.every(m => enrollment.completedModules.includes(m));
  const allQuizzesPassed = enrollment.quizResults
    .filter(r => requiredModules.includes(r.moduleId))
    .every(r => r.passed);
  return allModulesComplete && allQuizzesPassed;
}

function generateCertificate(enrollment: Enrollment, courseId: number): Certificate {
  const hash = `cert-${enrollment.userId}-${courseId}-${Date.now()}`.replace(/[^a-z0-9]/g, '').substring(0, 32);
  const cert: Certificate = {
    id: Math.floor(Math.random() * 10000),
    enrollmentId: enrollment.id,
    userId: enrollment.userId,
    courseId,
    verificationHash: hash,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
  };
  enrollment.certificateId = cert.id;
  enrollment.status = "completed";
  enrollment.completedAt = new Date();
  return cert;
}

describe("Academy Integration", () => {
  describe("Enrollment", () => {
    it("creates enrollment with active status", () => {
      const e = createEnrollment("user1", 1);
      expect(e.status).toBe("active");
      expect(e.completedModules).toHaveLength(0);
      expect(e.quizResults).toHaveLength(0);
    });
  });

  describe("Module Completion", () => {
    it("marks module as complete", () => {
      const e = createEnrollment("user1", 1);
      completeModule(e, 101);
      expect(e.completedModules).toContain(101);
    });

    it("does not duplicate module completion", () => {
      const e = createEnrollment("user1", 1);
      completeModule(e, 101);
      completeModule(e, 101);
      expect(e.completedModules.filter(m => m === 101)).toHaveLength(1);
    });

    it("throws on inactive enrollment", () => {
      const e = createEnrollment("user1", 1);
      e.status = "dropped";
      expect(() => completeModule(e, 101)).toThrow("Cannot complete module in inactive enrollment");
    });
  });

  describe("Quiz Grading", () => {
    it("grades all correct answers as 100%", () => {
      const result = gradeQuiz([
        { question: "Q1", answer: "A", correct: "A" },
        { question: "Q2", answer: "B", correct: "B" },
        { question: "Q3", answer: "C", correct: "C" },
      ]);
      expect(result.percentage).toBe(100);
      expect(result.passed).toBe(true);
    });

    it("grades at 70% as passing", () => {
      const result = gradeQuiz([
        { question: "Q1", answer: "A", correct: "A" },
        { question: "Q2", answer: "A", correct: "A" },
        { question: "Q3", answer: "A", correct: "A" },
        { question: "Q4", answer: "A", correct: "A" },
        { question: "Q5", answer: "A", correct: "A" },
        { question: "Q6", answer: "A", correct: "A" },
        { question: "Q7", answer: "A", correct: "A" },
        { question: "Q8", answer: "X", correct: "A" },
        { question: "Q9", answer: "X", correct: "A" },
        { question: "Q10", answer: "X", correct: "A" },
      ]);
      expect(result.percentage).toBe(70);
      expect(result.passed).toBe(true);
    });

    it("fails below 70%", () => {
      const result = gradeQuiz([
        { question: "Q1", answer: "A", correct: "A" },
        { question: "Q2", answer: "X", correct: "A" },
        { question: "Q3", answer: "X", correct: "A" },
      ]);
      expect(result.passed).toBe(false);
    });

    it("tracks attempt count across retakes", () => {
      const e = createEnrollment("user1", 1);
      const r1 = recordQuizResult(e, 101, 60, false);
      expect(r1.attempts).toBe(1);
      const r2 = recordQuizResult(e, 101, 80, true);
      expect(r2.attempts).toBe(2);
    });
  });

  describe("Completion Check", () => {
    it("detects course completion when all modules done and quizzes passed", () => {
      const e = createEnrollment("user1", 1);
      const required = [101, 102, 103];
      required.forEach(m => {
        completeModule(e, m);
        recordQuizResult(e, m, 85, true);
      });
      expect(checkCompletion(e, required)).toBe(true);
    });

    it("not complete when modules missing", () => {
      const e = createEnrollment("user1", 1);
      completeModule(e, 101);
      recordQuizResult(e, 101, 85, true);
      expect(checkCompletion(e, [101, 102])).toBe(false);
    });

    it("not complete when quiz failed", () => {
      const e = createEnrollment("user1", 1);
      completeModule(e, 101);
      recordQuizResult(e, 101, 60, false);
      expect(checkCompletion(e, [101])).toBe(false);
    });
  });

  describe("Certificate Generation", () => {
    it("generates certificate with verification hash", () => {
      const e = createEnrollment("user1", 1);
      const cert = generateCertificate(e, 1);
      expect(cert.verificationHash).toBeTruthy();
      expect(cert.verificationHash.length).toBeGreaterThan(8);
      expect(cert.issuedAt).toBeInstanceOf(Date);
    });

    it("marks enrollment as completed after cert generation", () => {
      const e = createEnrollment("user1", 1);
      generateCertificate(e, 1);
      expect(e.status).toBe("completed");
      expect(e.completedAt).toBeInstanceOf(Date);
      expect(e.certificateId).toBeDefined();
    });

    it("cert expires 1 year after issuance", () => {
      const e = createEnrollment("user1", 1);
      const cert = generateCertificate(e, 1);
      const diffDays = (cert.expiresAt.getTime() - cert.issuedAt.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(365, 0);
    });
  });

  describe("Full Academy Flow", () => {
    it("completes full path: enroll → modules → quiz → cert", () => {
      const enrollment = createEnrollment("student1", 5);
      const requiredModules = [201, 202, 203, 204, 205];

      // Complete all modules
      requiredModules.forEach(m => completeModule(enrollment, m));
      expect(enrollment.completedModules).toHaveLength(5);

      // Pass quizzes for all modules
      requiredModules.forEach(m => recordQuizResult(enrollment, m, 82, true));
      expect(enrollment.quizResults.every(r => r.passed)).toBe(true);

      // Check completion
      const isComplete = checkCompletion(enrollment, requiredModules);
      expect(isComplete).toBe(true);

      // Generate certificate
      const cert = generateCertificate(enrollment, 5);
      expect(cert.userId).toBe("student1");
      expect(cert.courseId).toBe(5);
      expect(enrollment.status).toBe("completed");
    });
  });
});
