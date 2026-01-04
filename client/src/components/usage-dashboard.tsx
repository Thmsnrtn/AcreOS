import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CreditCard, DollarSign, TrendingUp, Calendar, Plus, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { CreditPurchaseModal } from "./credit-purchase-modal";
import { format } from "date-fns";

const USAGE_LABELS: Record<string, string> = {
  email_sent: "Email",
  sms_sent: "SMS",
  ai_chat: "AI Chat",
  ai_image: "AI Images",
  pdf_generated: "PDFs",
  comps_query: "Comps",
  direct_mail: "Direct Mail",
};

const USAGE_COLORS: Record<string, string> = {
  email_sent: "hsl(16, 70%, 50%)",
  sms_sent: "hsl(85, 25%, 45%)",
  ai_chat: "hsl(35, 40%, 60%)",
  ai_image: "hsl(200, 50%, 50%)",
  pdf_generated: "hsl(280, 40%, 55%)",
  comps_query: "hsl(45, 60%, 50%)",
  direct_mail: "hsl(350, 50%, 50%)",
};

interface CreditTransaction {
  id: number;
  type: string;
  amountCents: number;
  balanceAfterCents: number;
  description: string;
  createdAt: string;
}

interface UsageSummary {
  actionType: string;
  count: number;
  totalCost: number;
}

export function UsageDashboard() {
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);

  const { data: balanceData, isLoading: balanceLoading } = useQuery<{ balance: number }>({
    queryKey: ["/api/credits/balance"],
  });
  const balance = balanceData?.balance ?? 0;

  const { data: usageSummary, isLoading: usageLoading } = useQuery<UsageSummary[]>({
    queryKey: ["/api/usage/summary"],
  });

  const { data: transactions, isLoading: transactionsLoading } = useQuery<CreditTransaction[]>({
    queryKey: ["/api/credits/transactions?limit=20"],
  });

  const chartData = usageSummary?.map((item) => ({
    name: USAGE_LABELS[item.actionType] || item.actionType,
    count: item.count || 0,
    cost: (item.totalCost || 0) / 100,
    actionType: item.actionType,
  })) || [];

  const totalSpent = usageSummary?.reduce((sum, item) => sum + (item.totalCost || 0), 0) || 0;
  const daysInMonth = new Date().getDate();
  const avgDailySpend = daysInMonth > 0 ? totalSpent / daysInMonth : 0;
  const topCategory = usageSummary?.reduce(
    (top, item) => (item.totalCost > (top?.totalCost || 0) ? item : top),
    usageSummary[0]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Current Credit Balance
            </CardTitle>
            <CardDescription>Available credits for usage-based features</CardDescription>
          </div>
          <Button onClick={() => setPurchaseModalOpen(true)} data-testid="button-add-credits">
            <Plus className="w-4 h-4 mr-2" />
            Add Credits
          </Button>
        </CardHeader>
        <CardContent>
          {balanceLoading ? (
            <Skeleton className="h-12 w-40" />
          ) : (
            <div className="text-4xl font-bold" data-testid="text-credit-balance">
              ${(balance / 100).toFixed(2)}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Usage This Month
          </CardTitle>
          <CardDescription>Breakdown of credits used by category</CardDescription>
        </CardHeader>
        <CardContent>
          {usageLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : chartData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                  <XAxis 
                    dataKey="name" 
                    tick={{ fontSize: 11 }} 
                    angle={-30}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis 
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === "cost") return [`$${value.toFixed(2)}`, "Cost"];
                      return [value, "Count"];
                    }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={USAGE_COLORS[entry.actionType] || "hsl(16, 70%, 50%)"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-muted-foreground">
              No usage data this month
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Spent This Month</CardDescription>
          </CardHeader>
          <CardContent>
            {usageLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-total-spent">
                ${(totalSpent / 100).toFixed(2)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Average Daily Spend</CardDescription>
          </CardHeader>
          <CardContent>
            {usageLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-avg-daily">
                ${(avgDailySpend / 100).toFixed(2)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Top Category</CardDescription>
          </CardHeader>
          <CardContent>
            {usageLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : topCategory ? (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold" data-testid="text-top-category">
                  {USAGE_LABELS[topCategory.actionType] || topCategory.actionType}
                </span>
                <Badge variant="secondary">
                  ${((topCategory.totalCost || 0) / 100).toFixed(2)}
                </Badge>
              </div>
            ) : (
              <span className="text-muted-foreground">No data</span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Recent Transactions
          </CardTitle>
          <CardDescription>Credit purchases, usage, and adjustments</CardDescription>
        </CardHeader>
        <CardContent>
          {transactionsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : transactions && transactions.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`}>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(tx.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={tx.type === "purchase" || tx.type === "bonus" || tx.type === "monthly_allowance" ? "default" : "secondary"}
                        >
                          {tx.type === "monthly_allowance" ? "allowance" : tx.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {tx.description}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`flex items-center justify-end gap-1 ${
                          tx.amountCents >= 0 
                            ? "text-green-600 dark:text-green-400" 
                            : "text-red-600 dark:text-red-400"
                        }`}>
                          {tx.amountCents >= 0 ? (
                            <ArrowUpRight className="w-3 h-3" />
                          ) : (
                            <ArrowDownRight className="w-3 h-3" />
                          )}
                          ${Math.abs(tx.amountCents / 100).toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        ${(tx.balanceAfterCents / 100).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              No transactions yet
            </div>
          )}
        </CardContent>
      </Card>

      <CreditPurchaseModal open={purchaseModalOpen} onOpenChange={setPurchaseModalOpen} />
    </div>
  );
}
