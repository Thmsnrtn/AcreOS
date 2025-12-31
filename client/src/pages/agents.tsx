import { Sidebar } from "@/components/layout-sidebar";
import { useAgentTasks, useCreateAgentTask } from "@/hooks/use-agent-tasks";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Sparkles, Send, Loader2, CheckCircle2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export default function AgentsPage() {
  const { data: tasks, isLoading } = useAgentTasks();
  const { mutate: createTask, isPending } = useCreateAgentTask();
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState("research");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    createTask({
      agentType: activeTab,
      input: input,
      status: "pending"
    }, {
      onSuccess: () => setInput("")
    });
  };

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-8 h-screen flex flex-col">
        <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col gap-6">
          
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-600 rounded-xl text-white">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">AI Command Center</h1>
              <p className="text-muted-foreground">Assign tasks to your specialized agents.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
            {/* Task Creation Column */}
            <Card className="col-span-1 shadow-lg border-indigo-100 dark:border-indigo-900 flex flex-col">
              <CardHeader className="bg-indigo-50/50 dark:bg-indigo-900/10 pb-4">
                <CardTitle className="text-indigo-700 dark:text-indigo-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> New Task
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col pt-6 gap-4">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="research">Research</TabsTrigger>
                    <TabsTrigger value="marketing">Marketing</TabsTrigger>
                  </TabsList>
                  <div className="mt-4 text-sm text-muted-foreground">
                    {activeTab === 'research' 
                      ? "Use this agent to analyze county data, pricing, and comps."
                      : "Use this agent to write ad copy and generate listing descriptions."}
                  </div>
                </Tabs>
                
                <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-4">
                  <Textarea 
                    placeholder={`Describe your ${activeTab} task here...`}
                    className="flex-1 resize-none p-4 text-base focus-visible:ring-indigo-500"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                  <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={isPending || !input.trim()}>
                    {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                    Deploy Agent
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Tasks Feed Column */}
            <Card className="col-span-1 lg:col-span-2 shadow-sm flex flex-col overflow-hidden">
              <CardHeader className="border-b bg-slate-50/50 dark:bg-slate-900/50">
                <CardTitle>Active Operations</CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 relative">
                <ScrollArea className="h-full absolute inset-0">
                  <div className="p-6 space-y-6">
                    {isLoading ? (
                      <div className="text-center py-10 text-muted-foreground">Connecting to agents...</div>
                    ) : tasks?.length === 0 ? (
                      <div className="text-center py-20 text-muted-foreground">
                        <Bot className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        No active tasks. Start a new one!
                      </div>
                    ) : (
                      tasks?.map((task) => (
                        <div key={task.id} className="group flex gap-4">
                          <div className="flex flex-col items-center gap-2">
                            <div className={`w-2 h-full rounded-full ${
                              task.status === 'completed' ? 'bg-emerald-500/20' : 'bg-slate-200 dark:bg-slate-800'
                            }`} />
                          </div>
                          <div className="flex-1 pb-8">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline" className="capitalize">{task.agentType}</Badge>
                              <span className="text-xs text-muted-foreground">
                                {new Date(task.createdAt).toLocaleTimeString()}
                              </span>
                              {task.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                              {task.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />}
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 mb-3 border">
                              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{task.input}</p>
                            </div>
                            {task.output && (
                              <div className="bg-emerald-50/50 dark:bg-emerald-900/10 rounded-lg p-4 border border-emerald-100 dark:border-emerald-900/50">
                                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                                  {task.output}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

        </div>
      </main>
    </div>
  );
}
