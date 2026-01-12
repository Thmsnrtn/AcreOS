import { useState } from "react";
import { Search, BookOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const helpTopics = [
  {
    category: "Getting Started",
    items: [
      { title: "Creating your first lead", description: "Learn how to add and manage leads in AcreOS" },
      { title: "Adding properties", description: "Track properties you're evaluating or own" },
      { title: "Managing deals", description: "Use the deal pipeline to track acquisitions and dispositions" },
    ]
  },
  {
    category: "AI Assistant",
    items: [
      { title: "Talking to Atlas", description: "Your AI assistant can help with research, analysis, and tasks" },
      { title: "Generating offers", description: "Let AI create offer letters based on property data" },
    ]
  },
  {
    category: "Keyboard Shortcuts",
    items: [
      { title: "Command Palette", description: "Press Cmd+K to quickly search and navigate" },
      { title: "Navigation shortcuts", description: "Use g+d, g+l, g+p to jump to pages" },
      { title: "Help", description: "Press Cmd+? to open this help panel anytime" },
    ]
  },
  {
    category: "Features",
    items: [
      { title: "Lead Management", description: "Import, track, and manage your land seller leads" },
      { title: "Property Tracking", description: "Track properties from research to sale with full details" },
      { title: "Campaign Management", description: "Run email, SMS, and direct mail campaigns" },
      { title: "Deal Pipeline", description: "Visualize and manage deals with Kanban-style workflow" },
      { title: "Finance & Notes", description: "Manage seller financing and track note performance" },
    ]
  },
];

export function HelpPanel() {
  const [search, setSearch] = useState("");
  
  const filteredTopics = helpTopics.map(category => ({
    ...category,
    items: category.items.filter(item => 
      item.title.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase())
    )
  })).filter(category => category.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input 
          placeholder="Search help topics..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
          data-testid="input-help-search"
        />
      </div>
      
      {filteredTopics.length > 0 ? (
        filteredTopics.map(category => (
          <div key={category.category} data-testid={`help-category-${category.category.toLowerCase().replace(/\s+/g, '-')}`}>
            <h3 className="font-semibold text-sm text-muted-foreground mb-2 flex items-center gap-1">
              <BookOpen className="w-4 h-4" />
              {category.category}
            </h3>
            <div className="space-y-2">
              {category.items.map(item => (
                <Card key={item.title} className="hover-elevate cursor-pointer transition-all" data-testid={`help-item-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  <CardContent className="p-3">
                    <h4 className="font-medium text-sm">{item.title}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="text-center py-8">
          <p className="text-muted-foreground text-sm">No help topics found for "{search}"</p>
        </div>
      )}
    </div>
  );
}
