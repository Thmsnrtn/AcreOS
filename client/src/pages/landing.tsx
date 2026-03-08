import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MapPin, TrendingUp, FileText, Bot } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8 text-center">
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <span className="text-white font-bold text-xl">A</span>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            AcreOS
          </h1>
        </div>
        <p className="text-xl text-muted-foreground">
          The land investment platform built for serious operators.
        </p>
        <div className="grid grid-cols-2 gap-4 my-8">
          {[
            { icon: MapPin, label: "Portfolio Mapping" },
            { icon: TrendingUp, label: "AI Valuations" },
            { icon: FileText, label: "Document Generation" },
            { icon: Bot, label: "AI Deal Intelligence" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-3 p-4 rounded-xl border bg-card">
              <Icon className="w-5 h-5 text-primary shrink-0" />
              <span className="text-sm font-medium">{label}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-3 justify-center">
          <Button asChild size="lg">
            <Link href="/auth">Get Started</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/auth">Sign In</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
