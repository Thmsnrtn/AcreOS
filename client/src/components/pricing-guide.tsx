import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, MessageSquare, Sparkles, Image, FileText, MapPin, Send } from "lucide-react";

interface PricingRates {
  actions: Record<string, { name: string; costCents: number; description: string }>;
  directMail: Record<string, { name: string; costCents: number; description: string }>;
  monthlyAllowances: Record<string, { credits: number; value: string }>;
}

export function PricingGuide() {
  const { data: rates, isLoading } = useQuery<PricingRates>({
    queryKey: ["/api/pricing/rates"],
  });

  if (isLoading) {
    return <Skeleton className="h-96 w-full" data-testid="skeleton-pricing-guide" />;
  }

  const actionIcons: Record<string, JSX.Element> = {
    email_sent: <Mail className="w-4 h-4" />,
    sms_sent: <MessageSquare className="w-4 h-4" />,
    ai_chat: <Sparkles className="w-4 h-4" />,
    ai_image: <Image className="w-4 h-4" />,
    pdf_generated: <FileText className="w-4 h-4" />,
    comps_query: <MapPin className="w-4 h-4" />,
  };

  return (
    <div className="space-y-6" data-testid="pricing-guide">
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-usage-pricing-title">Usage-Based Pricing</CardTitle>
          <CardDescription>
            These features are charged per use from your credit balance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates?.actions && Object.entries(rates.actions).map(([key, item]) => (
                <TableRow key={key} data-testid={`row-action-${key}`}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {actionIcons[key]}
                      {item.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.description}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" data-testid={`badge-cost-${key}`}>
                      ${(item.costCents / 100).toFixed(2)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" data-testid="text-direct-mail-title">
            <Send className="w-5 h-5" />
            Direct Mail Pricing
          </CardTitle>
          <CardDescription>
            Send physical postcards and letters to your leads
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mail Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Cost Per Piece</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates?.directMail && Object.entries(rates.directMail).map(([key, item]) => (
                <TableRow key={key} data-testid={`row-mail-${key}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-muted-foreground">{item.description}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" data-testid={`badge-mail-cost-${key}`}>
                      ${(item.costCents / 100).toFixed(2)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle data-testid="text-allowances-title">Monthly Credit Allowances</CardTitle>
          <CardDescription>
            Credits included with each subscription tier (resets monthly)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {rates?.monthlyAllowances && Object.entries(rates.monthlyAllowances).map(([tier, info]) => (
              <div 
                key={tier} 
                className="text-center p-4 rounded-lg bg-muted/50"
                data-testid={`card-allowance-${tier}`}
              >
                <div className="text-sm font-medium capitalize mb-1">{tier}</div>
                <div className="text-2xl font-bold text-primary" data-testid={`text-allowance-value-${tier}`}>
                  {info.value}
                </div>
                <div className="text-xs text-muted-foreground">/month</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
