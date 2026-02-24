import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation } from '@tanstack/react-query';
import { BookOpen, Trophy, MessageCircle, PlayCircle, CheckCircle, Clock } from 'lucide-react';

export default function AcademyPage() {
  const [selectedCourse, setSelectedCourse] = useState<any>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorMessage, setTutorMessage] = useState('');
  const [tutorHistory, setTutorHistory] = useState<any[]>([]);

  // Fetch courses
  const { data: courses = [] } = useQuery({
    queryKey: ['academy-courses'],
    queryFn: async () => {
      const res = await fetch('/api/academy/courses');
      if (!res.ok) throw new Error('Failed to fetch courses');
      return res.json();
    },
  });

  // Fetch enrollments
  const { data: enrollments = [] } = useQuery({
    queryKey: ['academy-enrollments'],
    queryFn: async () => {
      const res = await fetch('/api/academy/enrollments');
      if (!res.ok) throw new Error('Failed to fetch enrollments');
      return res.json();
    },
  });

  // Send tutor message
  const sendTutorMessage = useMutation({
    mutationFn: async (message: string) => {
      const res = await fetch('/api/academy/tutor/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error('Failed to send message');
      return res.json();
    },
    onSuccess: (data) => {
      setTutorHistory((prev) => [
        ...prev,
        { role: 'user', content: tutorMessage },
        { role: 'assistant', content: data.response },
      ]);
      setTutorMessage('');
    },
  });

  const handleSendMessage = () => {
    if (!tutorMessage.trim()) return;
    sendTutorMessage.mutate(tutorMessage);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">AcreOS Academy</h1>
          <p className="text-muted-foreground">Master land investment with expert courses</p>
        </div>
        <Button onClick={() => setTutorOpen(true)}>
          <MessageCircle className="w-4 h-4 mr-2" />
          AI Tutor
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Courses Completed</CardTitle>
            <Trophy className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {enrollments.filter((e: any) => e.status === 'completed').length}
            </div>
            <p className="text-xs text-muted-foreground">Keep learning!</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {enrollments.filter((e: any) => e.status === 'active').length}
            </div>
            <p className="text-xs text-muted-foreground">Continue where you left off</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available Courses</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{courses.length}</div>
            <p className="text-xs text-muted-foreground">Ready to explore</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Enrolled</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{enrollments.length}</div>
            <p className="text-xs text-muted-foreground">Your courses</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="courses" className="space-y-4">
        <TabsList>
          <TabsTrigger value="courses">All Courses</TabsTrigger>
          <TabsTrigger value="enrolled">My Courses</TabsTrigger>
          <TabsTrigger value="recommended">Recommended</TabsTrigger>
        </TabsList>

        <TabsContent value="courses" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {courses.map((course: any) => (
              <Card key={course.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{course.title}</CardTitle>
                      <CardDescription className="mt-2">{course.description}</CardDescription>
                    </div>
                    <Badge variant="secondary">{course.level}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Category</span>
                      <span className="font-medium">{course.category}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Duration</span>
                      <span>{course.duration} min</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Enrolled</span>
                      <span>{course.enrollmentCount} students</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Rating</span>
                      <span>⭐ {course.rating?.toFixed(1) || 'New'}</span>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => setSelectedCourse(course)}
                  >
                    <PlayCircle className="w-4 h-4 mr-2" />
                    {course.price > 0 ? `Enroll - $${course.price}` : 'Start Free'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {courses.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <BookOpen className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No courses available yet</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="enrolled" className="space-y-4">
          {enrollments.length > 0 ? (
            <div className="space-y-4">
              {enrollments.map((enrollment: any) => (
                <Card key={enrollment.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle>{enrollment.course?.title}</CardTitle>
                        <CardDescription>{enrollment.course?.description}</CardDescription>
                      </div>
                      <Badge variant={enrollment.status === 'completed' ? 'default' : 'secondary'}>
                        {enrollment.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span>Progress</span>
                        <span>{enrollment.progress}%</span>
                      </div>
                      <Progress value={enrollment.progress} />
                    </div>
                    <Button size="sm">
                      {enrollment.status === 'completed' ? 'Review Course' : 'Continue Learning'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <BookOpen className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No enrolled courses</p>
                <Button className="mt-4">Browse Courses</Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="recommended" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recommended for You</CardTitle>
              <CardDescription>Based on your learning history and goals</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-center text-muted-foreground py-8">
                Complete more courses to get personalized recommendations
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* AI Tutor Dialog */}
      <Dialog open={tutorOpen} onOpenChange={setTutorOpen}>
        <DialogContent className="max-w-2xl max-h-[600px]">
          <DialogHeader>
            <DialogTitle>AI Tutor - Land Investment Expert</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col h-[450px]">
            <div className="flex-1 overflow-y-auto space-y-4 p-4 border rounded-lg">
              {tutorHistory.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Ask me anything about land investment!</p>
                  <p className="text-sm mt-2">
                    I can help with due diligence, financing, market analysis, and more.
                  </p>
                </div>
              ) : (
                tutorHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground ml-auto max-w-[80%]'
                        : 'bg-muted mr-auto max-w-[80%]'
                    }`}
                  >
                    {msg.content}
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <Input
                placeholder="Ask a question..."
                value={tutorMessage}
                onChange={(e) => setTutorMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              />
              <Button onClick={handleSendMessage} disabled={sendTutorMessage.isPending}>
                Send
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
